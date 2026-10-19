/**
 * Local video work with yt-dlp, ffmpeg and (optionally) whisper.cpp. Nothing
 * here uploads anything; files stay under `<stateDir>/clipper/`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseLoudness } from "./highlights.js";

const run = promisify(execFile);
const BIG = { maxBuffer: 256 * 1024 * 1024 };

async function tool(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(bin, args, BIG);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`'${bin}' is not installed. Run: brew install ${bin === "whisper-cli" ? "whisper-cpp" : bin}`);
    }
    throw err;
  }
}

/** Newest VOD URLs for a YouTube channel or Kick channel. */
export async function latestVideos(channelUrl: string, limit: number): Promise<string[]> {
  const { stdout } = await tool("yt-dlp", [
    "--flat-playlist",
    "--playlist-end",
    String(limit),
    "--print",
    "url",
    channelUrl,
  ]);
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

export async function downloadAudio(url: string, outBase: string): Promise<string> {
  await tool("yt-dlp", ["-f", "bestaudio", "-o", `${outBase}.%(ext)s`, "--no-playlist", url]);
  const dir = path.dirname(outBase);
  const name = (await fs.readdir(dir)).find((f) => f.startsWith(path.basename(outBase)));
  if (!name) {
    throw new Error(`yt-dlp produced no audio for ${url}`);
  }
  return path.join(dir, name);
}

/** One RMS loudness value per second of audio. */
export async function loudnessPerSecond(audioFile: string): Promise<number[]> {
  const { stdout } = await tool("ffmpeg", [
    "-hide_banner",
    "-i",
    audioFile,
    "-af",
    "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f",
    "null",
    "-",
  ]);
  return parseLoudness(stdout);
}

/** Downloads a whole short clip, or one section of a long VOD (no full-VOD download). */
export async function downloadVideo(
  url: string,
  outFile: string,
  section?: { startSec: number; durationSec: number },
): Promise<string> {
  const args = ["-f", "bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "-o", outFile, "--no-playlist"];
  if (section) {
    args.push("--download-sections", `*${section.startSec}-${section.startSec + section.durationSec}`);
  }
  await tool("yt-dlp", [...args, url]);
  return outFile;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function captions(inFile: string, whisperModel: string): Promise<string> {
  const wav = inFile.replace(/\.mp4$/, ".wav");
  await tool("ffmpeg", ["-y", "-hide_banner", "-i", inFile, "-ar", "16000", "-ac", "1", wav]);
  const base = inFile.replace(/\.mp4$/, "");
  await tool("whisper-cli", ["-m", whisperModel, "-f", wav, "-osrt", "-of", base]);
  await fs.rm(wav, { force: true });
  return `${base}.srt`;
}

/**
 * 1080x1920 vertical clip: the original video centered over a blurred, zoomed
 * copy of itself, with burned-in captions when a whisper model is configured.
 */
export async function renderVertical(params: {
  inFile: string;
  outFile: string;
  maxSeconds: number;
  whisperModel?: string;
}): Promise<string> {
  const srt = params.whisperModel ? await captions(params.inFile, params.whisperModel) : undefined;
  const layout =
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];" +
    "[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2";
  const subtitles = srt
    ? `,subtitles='${escapeFilterPath(srt)}':force_style='FontName=Arial,FontSize=14,Bold=1,Outline=2,Alignment=2,MarginV=60'`
    : "";
  await tool("ffmpeg", [
    "-y",
    "-hide_banner",
    "-i",
    params.inFile,
    "-t",
    String(params.maxSeconds),
    "-filter_complex",
    `${layout}${subtitles}[v]`,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "21",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    params.outFile,
  ]);
  return params.outFile;
}
