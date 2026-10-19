/**
 * Twitch (finding clips) and the three posting platforms, all through their
 * official APIs and your own developer apps. Accounts are never created here:
 * you make each account yourself and connect it once with `clips_connect`.
 *
 * Connecting: `authUrl()` gives a sign-in link. After you approve, the browser
 * lands on the redirect URI (the page itself may fail to load; that's fine).
 * Paste that final URL back and `finishConnect()` exchanges the code. Tokens
 * are stored only on this laptop, in `<stateDir>/clipper/tokens/` (mode 600).
 *
 * Until each platform reviews your developer app, YouTube and TikTok keep API
 * uploads private, and TikTok requires the account itself to be private.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type Platform = "youtube" | "tiktok" | "instagram";
export const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];

export type PlatformCredentials = {
  youtube?: { clientId?: string; clientSecret?: string; redirectUri?: string };
  tiktok?: { clientKey?: string; clientSecret?: string; redirectUri?: string };
  instagram?: { appId?: string; appSecret?: string; redirectUri?: string };
};

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  igUserId?: string;
};

const GRAPH = "https://graph.facebook.com/v21.0";

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${what} failed (${res.status}): ${body.slice(0, 500)}`);
  }
  return JSON.parse(body) as T;
}

function need<T>(value: T | undefined, what: string): T {
  if (!value) {
    throw new Error(`Missing ${what} in plugins.entries.clipper.config (see PERSONAL.md › Clipping).`);
  }
  return value;
}

// ---------- Twitch (read-only: find popular clips) ----------

export type TwitchClip = { id: string; url: string; title: string; view_count: number; created_at: string };

export async function twitchTopClips(
  creds: { clientId?: string; clientSecret?: string } | undefined,
  login: string,
  sinceMs: number,
  limit: number,
): Promise<TwitchClip[]> {
  const clientId = need(creds?.clientId, "twitch.clientId");
  const token = await json<{ access_token: string }>(
    await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: need(creds?.clientSecret, "twitch.clientSecret"),
        grant_type: "client_credentials",
      }),
    }),
    "Twitch token",
  );
  const headers = { "Client-Id": clientId, Authorization: `Bearer ${token.access_token}` };
  const users = await json<{ data: Array<{ id: string }> }>(
    await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers }),
    "Twitch user lookup",
  );
  const broadcasterId = users.data[0]?.id;
  if (!broadcasterId) {
    throw new Error(`Twitch user '${login}' not found`);
  }
  const clips = await json<{ data: TwitchClip[] }>(
    await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&started_at=${new Date(sinceMs).toISOString()}&first=${limit}`,
      { headers },
    ),
    "Twitch clips",
  );
  return clips.data.sort((a, b) => b.view_count - a.view_count);
}

// ---------- token storage ----------

export class TokenStore {
  constructor(private readonly dir: string) {}

  private file(platform: Platform) {
    return path.join(this.dir, `${platform}.json`);
  }

  async get(platform: Platform): Promise<StoredToken | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.file(platform), "utf8")) as StoredToken;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  async set(platform: Platform, token: StoredToken): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(platform), JSON.stringify(token), { mode: 0o600 });
  }
}

// ---------- connect (OAuth) ----------

export function authUrl(platform: Platform, creds: PlatformCredentials, state: string): string {
  switch (platform) {
    case "youtube": {
      const c = creds.youtube;
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: need(c?.clientId, "youtube.clientId"),
        redirect_uri: need(c?.redirectUri, "youtube.redirectUri"),
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload",
        access_type: "offline",
        prompt: "consent",
        state,
      })}`;
    }
    case "tiktok": {
      const c = creds.tiktok;
      return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
        client_key: need(c?.clientKey, "tiktok.clientKey"),
        redirect_uri: need(c?.redirectUri, "tiktok.redirectUri"),
        response_type: "code",
        scope: "user.info.basic,video.publish",
        state,
      })}`;
    }
    case "instagram": {
      const c = creds.instagram;
      return `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({
        client_id: need(c?.appId, "instagram.appId"),
        redirect_uri: need(c?.redirectUri, "instagram.redirectUri"),
        response_type: "code",
        scope: "instagram_basic,instagram_content_publish,pages_show_list,business_management",
        state,
      })}`;
    }
  }
}

export async function finishConnect(
  platform: Platform,
  creds: PlatformCredentials,
  redirectedUrl: string,
  expectedState: string,
  store: TokenStore,
): Promise<string> {
  const url = new URL(redirectedUrl.trim());
  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error(`No 'code' in that URL. Error from ${platform}: ${url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "none"}`);
  }
  if (url.searchParams.get("state") !== expectedState) {
    throw new Error("This sign-in link is from an older attempt. Start clips_connect again.");
  }
  const now = Date.now();
  switch (platform) {
    case "youtube": {
      const c = creds.youtube;
      const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
        await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          body: new URLSearchParams({
            code,
            client_id: need(c?.clientId, "youtube.clientId"),
            client_secret: need(c?.clientSecret, "youtube.clientSecret"),
            redirect_uri: need(c?.redirectUri, "youtube.redirectUri"),
            grant_type: "authorization_code",
          }),
        }),
        "YouTube sign-in",
      );
      await store.set("youtube", {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAtMs: now + t.expires_in * 1000,
      });
      return "YouTube connected.";
    }
    case "tiktok": {
      const c = creds.tiktok;
      const t = await json<{ access_token: string; refresh_token: string; expires_in: number }>(
        await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_key: need(c?.clientKey, "tiktok.clientKey"),
            client_secret: need(c?.clientSecret, "tiktok.clientSecret"),
            redirect_uri: need(c?.redirectUri, "tiktok.redirectUri"),
            grant_type: "authorization_code",
          }),
        }),
        "TikTok sign-in",
      );
      await store.set("tiktok", {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAtMs: now + t.expires_in * 1000,
      });
      return "TikTok connected.";
    }
    case "instagram": {
      const c = creds.instagram;
      const appId = need(c?.appId, "instagram.appId");
      const appSecret = need(c?.appSecret, "instagram.appSecret");
      const short = await json<{ access_token: string }>(
        await fetch(
          `${GRAPH}/oauth/access_token?${new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            redirect_uri: need(c?.redirectUri, "instagram.redirectUri"),
            code,
          })}`,
        ),
        "Instagram sign-in",
      );
      const long = await json<{ access_token: string; expires_in?: number }>(
        await fetch(
          `${GRAPH}/oauth/access_token?${new URLSearchParams({
            grant_type: "fb_exchange_token",
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: short.access_token,
          })}`,
        ),
        "Instagram long-lived token",
      );
      const pages = await json<{ data: Array<{ instagram_business_account?: { id: string } }> }>(
        await fetch(
          `${GRAPH}/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(long.access_token)}`,
        ),
        "Instagram account lookup",
      );
      const igUserId = pages.data.find((p) => p.instagram_business_account)?.instagram_business_account?.id;
      if (!igUserId) {
        throw new Error(
          "No Instagram professional account found. Switch the Instagram account to Creator/Business and link it to a Facebook Page, then connect again.",
        );
      }
      await store.set("instagram", {
        accessToken: long.access_token,
        expiresAtMs: now + (long.expires_in ?? 60 * 86_400) * 1000,
        igUserId,
      });
      return "Instagram connected.";
    }
  }
}

async function freshToken(platform: Platform, creds: PlatformCredentials, store: TokenStore): Promise<StoredToken> {
  const token = await store.get(platform);
  if (!token) {
    throw new Error(`${platform} is not connected. Ask: "connect my ${platform} account".`);
  }
  if (token.expiresAtMs - Date.now() > 5 * 60_000) {
    return token;
  }
  if (platform === "instagram" || !token.refreshToken) {
    throw new Error(`The ${platform} sign-in expired. Ask: "connect my ${platform} account".`);
  }
  const refreshed =
    platform === "youtube"
      ? await json<{ access_token: string; expires_in: number }>(
          await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: new URLSearchParams({
              client_id: need(creds.youtube?.clientId, "youtube.clientId"),
              client_secret: need(creds.youtube?.clientSecret, "youtube.clientSecret"),
              refresh_token: token.refreshToken,
              grant_type: "refresh_token",
            }),
          }),
          "YouTube token refresh",
        )
      : await json<{ access_token: string; refresh_token: string; expires_in: number }>(
          await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_key: need(creds.tiktok?.clientKey, "tiktok.clientKey"),
              client_secret: need(creds.tiktok?.clientSecret, "tiktok.clientSecret"),
              refresh_token: token.refreshToken,
              grant_type: "refresh_token",
            }),
          }),
          "TikTok token refresh",
        );
  const next: StoredToken = {
    ...token,
    accessToken: refreshed.access_token,
    refreshToken: "refresh_token" in refreshed ? refreshed.refresh_token : token.refreshToken,
    expiresAtMs: Date.now() + refreshed.expires_in * 1000,
  };
  await store.set(platform, next);
  return next;
}

export async function connectedPlatforms(store: TokenStore): Promise<Platform[]> {
  const out: Platform[] = [];
  for (const p of PLATFORMS) {
    if (await store.get(p)) {
      out.push(p);
    }
  }
  return out;
}

// ---------- uploads ----------

export type UploadInput = { file: string; title: string; caption: string };

export async function upload(
  platform: Platform,
  creds: PlatformCredentials,
  store: TokenStore,
  input: UploadInput,
): Promise<string> {
  const token = await freshToken(platform, creds, store);
  const bytes = await fs.readFile(input.file);
  switch (platform) {
    case "youtube":
      return await uploadYouTube(token.accessToken, bytes, input);
    case "tiktok":
      return await uploadTikTok(token.accessToken, bytes, input);
    case "instagram":
      return await uploadInstagram(token, bytes, input);
  }
}

async function uploadYouTube(accessToken: string, bytes: Buffer, input: UploadInput): Promise<string> {
  const start = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify({
        snippet: { title: input.title, description: input.caption, categoryId: "20" },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  const location = start.headers.get("location");
  if (!start.ok || !location) {
    throw new Error(`YouTube upload start failed (${start.status}): ${(await start.text()).slice(0, 500)}`);
  }
  const done = await json<{ id: string }>(
    await fetch(location, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes }),
    "YouTube upload",
  );
  return done.id;
}

async function uploadTikTok(accessToken: string, bytes: Buffer, input: UploadInput): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  const info = await json<{ data: { privacy_level_options: string[] } }>(
    await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: auth }),
    "TikTok creator info",
  );
  const options = info.data.privacy_level_options;
  const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0];
  const init = await json<{ data: { publish_id: string; upload_url: string } }>(
    await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        post_info: { title: input.caption.slice(0, 2200), privacy_level: privacy },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: bytes.length,
          chunk_size: bytes.length,
          total_chunk_count: 1,
        },
      }),
    }),
    "TikTok post start",
  );
  const put = await fetch(init.data.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
    },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(`TikTok upload failed (${put.status}): ${(await put.text()).slice(0, 500)}`);
  }
  return init.data.publish_id;
}

async function uploadInstagram(token: StoredToken, bytes: Buffer, input: UploadInput): Promise<string> {
  const igUserId = need(token.igUserId, "Instagram account id (reconnect Instagram)");
  const container = await json<{ id: string; uri?: string }>(
    await fetch(
      `${GRAPH}/${igUserId}/media?${new URLSearchParams({
        media_type: "REELS",
        upload_type: "resumable",
        caption: input.caption,
        access_token: token.accessToken,
      })}`,
      { method: "POST" },
    ),
    "Instagram reel container",
  );
  await json<unknown>(
    await fetch(container.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${container.id}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token.accessToken}`,
        offset: "0",
        file_size: String(bytes.length),
      },
      body: bytes,
    }),
    "Instagram upload",
  );
  // Instagram processes the video before it can be published.
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await json<{ status_code: string }>(
      await fetch(`${GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(token.accessToken)}`),
      "Instagram processing status",
    );
    if (status.status_code === "FINISHED") {
      const published = await json<{ id: string }>(
        await fetch(
          `${GRAPH}/${igUserId}/media_publish?${new URLSearchParams({
            creation_id: container.id,
            access_token: token.accessToken,
          })}`,
          { method: "POST" },
        ),
        "Instagram publish",
      );
      return published.id;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the video (${status.status_code})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Instagram is still processing after 10 minutes; try again later.");
}
