/**
 * Daily Briefing: calendar "starting soon" alerts, reminders and a morning
 * briefing, all computed on your laptop and delivered as local notifications.
 *
 * - The iPhone app calls `briefing.notifications` whenever it connects or
 *   wakes, and schedules the returned list on the phone itself (no push relay).
 * - The Mac app gets the same alerts live through `system.notify`.
 * - Tools `reminder_add` and `todo_add` let you add things from chat; they
 *   write to markdown under `<workspace>/personal/`.
 */
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { Type } from "typebox";
import { appendManualAlert, appendTodo, readAllAlerts, readTodos } from "./src/markdown.js";
import { notifyDesktops, readPhoneData, type PhoneData } from "./src/phone.js";
import { buildSchedule, type ScheduledNotification } from "./src/schedule.js";

type BriefingConfig = { eventLeadMinutes: number; briefingTime: string; horizonHours: number };

function resolveConfig(raw: unknown): BriefingConfig {
  const cfg = (raw ?? {}) as Partial<BriefingConfig>;
  return {
    eventLeadMinutes: cfg.eventLeadMinutes ?? 15,
    briefingTime: cfg.briefingTime ?? "08:00",
    horizonHours: cfg.horizonHours ?? 48,
  };
}

const TICK_MS = 60_000;
const PHONE_REFRESH_MS = 15 * 60_000;

export default definePluginEntry({
  id: "daily-briefing",
  name: "Daily Briefing",
  description: "Calendar alerts, reminders and a morning briefing as local notifications",
  configSchema: { parse: resolveConfig },
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const horizonMs = config.horizonHours * 3_600_000;
    let workspaceDir: string | undefined;
    // Last calendar/reminders read from the phone, so the Mac still gets
    // alerts while the phone is disconnected.
    let phoneCache: PhoneData = { events: [], reminders: [] };
    let phoneCacheAtMs = 0;

    const requireWorkspace = () => {
      if (!workspaceDir) {
        throw new Error("daily-briefing service is not running");
      }
      return workspaceDir;
    };

    async function refreshPhone(nowMs: number): Promise<void> {
      const data = await readPhoneData(api.runtime, nowMs, horizonMs);
      if (data) {
        phoneCache = data;
        phoneCacheAtMs = nowMs;
      }
    }

    async function schedule(nowMs: number): Promise<ScheduledNotification[]> {
      const dir = requireWorkspace();
      const [alerts, todos] = await Promise.all([readAllAlerts(dir), readTodos(dir)]);
      return buildSchedule({
        nowMs,
        ...phoneCache,
        alerts,
        todos,
        eventLeadMinutes: config.eventLeadMinutes,
        briefingTime: config.briefingTime,
        horizonMs,
      });
    }

    api.registerGatewayMethod(
      "briefing.notifications",
      async ({ respond }: GatewayRequestHandlerOptions) => {
        try {
          const nowMs = Date.now();
          await refreshPhone(nowMs);
          respond(true, { notifications: await schedule(nowMs) });
        } catch (err) {
          const message = formatErrorMessage(err);
          respond(false, { error: message }, errorShape(ErrorCodes.UNAVAILABLE, message));
        }
      },
      { scope: "operator.write" },
    );

    api.registerService({
      id: "daily-briefing",
      apiVersion: 2,
      start: async (ctx) => {
        if (!ctx.workspaceDir || !ctx.scheduler) {
          throw new Error("daily-briefing needs a workspace and the v2 service scheduler");
        }
        workspaceDir = ctx.workspaceDir;
        let lastTickMs = ctx.scheduler.now();
        ctx.scheduler.schedule({
          id: "tick",
          delayMs: TICK_MS,
          everyMs: TICK_MS,
          run: async () => {
            const nowMs = ctx.scheduler!.now();
            try {
              if (nowMs - phoneCacheAtMs >= PHONE_REFRESH_MS) {
                await refreshPhone(nowMs);
              }
              const due = (await schedule(lastTickMs)).filter((n) => n.atMs <= nowMs);
              for (const n of due) {
                await notifyDesktops(api.runtime, n.title, n.body);
              }
            } catch (err) {
              ctx.logger.warn(`daily-briefing: ${formatErrorMessage(err)}`);
            } finally {
              lastTickMs = nowMs;
            }
          },
        });
      },
      async stop() {
        workspaceDir = undefined;
      },
    });

    api.registerTool({
      name: "reminder_add",
      label: "Add reminder",
      description:
        "Schedule a reminder notification on the user's phone and Mac at a specific local time. Use for 'remind me at/in …'.",
      parameters: Type.Object({
        at: Type.String({ description: "Local date-time, e.g. 2026-10-20T15:30 (no timezone = local time)." }),
        title: Type.String(),
        body: Type.Optional(Type.String()),
      }),
      async execute(_id: string, args: unknown) {
        const { at, title, body } = args as { at: string; title: string; body?: string };
        const atMs = Date.parse(at);
        if (Number.isNaN(atMs)) {
          throw new Error(`Invalid date-time: ${at}`);
        }
        const line = await appendManualAlert(requireWorkspace(), atMs, title, body);
        return jsonResult({ saved: line, note: "The phone picks this up the next time it syncs." });
      },
    });

    api.registerTool({
      name: "todo_add",
      label: "Add to-do",
      description: "Add an item to the user's to-do list (shown in the morning briefing).",
      parameters: Type.Object({ text: Type.String() }),
      async execute(_id: string, args: unknown) {
        const { text } = args as { text: string };
        return jsonResult({ saved: await appendTodo(requireWorkspace(), text) });
      },
    });
  },
});
