/**
 * Plain-markdown storage under `<workspace>/personal/`. Everything the briefing
 * knows lives in files you can open and edit yourself:
 *
 * - `personal/todo.md`: `- [ ] task` lines (checked items are ignored).
 * - `personal/alerts/<source>.md`: `- YYYY-MM-DD HH:MM | Title | optional body`
 *   lines. Any plugin (or you) can drop a file here to get notifications;
 *   `manual.md` is where chat reminders go.
 *
 * Times are local wall-clock time of the machine running the Gateway.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type Alert = { source: string; atMs: number; title: string; body: string };

const ALERT_LINE = /^- (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) \| ([^|]+?)(?: \| (.+))?$/;
const TODO_LINE = /^- \[ \] (.+)$/;

export function personalDir(workspaceDir: string): string {
  return path.join(workspaceDir, "personal");
}

export function parseAlerts(source: string, markdown: string): Alert[] {
  const alerts: Alert[] = [];
  for (const line of markdown.split("\n")) {
    const m = ALERT_LINE.exec(line.trim());
    if (!m) {
      continue;
    }
    const [, y, mo, d, h, mi, title, body] = m;
    const atMs = new Date(+y, +mo - 1, +d, +h, +mi).getTime();
    alerts.push({ source, atMs, title: title.trim(), body: body?.trim() ?? "" });
  }
  return alerts;
}

export function parseTodos(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => TODO_LINE.exec(line.trim())?.[1]?.trim())
    .filter((todo): todo is string => Boolean(todo));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatAlertLine(atMs: number, title: string, body?: string): string {
  const clean = (s: string) => s.replace(/[|\n]/g, " ").trim();
  return `- ${formatLocal(atMs)} | ${clean(title)}${body ? ` | ${clean(body)}` : ""}`;
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

export async function readAllAlerts(workspaceDir: string): Promise<Alert[]> {
  const dir = path.join(personalDir(workspaceDir), "alerts");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const lists = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) =>
        parseAlerts(name.slice(0, -3), await fs.readFile(path.join(dir, name), "utf8")),
      ),
  );
  return lists.flat();
}

export async function readTodos(workspaceDir: string): Promise<string[]> {
  return parseTodos(await readIfExists(path.join(personalDir(workspaceDir), "todo.md")));
}

async function appendLine(file: string, header: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await readIfExists(file);
  const prefix = existing ? (existing.endsWith("\n") ? "" : "\n") : `${header}\n\n`;
  await fs.appendFile(file, `${prefix}${line}\n`, "utf8");
}

export async function appendManualAlert(
  workspaceDir: string,
  atMs: number,
  title: string,
  body?: string,
): Promise<string> {
  const line = formatAlertLine(atMs, title, body);
  await appendLine(
    path.join(personalDir(workspaceDir), "alerts", "manual.md"),
    "# Reminders\n\nFormat: `- YYYY-MM-DD HH:MM | Title | optional body`",
    line,
  );
  return line;
}

export async function appendTodo(workspaceDir: string, text: string): Promise<string> {
  const line = `- [ ] ${text.replace(/\n/g, " ").trim()}`;
  await appendLine(path.join(personalDir(workspaceDir), "todo.md"), "# To do", line);
  return line;
}
