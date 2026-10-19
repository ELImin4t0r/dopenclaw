import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { CalendarEvent, PhoneReminder } from "./schedule.js";

type Runtime = NonNullable<OpenClawPluginApi["runtime"]>;

/** node.invoke responses wrap the node result in {payload, payloadJSON}. */
export function unwrapInvokePayload<T>(raw: unknown): T {
  const envelope = raw as { payload?: unknown; payloadJSON?: string | null } | undefined;
  if (envelope?.payload && typeof envelope.payload === "object") {
    return envelope.payload as T;
  }
  if (typeof envelope?.payloadJSON === "string" && envelope.payloadJSON.length > 0) {
    return JSON.parse(envelope.payloadJSON) as T;
  }
  throw new Error("node returned no payload");
}

async function findNode(runtime: Runtime, command: string): Promise<string | undefined> {
  const { nodes } = await runtime.nodes.list({ connected: true });
  return nodes.find((n) => (n.invocableCommands ?? n.commands ?? []).includes(command))?.nodeId;
}

export type PhoneData = { events: CalendarEvent[]; reminders: PhoneReminder[] };

/** Reads calendar + reminders from the first connected device that exposes them, or undefined when none is connected. */
export async function readPhoneData(
  runtime: Runtime,
  nowMs: number,
  horizonMs: number,
): Promise<PhoneData | undefined> {
  const nodeId = await findNode(runtime, "calendar.events");
  if (!nodeId) {
    return undefined;
  }
  const calendar = unwrapInvokePayload<{ events: CalendarEvent[] }>(
    await runtime.nodes.invoke({
      nodeId,
      command: "calendar.events",
      params: {
        startISO: new Date(nowMs).toISOString(),
        endISO: new Date(nowMs + horizonMs).toISOString(),
        limit: 100,
      },
      timeoutMs: 15_000,
    }),
  );
  const remindersNode = await findNode(runtime, "reminders.list");
  const reminders = remindersNode
    ? unwrapInvokePayload<{ reminders: PhoneReminder[] }>(
        await runtime.nodes.invoke({
          nodeId: remindersNode,
          command: "reminders.list",
          params: { status: "incomplete", limit: 100 },
          timeoutMs: 15_000,
        }),
      ).reminders
    : [];
  return { events: calendar.events, reminders };
}

/** Desktop nodes (the Mac app) show notifications immediately via system.notify. */
export async function notifyDesktops(runtime: Runtime, title: string, body: string): Promise<void> {
  const { nodes } = await runtime.nodes.list({ connected: true });
  const desktops = nodes.filter(
    (n) => n.platform !== "ios" && (n.invocableCommands ?? []).includes("system.notify"),
  );
  await Promise.all(
    desktops.map((n) =>
      runtime.nodes.invoke({
        nodeId: n.nodeId,
        command: "system.notify",
        params: { title, body, priority: "timeSensitive" },
        timeoutMs: 10_000,
      }),
    ),
  );
}
