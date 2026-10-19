/**
 * The clip queue and streamer list are markdown files under
 * `<workspace>/personal/clips/`, so you can read and edit them yourself.
 *
 * streamers.md:  `- Name | twitch:login | permission: how you're allowed to clip`
 *                sources: `twitch:<login>`, `youtube:<channel URL>`, `kick:<channel>`
 * queue.md:      `- [status] id | streamer | title | file | source URL | posted`
 *                status: pending → approved → posted (or rejected / failed)
 */

export type SourceKind = "twitch" | "youtube" | "kick";
export type Streamer = { name: string; kind: SourceKind; handle: string; permission: string };

export type ClipStatus = "pending" | "approved" | "posted" | "rejected" | "failed";
export type Clip = {
  status: ClipStatus;
  id: string;
  streamer: string;
  title: string;
  file: string;
  sourceUrl: string;
  /** e.g. "2026-10-20 17:00 yt=abc tt=def ig=ghi", or the failure reason. */
  posted: string;
};

const STREAMER_LINE = /^- ([^|]+?) \| (twitch|youtube|kick):(\S+) \| permission: (.+)$/;
const CLIP_LINE = /^- \[(pending|approved|posted|rejected|failed)\] (.*)$/;

export function parseStreamers(markdown: string): { streamers: Streamer[]; skipped: string[] } {
  const streamers: Streamer[] = [];
  const skipped: string[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) {
      continue;
    }
    const m = STREAMER_LINE.exec(line);
    // A source without a stated permission is never clipped.
    if (!m || !m[4].trim()) {
      skipped.push(line);
      continue;
    }
    streamers.push({ name: m[1].trim(), kind: m[2] as SourceKind, handle: m[3], permission: m[4].trim() });
  }
  return { streamers, skipped };
}

const clean = (s: string) => s.replace(/[|\n]/g, " ").replace(/\s+/g, " ").trim();

export function parseQueue(markdown: string): Clip[] {
  const clips: Clip[] = [];
  for (const raw of markdown.split("\n")) {
    const m = CLIP_LINE.exec(raw.trim());
    if (!m) {
      continue;
    }
    const [id, streamer, title, file, sourceUrl, posted] = m[2].split(" | ").map((s) => s.trim());
    if (id && streamer && file) {
      clips.push({
        status: m[1] as ClipStatus,
        id,
        streamer,
        title: title ?? "",
        file,
        sourceUrl: sourceUrl ?? "",
        posted: posted ?? "",
      });
    }
  }
  return clips;
}

export function formatQueue(clips: Clip[]): string {
  const lines = [
    "# Clip queue",
    "",
    "Change `[pending]` to `[approved]` to post a clip, or ask dopenclaw to approve it.",
    "",
  ];
  for (const c of clips) {
    lines.push(
      `- [${c.status}] ${[c.id, c.streamer, c.title, c.file, c.sourceUrl, c.posted].map(clean).join(" | ")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Hashtags + title, within YouTube's 100-char title limit. */
export function shortTitle(clip: Pick<Clip, "title" | "streamer">): string {
  const suffix = ` | ${clip.streamer} #shorts`;
  const room = 100 - suffix.length;
  const title = clip.title.length > room ? `${clip.title.slice(0, room - 1)}…` : clip.title;
  return `${title}${suffix}`;
}
