import { describe, expect, it } from "vitest";
import { dueSlots, parseLoudness, pickHighlights } from "./highlights.js";
import { formatQueue, parseQueue, parseStreamers, shortTitle, type Clip } from "./queue.js";

describe("parseStreamers", () => {
  it("requires a stated permission for every source", () => {
    const { streamers, skipped } = parseStreamers(
      [
        "# Streamers",
        "- Jynxzi | twitch:jynxzi | permission: Whop clipping program",
        "- Some YT | youtube:https://www.youtube.com/@someone/videos | permission: emailed OK 2026-10-01",
        "- NoPerm | kick:someone | permission: ",
        "- Broken line",
      ].join("\n"),
    );
    expect(streamers).toEqual([
      { name: "Jynxzi", kind: "twitch", handle: "jynxzi", permission: "Whop clipping program" },
      {
        name: "Some YT",
        kind: "youtube",
        handle: "https://www.youtube.com/@someone/videos",
        permission: "emailed OK 2026-10-01",
      },
    ]);
    expect(skipped).toHaveLength(2);
  });
});

describe("queue markdown", () => {
  it("round-trips clips and strips separators from titles", () => {
    const clips: Clip[] = [
      {
        status: "pending",
        id: "tw-abc",
        streamer: "Jynxzi",
        title: "insane | clutch",
        file: "/tmp/tw-abc.mp4",
        sourceUrl: "https://clips.twitch.tv/abc",
        posted: "",
      },
      {
        status: "posted",
        id: "vod-x-1",
        streamer: "Some YT",
        title: "moment 1",
        file: "/tmp/vod-x-1.mp4",
        sourceUrl: "https://youtu.be/x#t=1:05",
        posted: "2026-10-20 17:00 youtube=yt1 tiktok=tt1",
      },
    ];
    const parsed = parseQueue(formatQueue(clips));
    expect(parsed[0]).toMatchObject({ status: "pending", id: "tw-abc", title: "insane clutch" });
    expect(parsed[1]).toEqual(clips[1]);
  });

  it("keeps titles within YouTube's 100 characters", () => {
    expect(shortTitle({ title: "x".repeat(200), streamer: "Jynxzi" }).length).toBeLessThanOrEqual(100);
  });
});

describe("highlights", () => {
  it("parses ffmpeg astats output including silence", () => {
    expect(
      parseLoudness("frame:0\nlavfi.astats.Overall.RMS_level=-23.5\nframe:1\nlavfi.astats.Overall.RMS_level=-inf\n"),
    ).toEqual([-23.5, -100]);
  });

  it("picks the loudest non-overlapping windows in time order", () => {
    const levels = Array.from({ length: 600 }, () => -40);
    for (let s = 100; s < 130; s++) levels[s] = -10; // loud at 100s
    for (let s = 400; s < 430; s++) levels[s] = -15; // loud at 400s
    for (let s = 110; s < 140; s++) levels[s] = Math.max(levels[s], -12); // overlaps the first
    const picks = pickHighlights(levels, { windowSec: 30, count: 2, minGapSec: 60 });
    expect(picks).toHaveLength(2);
    expect(picks[0]).toBeGreaterThanOrEqual(100);
    expect(picks[0]).toBeLessThanOrEqual(110);
    expect(picks[1]).toBe(400);
  });

  it("returns nothing for audio shorter than one window", () => {
    expect(pickHighlights([-20, -20], { windowSec: 30, count: 3, minGapSec: 60 })).toEqual([]);
  });
});

describe("dueSlots", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime();
  const times = ["12:00", "17:00", "21:00"];

  it("counts passed slots not yet used today", () => {
    expect(dueSlots(at(11, 59), times, 0)).toBe(0);
    expect(dueSlots(at(12, 0), times, 0)).toBe(1);
    expect(dueSlots(at(18), times, 1)).toBe(1);
    expect(dueSlots(at(22), times, 3)).toBe(0);
  });
});
