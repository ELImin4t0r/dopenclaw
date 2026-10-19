# dopenclaw

My private build of OpenClaw. It runs on my MacBook, and the **dopenclaw**
iPhone and Mac apps are the only way to chat with it. No WhatsApp, Discord,
Telegram or other channels; no cloud model; no cloud storage. Everything it
knows lives in markdown under `~/.openclaw/workspace/`.

Under the hood it's still OpenClaw: the terminal command is `openclaw` and the
data folder is `~/.openclaw`. Only the visible name changed, so upstream
updates keep merging cleanly.

## What's different from upstream

| Feature | Where |
| --- | --- |
| Name "dopenclaw" on iPhone, Watch, Mac and in chat | `apps/ios/project.yml`, `apps/ios/Sources/Info.plist`, `apps/macos/Sources/OpenClaw/Resources/Info.plist`, config `identity.name` |
| Local-only config (Ollama model, no channels, no update check, exclusive plugin allowlist) | `config/personal/openclaw.json` |
| Calendar "starting soon" alerts, reminders, 08:00 briefing, `reminder_add` / `todo_add` tools | `extensions/daily-briefing/` |
| KURT reservation alerts + automatic check-in when the phone arrives at the library | `extensions/kuleuven-library/` |
| AWS sign-up + free-credit activities | `skills/aws-free-credits/SKILL.md` |
| iPhone: local notification schedule + library geofences | `apps/ios/Sources/Personal/PersonalAssistantSync.swift` |

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
brew install node pnpm ollama tailscale xcodegen
./scripts/personal-setup.sh        # config + markdown files + model + deps
pnpm openclaw gateway              # keep this running
```

Tailscale lets the phone reach the laptop away from home. The traffic is
end-to-end encrypted between my own devices.

### iPhone (no App Store)

1. Copy `apps/ios/LocalSigning.xcconfig.example` to `LocalSigning.xcconfig` and
   set my own bundle ID and Apple team.
2. `pnpm ios:open`, select my iPhone, Run.
   With a free Apple ID the app must be re-run from Xcode every 7 days.
3. In the app: pair with `pnpm openclaw qr`. Set location to **Always** and
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
   through *My reservations* and a check-in, close the window, then finish the
   two functions in `extensions/kuleuven-library/src/kurt-site.ts` using
   `~/.openclaw/kuleuven-library/kurt-capture.md`.

Check-in only ever happens with a fresh phone location inside the library.

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
