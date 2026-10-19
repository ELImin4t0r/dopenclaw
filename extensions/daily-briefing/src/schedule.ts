/**
 * Turns calendar events, phone reminders, markdown alerts and to-dos into one
 * list of timed notifications. The iPhone schedules this list locally, so
 * alerts still fire when the laptop is asleep or out of reach.
 */
import type { Alert } from "./markdown.js";

export type CalendarEvent = {
  identifier: string;
  title: string;
  startISO: string;
  endISO: string;
  isAllDay: boolean;
  location?: string;
};

export type PhoneReminder = {
  identifier: string;
  title: string;
  dueISO?: string;
  completed: boolean;
};

export type ScheduledNotification = { id: string; atMs: number; title: string; body: string };

export type ScheduleInput = {
  nowMs: number;
  events: CalendarEvent[];
  reminders: PhoneReminder[];
  alerts: Alert[];
  todos: string[];
  eventLeadMinutes: number;
  /** "HH:MM" local time. */
  briefingTime: string;
  horizonMs: number;
};

/** iOS keeps at most 64 pending local notifications per app; leave headroom. */
export const MAX_NOTIFICATIONS = 60;
const MAX_BRIEFING_TODOS = 5;

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

function briefingFor(dayStartMs: number, input: ScheduleInput): ScheduledNotification {
  const [h, m] = input.briefingTime.split(":").map(Number);
  const day = new Date(dayStartMs);
  const atMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
  const lines: string[] = [];
  const events = input.events
    .filter((e) => sameLocalDay(Date.parse(e.startISO), atMs))
    .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
  for (const e of events) {
    lines.push(e.isAllDay ? `• ${e.title} (all day)` : `• ${hhmm(Date.parse(e.startISO))} ${e.title}`);
  }
  for (const r of input.reminders) {
    if (!r.completed && r.dueISO && sameLocalDay(Date.parse(r.dueISO), atMs)) {
      lines.push(`• Due: ${r.title}`);
    }
  }
  const todos = input.todos.slice(0, MAX_BRIEFING_TODOS);
  for (const t of todos) {
    lines.push(`☐ ${t}`);
  }
  if (input.todos.length > todos.length) {
    lines.push(`… and ${input.todos.length - todos.length} more to-dos`);
  }
  const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
  return {
    id: `briefing:${key}`,
    atMs,
    title: "Today",
    body: lines.length > 0 ? lines.join("\n") : "Nothing planned. Enjoy the day!",
  };
}

export function buildSchedule(input: ScheduleInput): ScheduledNotification[] {
  const leadMs = input.eventLeadMinutes * 60_000;
  const items: ScheduledNotification[] = [];

  for (const e of input.events) {
    if (e.isAllDay) {
      continue; // all-day events go into the briefing instead
    }
    const startMs = Date.parse(e.startISO);
    items.push({
      id: `event:${e.identifier}:${e.startISO}`,
      atMs: startMs - leadMs,
      title: e.title,
      body: `Starts at ${hhmm(startMs)}${e.location ? ` · ${e.location}` : ""}`,
    });
  }
  for (const r of input.reminders) {
    if (!r.completed && r.dueISO) {
      items.push({ id: `reminder:${r.identifier}`, atMs: Date.parse(r.dueISO), title: r.title, body: "Reminder" });
    }
  }
  for (const a of input.alerts) {
    items.push({ id: `alert:${a.source}:${a.atMs}:${a.title}`, atMs: a.atMs, title: a.title, body: a.body });
  }
  for (let dayOffset = 0; dayOffset * 86_400_000 <= input.horizonMs; dayOffset++) {
    items.push(briefingFor(input.nowMs + dayOffset * 86_400_000, input));
  }

  const endMs = input.nowMs + input.horizonMs;
  return items
    .filter((item) => item.atMs > input.nowMs && item.atMs <= endMs)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, MAX_NOTIFICATIONS);
}
