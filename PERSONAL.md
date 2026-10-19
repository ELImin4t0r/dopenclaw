# dopenclaw

My private build of OpenClaw. It runs on my MacBook, and the **dopenclaw**
iPhone and Mac apps are the only way to chat with it. No WhatsApp, Discord,
Telegram or other channels; no cloud model; no cloud storage. Everything it
knows lives in markdown under `~/.openclaw/workspace/`.

Type `dopenclaw` in the terminal (`dopenclaw gateway`, `dopenclaw qr`, `dopenclaw doctor`). Under the hood it is still OpenClaw: the
data folder is `~/.openclaw`. Only the visible name changed, so upstream
updates keep merging cleanly.

## What's different from upstream

| Feature                                                                                       | Where                                                                                                                             |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Name "dopenclaw" on iPhone, Watch, Mac and in chat                                            | `apps/ios/project.yml`, `apps/ios/Sources/Info.plist`, `apps/macos/Sources/OpenClaw/Resources/Info.plist`, config `identity.name` |
| Local-only config (Ollama model, no channels, no update check, exclusive plugin allowlist)    | `config/personal/openclaw.json`                                                                                                   |
| Calendar "starting soon" alerts, reminders, 08:00 briefing, `reminder_add` / `todo_add` tools | `extensions/daily-briefing/`                                                                                                      |
| KURT reservation alerts + automatic check-in when the phone arrives at the library            | `extensions/kuleuven-library/`                                                                                                    |
| AWS sign-up + free-credit activities                                                          | `skills/aws-free-credits/SKILL.md`                                                                                                |
| Clipping: find highlights, cut vertical clips, approve, post to Shorts/TikTok/Reels           | `extensions/clipper/`                                                                                                             |
| "Features" dropdown in the chat top bar (iPhone + Mac)                                        | `apps/shared/OpenClawKit/Sources/OpenClawChatUI/PersonalFeatureMenu.swift`                                                        |
| iPhone: local notification schedule + library geofences                                       | `apps/ios/Sources/Personal/PersonalAssistantSync.swift`                                                                           |

## Where my data lives

```
~/.openclaw/
  openclaw.json                 config (gateway token, plugin settings)
  workspace/
    MEMORY.md, USER.md          long-term memory (upstream)
    memory/YYYY-MM-DD.md        daily notes (upstream)
    personal/
      todo.md                   - [ ] to-dos (morning briefing)
      places.md                 libraries the phone watches
      reservations.md           synced KURT reservations
      aws-credits.md            AWS progress
      alerts/*.md               timed notifications, one file per source
  kuleuven-library/profile/     browser profile with my KURT login
```

## Setup

### Laptop

```bash
brew install node pnpm ollama xcodegen
./scripts/personal-setup.sh        # config + markdown files + model + deps
dopenclaw gateway                  # keep this running
```

Tailscale lets the phone reach the laptop away from home. The traffic is
end-to-end encrypted between my own devices.

Use the Tailscale **app** on the Mac (tailscale.com/download) and on the
iPhone, signed in to the same account. Don't also run the Homebrew
`tailscale` service: two copies on one Mac show up as two devices and conflict.
Start `dopenclaw gateway` after Tailscale is connected, or it only listens on
the Mac itself.

### iPhone (no App Store)

1. Copy `apps/ios/LocalSigning.xcconfig.example` to `LocalSigning.xcconfig` and
   set my own bundle ID and Apple team.
2. `pnpm ios:open`, select my iPhone, Run.
   With a free Apple ID the app must be re-run from Xcode every 7 days.
3. In the app: pair with `dopenclaw qr`. Set location to **Always** and
   allow notifications. Keep Background App Refresh on.

No push relay is configured, so the laptop never sends anything through Apple's
servers. Instead the phone downloads its notification schedule each time it
connects or wakes, and iOS fires the alerts locally.

### Mac app

`apps/macos` (see `docs/platforms/macos.md`). It gets the same alerts live
while connected.

### KURT, one-time

1. In chat: "log in to KURT". A browser window opens on the laptop; sign in
   with KU Leuven SSO and close it.
2. Add the libraries I use to `personal/places.md`.
3. **Still to do:** reading reservations and checking in aren't wired to the
   real site yet. KURT has no public API docs. Say "record KURT", click
   through _My reservations_ and a check-in, close the window, then finish the
   two functions in `extensions/kuleuven-library/src/kurt-site.ts` using
   `~/.openclaw/kuleuven-library/kurt-capture.md`.

