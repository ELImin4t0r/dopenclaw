/**
 * Everything that touches the KURT website lives in this file.
 *
 * Login uses a dedicated, persistent browser profile on your laptop
 * (`<stateDir>/kuleuven-library/profile`): you sign in once through KU Leuven
 * SSO yourself, and no password is ever stored by OpenClaw.
 *
 * STATUS: `listReservations` and `checkIn` are not mapped yet. KURT has no
 * public API documentation, so the endpoints must be read from the real site.
 * Run the `kurt_record` tool, click through "My reservations" and a check-in,
 * then use the captured `kurt-capture.md` to fill in the two functions below.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import type { Reservation } from "./checkin.js";

export class KurtNotMappedError extends Error {
  constructor(what: string) {
    super(
      `KURT ${what} is not mapped yet. Run the kurt_record tool once while using the KURT site, then finish extensions/kuleuven-library/src/kurt-site.ts.`,
    );
  }
}

export type KurtSiteOptions = { baseUrl: string; dataDir: string; browserChannel: string };

const INTERACTIVE_TIMEOUT_MS = 10 * 60_000;
const MAX_CAPTURED_BODY_CHARS = 2_000;

export class KurtSite {
  constructor(private readonly options: KurtSiteOptions) {}

  private async open(headless: boolean): Promise<BrowserContext> {
    await fs.mkdir(this.options.dataDir, { recursive: true });
    return await chromium.launchPersistentContext(path.join(this.options.dataDir, "profile"), {
      channel: this.options.browserChannel,
      headless,
    });
  }

  /** Waits until you close the window, or 10 minutes. */
  private async untilClosed(context: BrowserContext): Promise<void> {
    await Promise.race([
      new Promise<void>((resolve) => context.once("close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, INTERACTIVE_TIMEOUT_MS)),
    ]);
    await context.close().catch(() => {});
  }

  /** Opens a visible browser on the laptop so you can sign in through KU Leuven SSO. */
  async login(): Promise<void> {
    const context = await this.open(false);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(this.options.baseUrl);
    await this.untilClosed(context);
  }

  /**
   * Opens a visible browser and records every JSON response KURT's pages load
   * (method, URL, status, start of the body) into `kurt-capture.md`. Request
   * headers and cookies are never written. The file stays on your laptop.
   */
  async record(): Promise<string> {
    const out = path.join(this.options.dataDir, "kurt-capture.md");
    const entries: string[] = [`# KURT capture ${new Date().toISOString()}`, ""];
    const context = await this.open(false);
    context.on("response", (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("json")) {
        return;
      }
      const request = response.request();
      void response
        .text()
        .then((body) => {
          entries.push(
            `## ${request.method()} ${response.url()} → ${response.status()}`,
            "",
            "```json",
            body.slice(0, MAX_CAPTURED_BODY_CHARS),
            "```",
            "",
          );
        })
        .catch(() => {});
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(this.options.baseUrl);
    await this.untilClosed(context);
    await fs.writeFile(out, entries.join("\n"), "utf8");
    return out;
  }

  async listReservations(): Promise<Reservation[]> {
    throw new KurtNotMappedError("reservation listing");
  }

  async checkIn(_reservation: Reservation): Promise<void> {
    throw new KurtNotMappedError("check-in");
  }
}
