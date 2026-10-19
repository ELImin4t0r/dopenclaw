/**
 * Writes the alert-line format read by the daily-briefing plugin:
 * `- YYYY-MM-DD HH:MM | Title | optional body` (local time).
 * Plugins may not import each other, so this mirrors daily-briefing/src/markdown.ts.
 */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatAlertLine(atMs: number, title: string, body?: string): string {
  const d = new Date(atMs);
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const clean = (s: string) => s.replace(/[|\n]/g, " ").trim();
  return `- ${when} | ${clean(title)}${body ? ` | ${clean(body)}` : ""}`;
}