Check-in only ever happens with a fresh phone location inside the library.

## Clipping (YouTube Shorts, TikTok, Instagram Reels)

How it runs: every 6 hours dopenclaw finds highlights for the streamers in
`personal/clips/streamers.md` (most-viewed Twitch clips, or the loudest moments
of the latest YouTube/Kick VOD). It cuts them into 1080×1920 clips, with
captions if a whisper model is set, and notifies the phone. You approve them
in chat (**Features › Review clips**), and approved clips post at 12:00, 17:00
and 21:00 to every connected account.

**Making money:** reposting without permission gets copyright strikes and no
payouts. Clip creators who run clipping programs (e.g. on Whop, paid per
view) or who said yes. Every line in `streamers.md` needs a `permission:`
note, or it's skipped.

**One-time setup (all by you, because platforms ban bot-made accounts):**

1. Create the accounts yourself: a YouTube channel, a TikTok account, and an
   Instagram account switched to Creator/Business and linked to a Facebook Page.
2. Create the free developer apps and put their keys in
   `~/.openclaw/openclaw.json` under `plugins.entries.clipper.config`:
   - Twitch: dev.twitch.tv › Console › Register app → `clientId`, `clientSecret`.
   - YouTube: Google Cloud console › enable _YouTube Data API v3_ › OAuth
     client (Desktop) → `clientId`, `clientSecret`. Keep `redirectUri`
     `http://localhost:8765/callback`.
   - TikTok: developers.tiktok.com › app with _Login Kit_ + _Content Posting
     API_ (Direct Post) → `clientKey`, `clientSecret`, and the https
     `redirectUri` you registered.
   - Instagram: developers.facebook.com › app with _Instagram_ + _Facebook
     Login for Business_ → `appId`, `appSecret`, `redirectUri`.
3. Restart dopenclaw, then in chat: "connect my youtube account" (and tiktok,
   instagram). Open the link, approve, and paste back the URL you land on.
4. Optional captions: `brew install whisper-cpp`, download a model (e.g.
   `ggml-base.en.bin`) and set `whisperModel` to its path.

**Before posts can be public:** YouTube and TikTok keep API uploads
**private** until they review your developer app. TikTok also requires the
account to be private until then. Apply for the YouTube API audit and the
TikTok Content Posting audit once everything works privately. Instagram
publishes normally once connected.

## Adding features later

**Quickest: a skill.** No code, no rebuild. A skill is a markdown file that
teaches the agent a procedure or a CLI:

```
~/.openclaw/workspace/skills/<name>/SKILL.md
```

Copy `skills/aws-free-credits/SKILL.md` as a template. The frontmatter
`requires.bins` lists CLIs it needs.

**When you need code** (background jobs, phone data, new tools): a plugin.

1. Copy `extensions/kuleuven-library/` to `extensions/<id>/`. Rename the id in
   `openclaw.plugin.json`, `package.json` and `index.ts`.
2. Add `<id>` to `plugins.allow` in `~/.openclaw/openclaw.json`. Without that
   the allowlist blocks it.
3. Restart the gateway.
4. To show it in the **Features** dropdown, add an entry to
   `PersonalFeatures.groups` in
   `apps/shared/OpenClawKit/Sources/OpenClawChatUI/PersonalFeatureMenu.swift`
   and reinstall the app.

Useful building blocks, all used by the two plugins:

- `api.registerTool` lets the agent call your code from chat.
- `api.registerService` with `ctx.scheduler` runs background jobs.
- `api.runtime.nodes.invoke` reads from the phone: `calendar.events`,
  `reminders.list`, `location.get`, `contacts.search`, …
- Writing `personal/alerts/<id>.md` lines schedules phone notifications with
  no extra code (format: `- YYYY-MM-DD HH:MM | Title | body`).

## Staying local

- Never add a `channels` section to the config.
- Check outbound traffic while chatting:
  `lsof -i -P | grep -i -E 'node|openclaw'`. Expect only Ollama on localhost,
  Tailscale, and KURT or AWS while those features run.
- Swapping in a cloud model would send chat text to that provider. If that's
  ever needed for the AWS steps, change `agents.defaults.model.primary`
  temporarily.
