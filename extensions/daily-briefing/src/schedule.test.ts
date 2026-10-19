import { describe, expect, it } from "vitest";
import { formatAlertLine, parseAlerts, parseTodos } from "./markdown.js";
import { buildSchedule, MAX_NOTIFICATIONS, type ScheduleInput } from "./schedule.js";

const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const NOW = local(2026, 10, 20, 9, 0);

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    nowMs: NOW,
    events: [],
    reminders: [],
    alerts: [],
    todos: [],
    eventLeadMinutes: 15,
    briefingTime: "08:00",
    horizonMs: 48 * 3_600_000,
    ...overrides,
  };
}

describe("markdown", () => {
  it("parses alert lines and ignores everything else", () => {
    const alerts = parseAlerts(
      "kurt",
      "# Reservations\n\n- 2026-10-20 13:30 | Agora seat 12 | Check in now\n- 2026-10-21 08:00 | Gym\nrandom text\n",
    );
    expect(alerts).toEqual([
      { source: "kurt", atMs: local(2026, 10, 20, 13, 30), title: "Agora seat 12", body: "Check in now" },
      { source: "kurt", atMs: local(2026, 10, 21, 8, 0), title: "Gym", body: "" },
    ]);
  });

  it("round-trips formatAlertLine and strips separators", () => {
    const line = formatAlertLine(local(2026, 10, 20, 7, 5), "Call | mom", "now");
    expect(line).toBe("- 2026-10-20 07:05 | Call   mom | now");
    expect(parseAlerts("m", line)[0]?.atMs).toBe(local(2026, 10, 20, 7, 5));
  });

  it("keeps only open to-dos", () => {
    expect(parseTodos("# To do\n- [ ] buy milk\n- [x] done thing\n- [ ]  read paper \n")).toEqual([
      "buy milk",
      "read paper",
    ]);
  });
});

describe("buildSchedule", () => {
  it("alerts ahead of timed events and skips all-day events", () => {
    const items = buildSchedule(
      input({
        events: [
          {
            identifier: "e1",
            title: "Lecture",
            startISO: new Date(local(2026, 10, 20, 10, 0)).toISOString(),
            endISO: new Date(local(2026, 10, 20, 12, 0)).toISOString(),
            isAllDay: false,
            location: "Aula",
          },
          {
            identifier: "e2",
            title: "Holiday",
            startISO: new Date(local(2026, 10, 21, 0, 0)).toISOString(),
            endISO: new Date(local(2026, 10, 22, 0, 0)).toISOString(),
            isAllDay: true,
          },
        ],
      }),
    );
    const lecture = items.find((i) => i.id.startsWith("event:e1"));
    expect(lecture).toMatchObject({ atMs: local(2026, 10, 20, 9, 45), body: "Starts at 10:00 · Aula" });
    expect(items.some((i) => i.id.startsWith("event:e2"))).toBe(false);
    const tomorrow = items.find((i) => i.id === "briefing:2026-10-21");
    expect(tomorrow?.body).toContain("Holiday (all day)");
  });

  it("drops past items and today's briefing once it has passed", () => {
    const items = buildSchedule(
      input({ alerts: [{ source: "m", atMs: NOW - 1, title: "old", body: "" }] }),
    );
    expect(items.map((i) => i.id)).toEqual(["briefing:2026-10-21", "briefing:2026-10-22"]);
    expect(items[0]?.atMs).toBe(local(2026, 10, 21, 8, 0));
  });

  it("lists to-dos and due reminders in the briefing", () => {
    const items = buildSchedule(
      input({
        todos: ["a", "b", "c", "d", "e", "f", "g"],
        reminders: [
          {
            identifier: "r1",
            title: "Pay rent",
            dueISO: new Date(local(2026, 10, 21, 18, 0)).toISOString(),
            completed: false,
          },
        ],
      }),
    );
    const briefing = items.find((i) => i.id === "briefing:2026-10-21");
    expect(briefing?.body).toContain("• Due: Pay rent");
    expect(briefing?.body).toContain("☐ e");
    expect(briefing?.body).not.toContain("☐ f");
    expect(briefing?.body).toContain("… and 2 more to-dos");
    expect(items.some((i) => i.id === "reminder:r1")).toBe(true);
  });

  it("caps the list for the iOS pending-notification limit", () => {
    const alerts = Array.from({ length: 100 }, (_, n) => ({
      source: "m",
      atMs: NOW + (n + 1) * 60_000,
      title: `a${n}`,
      body: "",
    }));
    const items = buildSchedule(input({ alerts }));
    expect(items).toHaveLength(MAX_NOTIFICATIONS);
    expect(items[0]?.title).toBe("a0");
  });
});
