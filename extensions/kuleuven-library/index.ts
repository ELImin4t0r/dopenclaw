/**
 * KU Leuven Library (KURT): reservation alerts and on-arrival check-in.
 *
 * - Every 30 min the service syncs your reservations into
 *   `personal/reservations.md` and writes alert lines to
 *   `personal/alerts/kurt.md` (delivered by the daily-briefing plugin).
 * - The iPhone app fetches `library.places` (from `personal/places.md`) and
 *   watches those areas. When you walk in, it calls `library.arrived` with
 *   its location, and the plugin checks you in if a reservation is open.
 * - Check-in always requires a fresh phone location inside the library.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { Type } from "typebox";
import {
  evaluateCheckin,
  parsePlaces,
  renderReservationAlerts,
  renderReservations,
  type PhoneLocation,
  type Reservation,
} from "./src/checkin.js";
import { KurtNotMappedError, KurtSite } from "./src/kurt-site.js";

type LibraryConfig = {
  baseUrl: string;
  reminderLeadMinutes: number;
  checkinBeforeMinutes: number;
  checkinAfterMinutes: number;
  autoCheckin: boolean;
  browserChannel: string;
};

function resolveConfig(raw: unknown): LibraryConfig {
  const cfg = (raw ?? {}) as Partial<LibraryConfig>;
  return {
    baseUrl: cfg.baseUrl ?? "https://kurt3.ghum.kuleuven.be",
    reminderLeadMinutes: cfg.reminderLeadMinutes ?? 30,
    checkinBeforeMinutes: cfg.checkinBeforeMinutes ?? 15,
    checkinAfterMinutes: cfg.checkinAfterMinutes ?? 30,
    autoCheckin: cfg.autoCheckin ?? true,
    browserChannel: cfg.browserChannel ?? "chrome",
  };
}

const SYNC_MS = 30 * 60_000;

export default definePluginEntry({
  id: "kuleuven-library",
  name: "KU Leuven Library",
  description: "KURT reservation alerts and on-arrival check-in",
  configSchema: { parse: resolveConfig },
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const checkinWindow = { beforeMinutes: config.checkinBeforeMinutes, afterMinutes: config.checkinAfterMinutes };
    let state: { workspaceDir: string; site: KurtSite } | undefined;
    let reservations: Reservation[] = [];

    const requireState = () => {
      if (!state) {
        throw new Error("kuleuven-library service is not running");
      }
      return state;
    };
    const personal = (...parts: string[]) => path.join(requireState().workspaceDir, "personal", ...parts);

    async function readPlaces() {
      try {
        return parsePlaces(await fs.readFile(personal("places.md"), "utf8"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    }

    async function sync(): Promise<Reservation[]> {
      const nowMs = Date.now();
      reservations = (await requireState().site.listReservations()).filter((r) => r.endMs > nowMs);
      await fs.mkdir(personal("alerts"), { recursive: true });
      await fs.writeFile(personal("reservations.md"), renderReservations(reservations, nowMs), "utf8");
      await fs.writeFile(
        personal("alerts", "kurt.md"),
        renderReservationAlerts(reservations, config.reminderLeadMinutes),
        "utf8",
      );
      return reservations;
    }

    /** Runs the location gate and, only if it passes, checks in on KURT. */
    async function tryCheckin(location: PhoneLocation | undefined) {
      await sync();
      const gate = evaluateCheckin({
        reservations,
        places: await readPlaces(),
        location,
        nowMs: Date.now(),
        window: checkinWindow,
      });
      if (!gate.ok) {
        return { checkedIn: false, message: gate.reason };
      }
      await requireState().site.checkIn(gate.reservation);
      await sync();
      return {
        checkedIn: true,
        message: `Checked in at ${gate.place.name} · ${gate.reservation.seat}`,
      };
    }

    const handle =
      (run: (params: unknown) => unknown) =>
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          respond(true, await run(params));
        } catch (err) {
          const message = formatErrorMessage(err);
          respond(false, { error: message }, errorShape(ErrorCodes.UNAVAILABLE, message));
        }
      };

    api.registerGatewayMethod("library.places", handle(async () => ({ places: await readPlaces() })), {
      scope: "operator.read",
    });

    api.registerGatewayMethod(
      "library.arrived",
      handle(async (params) => {
        const p = params as Partial<PhoneLocation>;
        if (![p.lat, p.lon, p.accuracyMeters, p.timestampMs].every((v) => typeof v === "number")) {
          throw new Error("lat, lon, accuracyMeters and timestampMs are required numbers");
        }
        if (!config.autoCheckin) {
          return { checkedIn: false, notify: false, message: "Auto check-in is off." };
        }
        const result = await tryCheckin(p as PhoneLocation);
        // Walking past the library without a reservation should stay silent.
        const silent = !result.checkedIn && result.message.startsWith("No reservation");
        return { ...result, notify: !silent };
      }),
      { scope: "operator.write" },
    );

    api.registerService({
      id: "kuleuven-library",
      apiVersion: 2,
      start: async (ctx) => {
        if (!ctx.workspaceDir || !ctx.scheduler) {
          throw new Error("kuleuven-library needs a workspace and the v2 service scheduler");
        }
        state = {
          workspaceDir: ctx.workspaceDir,
          site: new KurtSite({
            baseUrl: config.baseUrl,
            dataDir: path.join(ctx.stateDir, "kuleuven-library"),
            browserChannel: config.browserChannel,
          }),
        };
        let warnedNotMapped = false;
        ctx.scheduler.schedule({
          id: "sync",
          delayMs: 5_000,
          everyMs: SYNC_MS,
          run: async () => {
            try {
              await sync();
            } catch (err) {
              if (err instanceof KurtNotMappedError) {
                if (!warnedNotMapped) {
                  ctx.logger.warn(`kuleuven-library: ${err.message}`);
                }
                warnedNotMapped = true;
                return;
              }
              ctx.logger.warn(`kuleuven-library: sync failed: ${formatErrorMessage(err)}`);
            }
          },
        });
      },
      async stop() {
        state = undefined;
      },
    });

    api.registerTool({
      name: "kurt_login",
      label: "KURT login",
      description:
        "Open a browser window on the laptop so the user can sign in to KURT (KU Leuven SSO). The login is remembered. Returns when the user closes the window.",
      parameters: Type.Object({}),
      async execute() {
        await requireState().site.login();
        return jsonResult({ ok: true });
      },
    });

    api.registerTool({
      name: "kurt_record",
      label: "KURT record",
      description:
        "Open KURT in a browser on the laptop and record the site's data requests while the user clicks through 'My reservations' and a check-in. Used once to map the site.",
      parameters: Type.Object({}),
      async execute() {
        return jsonResult({ savedTo: await requireState().site.record() });
      },
    });

    api.registerTool({
      name: "kurt_reservations",
      label: "Library reservations",
      description: "List the user's upcoming KU Leuven library (KURT) reservations.",
      parameters: Type.Object({}),
      async execute() {
        return jsonResult({ reservations: await sync() });
      },
    });

    api.registerTool({
      name: "kurt_checkin",
      label: "Library check-in",
      description:
        "Check the user in to their current KURT reservation. Only succeeds when the user's phone shows they are at the library.",
      parameters: Type.Object({}),
      async execute() {
        const { nodes } = await api.runtime.nodes.list({ connected: true });
        const phone = nodes.find((n) => n.platform === "ios" && (n.invocableCommands ?? []).includes("location.get"));
        let location: PhoneLocation | undefined;
        if (phone) {
          const raw = (await api.runtime.nodes.invoke({
            nodeId: phone.nodeId,
            command: "location.get",
            params: { desiredAccuracy: "precise", maxAgeMs: 60_000, timeoutMs: 15_000 },
            timeoutMs: 20_000,
          })) as { payload?: unknown; payloadJSON?: string };
          const loc = (raw.payload ?? JSON.parse(raw.payloadJSON ?? "null")) as {
            lat: number;
            lon: number;
            accuracyMeters: number;
            timestamp: string;
          } | null;
          if (loc) {
            location = { lat: loc.lat, lon: loc.lon, accuracyMeters: loc.accuracyMeters, timestampMs: Date.parse(loc.timestamp) };
          }
        }
        return jsonResult(await tryCheckin(location));
      },
    });
  },
});
