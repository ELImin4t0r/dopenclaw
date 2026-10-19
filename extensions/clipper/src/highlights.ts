/**
 * Highlight finding for long VODs: the loudest stretches of audio (hype,
 * shouting, big reactions) are usually the clip-worthy moments. Input is one
 * RMS loudness value (dB) per second, as printed by ffmpeg's astats filter.
 */

const SILENCE_DB = -100;

export function parseLoudness(ffmpegOutput: string): number[] {
  return [...ffmpegOutput.matchAll(/RMS_level=(-?[\d.]+|-?inf)/g)].map((m) =>
    m[1].includes("inf") ? SILENCE_DB : Math.max(Number(m[1]), SILENCE_DB),
  );
}

/** Start times (seconds) of the `count` loudest windows, at least `minGapSec` apart, in time order. */
export function pickHighlights(
  levels: number[],
  opts: { windowSec: number; count: number; minGapSec: number },
): number[] {
  const { windowSec, count, minGapSec } = opts;
  if (levels.length < windowSec) {
    return [];
  }
  const scores: Array<{ start: number; score: number }> = [];
  let sum = levels.slice(0, windowSec).reduce((a, b) => a + b, 0);
  scores.push({ start: 0, score: sum });
  for (let start = 1; start + windowSec <= levels.length; start++) {
    sum += levels[start + windowSec - 1] - levels[start - 1];
    scores.push({ start, score: sum });
  }
  scores.sort((a, b) => b.score - a.score);
  const picked: number[] = [];
  for (const { start } of scores) {
    if (picked.length >= count) {
      break;
    }
    if (picked.every((p) => Math.abs(p - start) >= windowSec + minGapSec)) {
      picked.push(start);
    }
  }
  return picked.sort((a, b) => a - b);
}

/** How many posting slots have passed today and are not yet used. */
export function dueSlots(nowMs: number, postingTimes: string[], postedToday: number): number {
  const now = new Date(nowMs);
  const passed = postingTimes.filter((t) => {
    const [h, m] = t.split(":").map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() <= nowMs;
  }).length;
  return Math.max(0, passed - postedToday);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
