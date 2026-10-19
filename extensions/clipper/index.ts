/**
 * Clipper: highlights from streamers you're allowed to clip → vertical,
 * captioned clips on this laptop → your approval in chat → scheduled posts to
 * YouTube Shorts, TikTok and Instagram Reels through their official APIs.
 *
 * Everything is markdown under `<workspace>/personal/clips/`:
 *   streamers.md   who to clip (each line must say how you're allowed to)
 *   queue.md       every clip and its status
 *   videos/        the rendered clips
 *
 * Accounts are never created automatically. You create them and connect each
 * one once with `clips_connect`.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { Type } from "typebox";
import { dueSlots, isSameLocalDay, pickHighlights } from "./src/highlights.js";
import { downloadAudio, downloadVideo, latestVideos, loudnessPerSecond, renderVertical } from "./src/media.js";
import {
  authUrl,
  connectedPlatforms,
  finishConnect,
  PLATFORMS,
  TokenStore,
  twitchTopClips,
  upload,
  type Platform,
  type PlatformCredentials,
} from "./src/platforms.js";
import { formatQueue, parseQueue, parseStreamers, shortTitle, type Clip, type Streamer } from "./src/queue.js";

type ClipperConfig = PlatformCredentials & {
  postingTimes: string[];
  findEveryHours: number;
  clipsPerStreamer: number;
  clipSeconds: number;
  whisperModel?: string;
  twitch?: { clientId?: string; clientSecret?: string };
};

function resolveConfig(raw: unknown): ClipperConfig {
  const cfg = (raw ?? {}) as Partial<ClipperConfig>;
  return {
    ...cfg,
    postingTimes: cfg.postingTimes ?? ["12:00", "17:00", "21:00"],
    findEveryHours: cfg.findEveryHours ?? 6,
    clipsPerStreamer: cfg.clipsPerStreamer ?? 3,
    clipSeconds: cfg.clipSeconds ?? 45,
  };
}

const POST_TICK_MS = 5 * 60_000;
const TWITCH_LOOKBACK_MS = 7 * 86_400_000;

function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default definePluginEntry({
  id: "clipper",
  name: "Clipper",
  description: "Clip streamers you may clip and post approved clips to Shorts, TikTok and Reels",
  configSchema: { parse: resolveConfig },
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    let state: { workspaceDir: string; workDir: string; tokens: TokenStore } | undefined;
    const connectStates = new Map<Platform, string>();
    // One writer at a time for queue.md (service ticks and chat tools).
    let queueLock: Promise<unknown> = Promise.resolve();
    let finding: Promise<unknown> | undefined;

    const requireState = () => {
      if (!state) {
        throw new Error("clipper service is not running");
      }
      return state;
    };
    const clipsDir = (...parts: string[]) => path.join(requireState().workspaceDir, "personal", "clips", ...parts);

    async function readText(file: string): Promise<string> {
      try {
        return await fs.readFile(file, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return "";
        }
        throw err;
      }
    }

    function withQueue<T>(fn: (clips: Clip[]) => Promise<T>): Promise<T> {
      const next = queueLock.then(async () => {
        const clips = parseQueue(await readText(clipsDir("queue.md")));
        const result = await fn(clips);
        await fs.mkdir(clipsDir(), { recursive: true });
        await fs.writeFile(clipsDir("queue.md"), formatQueue(clips), "utf8");
        return result;
      });
      queueLock = next.catch(() => {});
      return next;
    }

    async function notify(title: string, body: string): Promise<void> {
      // Picked up by the daily-briefing plugin and shown on the phone.
      const alerts = path.join(requireState().workspaceDir, "personal", "alerts");
      await fs.mkdir(alerts, { recursive: true });
      await fs.writeFile(
        path.join(alerts, "clipper.md"),
        `# Clipper notices (overwritten)\n\n- ${localStamp(Date.now() + 60_000)} | ${title} | ${body}\n`,
        "utf8",
      );
    }

    async function clipsForStreamer(s: Streamer, known: Set<string>): Promise<Clip[]> {
      const { workDir } = requireState();
      const out: Clip[] = [];
      const render = async (id: string, rawFile: string, title: string, sourceUrl: string) => {
        const file = clipsDir("videos", `${id}.mp4`);
        await fs.mkdir(clipsDir("videos"), { recursive: true });
        await renderVertical({ inFile: rawFile, outFile: file, maxSeconds: config.clipSeconds, whisperModel: config.whisperModel });
        await fs.rm(rawFile, { force: true });
        out.push({ status: "pending", id, streamer: s.name, title, file, sourceUrl, posted: "" });
      };
      if (s.kind === "twitch") {
        const top = await twitchTopClips(config.twitch, s.handle, Date.now() - TWITCH_LOOKBACK_MS, 20);
        for (const clip of top.filter((c) => !known.has(`tw-${c.id}`)).slice(0, config.clipsPerStreamer)) {
          const id = `tw-${clip.id}`;
          await render(id, await downloadVideo(clip.url, path.join(workDir, `${id}.raw.mp4`)), clip.title, clip.url);
        }
        return out;
      }
      const channel = s.kind === "kick" ? `https://kick.com/${s.handle}/videos` : s.handle;
      const [vod] = await latestVideos(channel, 1);
      if (!vod) {
        return out;
      }
      const vodKey = `vod-${Buffer.from(vod).toString("base64url").slice(-12)}`;
      if ([...known].some((id) => id.startsWith(vodKey))) {
        return out; // this VOD was already clipped
      }
      const audio = await downloadAudio(vod, path.join(workDir, `${vodKey}.audio`));
      const starts = pickHighlights(await loudnessPerSecond(audio), {
        windowSec: config.clipSeconds,
        count: config.clipsPerStreamer,
        minGapSec: 120,
      });
      await fs.rm(audio, { force: true });
      for (const [n, startSec] of starts.entries()) {
        const id = `${vodKey}-${n + 1}`;
        const raw = await downloadVideo(vod, path.join(workDir, `${id}.raw.mp4`), {
          startSec,
          durationSec: config.clipSeconds,
        });
        const at = `${Math.floor(startSec / 60)}:${String(startSec % 60).padStart(2, "0")}`;
        await render(id, raw, `${s.name} moment ${n + 1}`, `${vod}#t=${at}`);
      }
      return out;
    }

    async function findClips(): Promise<{ added: number; errors: string[]; skipped: string[] }> {
      const { streamers, skipped } = parseStreamers(await readText(clipsDir("streamers.md")));
      if (streamers.length === 0) {
        throw new Error(
          "No streamers to clip. Add lines to personal/clips/streamers.md like: `- Name | twitch:login | permission: clipping program / streamer said OK`",
        );
      }
      const known = new Set((await withQueue(async (clips) => clips)).map((c) => c.id));
      const added: Clip[] = [];
      const errors: string[] = [];
      for (const s of streamers) {
        try {
          added.push(...(await clipsForStreamer(s, known)));
        } catch (err) {
          errors.push(`${s.name}: ${formatErrorMessage(err)}`);
        }
      }
      await withQueue(async (clips) => {
        clips.push(...added);
      });
      if (added.length > 0) {
        await notify(`${added.length} new clips to review`, "Open dopenclaw › Features › Review clips");
      }
      return { added: added.length, errors, skipped };
    }

    function findOnce() {
      finding ??= findClips().finally(() => {
        finding = undefined;
      });
      return finding as Promise<Awaited<ReturnType<typeof findClips>>>;
    }

    async function postDue(): Promise<string[]> {
      const { tokens } = requireState();
      const platforms = await connectedPlatforms(tokens);
      if (platforms.length === 0) {
        return [];
      }
      return await withQueue(async (clips) => {
        const today = new Date();
        const postedToday = clips.filter(
          (c) => c.status === "posted" && isSameLocalDay(new Date(c.posted.slice(0, 16).replace(" ", "T")), today),
        ).length;
        const results: string[] = [];
        for (let slot = dueSlots(Date.now(), config.postingTimes, postedToday); slot > 0; slot--) {
          const clip = clips.find((c) => c.status === "approved");
          if (!clip) {
            break;
          }
          const ok: string[] = [];
          const failed: string[] = [];
          for (const platform of platforms) {
            try {
              const id = await upload(platform, config, tokens, {
                file: clip.file,
                title: shortTitle(clip),
                caption: `${clip.title} 🎮 ${clip.streamer}\n\nSource: ${clip.sourceUrl}\n#${clip.streamer.replace(/\W/g, "")} #shorts #clips`,
              });
              ok.push(`${platform}=${id}`);
            } catch (err) {
              failed.push(`${platform}: ${formatErrorMessage(err)}`);
            }
          }
          clip.status = ok.length > 0 ? "posted" : "failed";
          clip.posted = `${localStamp(Date.now())} ${ok.join(" ")}${failed.length ? ` errors: ${failed.join("; ")}` : ""}`;
          results.push(`${clip.id}: ${clip.posted}`);
        }
        return results;
      });
    }

    api.registerService({
      id: "clipper",
      apiVersion: 2,
      start: async (ctx) => {
        if (!ctx.workspaceDir || !ctx.scheduler) {
          throw new Error("clipper needs a workspace and the v2 service scheduler");
        }
        const base = path.join(ctx.stateDir, "clipper");
        state = {
          workspaceDir: ctx.workspaceDir,
          workDir: path.join(base, "work"),
          tokens: new TokenStore(path.join(base, "tokens")),
        };
        await fs.mkdir(state.workDir, { recursive: true });
        ctx.scheduler.schedule({
          id: "post",
          delayMs: POST_TICK_MS,
          everyMs: POST_TICK_MS,
          run: async () => {
            try {
              const posted = await postDue();
              if (posted.length > 0) {
                ctx.logger.info(`clipper: posted ${posted.length} clip(s)`);
              }
            } catch (err) {
              ctx.logger.warn(`clipper: posting failed: ${formatErrorMessage(err)}`);
            }
          },
        });
        const findMs = config.findEveryHours * 3_600_000;
        ctx.scheduler.schedule({
          id: "find",
          delayMs: findMs,
          everyMs: findMs,
          run: async () => {
            try {
              const { added, errors } = await findOnce();
              ctx.logger.info(`clipper: ${added} new clip(s)${errors.length ? `; errors: ${errors.join(" | ")}` : ""}`);
            } catch (err) {
              ctx.logger.warn(`clipper: ${formatErrorMessage(err)}`);
            }
          },
        });
      },
      async stop() {
        state = undefined;
      },
    });

    api.registerTool({
      name: "clips_find",
      label: "Find clips",
      description:
        "Find highlights for the streamers in personal/clips/streamers.md, cut them into vertical captioned clips and add them to the review queue. Can take several minutes.",
      parameters: Type.Object({}),
      async execute() {
        return jsonResult(await findOnce());
      },
    });

    api.registerTool({
      name: "clips_review",
      label: "Review clips",
      description:
        "List clips waiting for approval. In your reply, show each clip's id and title and put its `media` value on its own line so the user can watch it, then ask which to approve.",
      parameters: Type.Object({}),
      async execute() {
        const clips = await withQueue(async (all) => all.filter((c) => c.status === "pending"));
        return jsonResult({
          pending: clips.map((c) => ({ id: c.id, streamer: c.streamer, title: c.title, source: c.sourceUrl, media: `MEDIA:${c.file}` })),
        });
      },
    });

    api.registerTool({
      name: "clips_approve",
      label: "Approve clips",
      description:
        "Approve clips for posting (optionally with a better title). Approved clips post at the next posting times to every connected platform.",
      parameters: Type.Object({
        ids: Type.Array(Type.String()),
        title: Type.Optional(Type.String({ description: "New title, only when approving a single clip." })),
      }),
      async execute(_id: string, args: unknown) {
        const { ids, title } = args as { ids: string[]; title?: string };
        return jsonResult(
          await withQueue(async (clips) => {
            const hit = clips.filter((c) => ids.includes(c.id) && (c.status === "pending" || c.status === "failed"));
            for (const c of hit) {
              c.status = "approved";
              if (title && ids.length === 1) {
                c.title = title;
              }
            }
            return { approved: hit.map((c) => c.id), postingTimes: config.postingTimes };
          }),
        );
      },
    });

    api.registerTool({
      name: "clips_reject",
      label: "Reject clips",
      description: "Reject clips so they are never posted, and delete their video files.",
      parameters: Type.Object({ ids: Type.Array(Type.String()) }),
      async execute(_id: string, args: unknown) {
        const { ids } = args as { ids: string[] };
        return jsonResult(
          await withQueue(async (clips) => {
            const hit = clips.filter((c) => ids.includes(c.id) && c.status !== "posted");
            for (const c of hit) {
              c.status = "rejected";
              await fs.rm(c.file, { force: true });
            }
            return { rejected: hit.map((c) => c.id) };
          }),
        );
      },
    });

    api.registerTool({
      name: "clips_status",
      label: "Clip status",
      description: "Show connected platforms, posting times, and counts of pending / approved / posted / failed clips with the latest posts.",
      parameters: Type.Object({}),
      async execute() {
        const clips = await withQueue(async (all) => all);
        const count = (s: Clip["status"]) => clips.filter((c) => c.status === s).length;
        const connected = await connectedPlatforms(requireState().tokens);
        return jsonResult({
          connected,
          notConnected: PLATFORMS.filter((p) => !connected.includes(p)),
          postingTimes: config.postingTimes,
          pending: count("pending"),
          approved: count("approved"),
          posted: count("posted"),
          failed: clips.filter((c) => c.status === "failed").map((c) => ({ id: c.id, why: c.posted })),
          latest: clips.filter((c) => c.status === "posted").slice(-5).map((c) => ({ id: c.id, title: c.title, posted: c.posted })),
        });
      },
    });

    api.registerTool({
      name: "clips_connect",
      label: "Connect account",
      description:
        "Connect a YouTube, TikTok or Instagram account the user already created. Call without redirectedUrl to get a sign-in link; the user signs in, then pastes the URL their browser ended on, and you call again with it.",
      parameters: Type.Object({
        platform: Type.Union([Type.Literal("youtube"), Type.Literal("tiktok"), Type.Literal("instagram")]),
        redirectedUrl: Type.Optional(Type.String()),
      }),
      async execute(_id: string, args: unknown) {
        const { platform, redirectedUrl } = args as { platform: Platform; redirectedUrl?: string };
        if (!redirectedUrl) {
          const stateToken = randomUUID();
          connectStates.set(platform, stateToken);
          return jsonResult({
            signInUrl: authUrl(platform, config, stateToken),
            next: "Open the link, approve access, then paste the full URL your browser lands on (even if the page shows an error).",
          });
        }
        const expected = connectStates.get(platform);
        if (!expected) {
          throw new Error("Start again without redirectedUrl to get a fresh sign-in link.");
        }
        const message = await finishConnect(platform, config, redirectedUrl, expected, requireState().tokens);
        connectStates.delete(platform);
        return jsonResult({ ok: true, message });
      },
    });
  },
});
