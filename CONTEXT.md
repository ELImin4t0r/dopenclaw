# dopenclaw: project context

This file explains how dopenclaw came to be, what was decided and why, and
what's still open. Read it before continuing the work, or paste it into a
new Claude session.

Last updated: 2026-10-19.

## The goal

A private version of OpenClaw that:

- runs only on my MacBook, with the iPhone and Mac apps as the only way to
  chat with it (no WhatsApp, Discord, Telegram or other channels);
- keeps all data local, as markdown files, with no cloud storage;
- is named **dopenclaw**;
- is easy to add features to later.

Features I asked for:

1. KU Leuven library (KURT): reservation alerts, plus check-in.
2. AWS: help signing up and earning the free-tier credits.
3. Calendar: "starting soon" alerts and daily to-do reminders.
4. Clipping: cut streamer clips and post them to TikTok, Instagram and
   YouTube several times a day, to earn money.
5. A **Features** dropdown in the app listing everything it can do.

## Where things are

- **Code:** `~/dopenclaw/` (next to `~/SHRLM`, deliberately outside the rlm_self_harness repo),
  branch `personal`. My fork is `github.com/ELImin4t0r/openclaw` (based on
  upstream commit `59c74d5`). The work is pushed to the `personal` branch there.
- **Data:** `~/.openclaw/`
  - `openclaw.json`: config, including the gateway token and API keys. Keep it private.
  - `workspace/personal/`: `todo.md`, `places.md`, `reservations.md`,
    `aws-credits.md`, `alerts/*.md`, `clips/streamers.md`, `clips/queue.md`,
    `clips/videos/`.
- **Guide:** `PERSONAL.md` in the repo covers setup, each feature, and how to
  add features.

## Decisions and why

| Decision                                                                                                                  | Why                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone + MacBook, with the laptop as the "brain" (gateway)                                                                | My devices. The phone app connects to the laptop.                                                                                               |
| Local AI model (Ollama, `qwen3:14b`)                                                                                      | "No data in the cloud" also means chat text shouldn't go to a cloud AI. Downside: weaker at long multi-step tasks like the AWS steps.           |
| Tailscale for phone ↔ laptop away from home                                                                               | Encrypted directly between my own devices, nothing stored in a cloud.                                                                           |
| No push relay. The phone downloads its notification schedule and iOS fires alerts locally.                                | Upstream iOS push goes through OpenClaw's hosted relay and Apple; this keeps notifications local and working when the laptop sleeps.            |
| Phone calendar as the calendar source                                                                                     | My choice. Read through the iPhone app.                                                                                                         |
| Only the visible name changed to dopenclaw (apps, assistant name, `dopenclaw` command). Internals and `~/.openclaw` stay. | A full rename touches hundreds of files and makes OpenClaw updates hard to merge. The Mac app also expects `~/.openclaw`.                       |
| Library check-in only when the phone's location shows I'm at the library                                                  | Remote check-in would hold seats others could use, which defeats KURT's rule. Claude declined to build that, and I chose "check in on arrival". |
| AWS sign-up is assisted, not automatic                                                                                    | CAPTCHA, card, phone and email checks need a person.                                                                                            |
| Clipping: **no automatic account creation**. I make the accounts; dopenclaw posts through official APIs.                  | Platforms require phone/CAPTCHA at sign-up and ban bot-made accounts.                                                                           |
| Clipping only creators with a stated `permission:` (clipping programs or their OK)                                        | Reposting without permission gets copyright strikes and no payouts.                                                                             |
| Clips need my approval in chat before posting                                                                             | My choice. It catches bad cuts and copyright problems.                                                                                          |
| Clip sources: Twitch, YouTube/Kick VODs                                                                                   | My choice.                                                                                                                                      |
| Features dropdown in the chat top bar (iPhone + Mac)                                                                      | My choice.                                                                                                                                      |

## What was built

| Piece                                                                   | Files                                                                                                                      | State                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Local-only config + setup script                                        | `config/personal/openclaw.json`, `scripts/personal-setup.sh`                                                               | Config installed at `~/.openclaw/openclaw.json`    |
| `dopenclaw` terminal command                                            | `bin/dopenclaw`, linked to `/opt/homebrew/bin/dopenclaw`                                                                   | Installed                                          |
| Calendar alerts, reminders, 08:00 briefing, `reminder_add` / `todo_add` | `extensions/daily-briefing/`                                                                                               | Written, tests pass                                |
| Library alerts + on-arrival check-in                                    | `extensions/kuleuven-library/`                                                                                             | Written; **KURT site part unfinished** (see below) |
| AWS credits guide                                                       | `skills/aws-free-credits/SKILL.md`                                                                                         | Written                                            |
| Clipper                                                                 | `extensions/clipper/`                                                                                                      | Written, tests pass, platform APIs untested        |
| iPhone: local notifications + library geofence                          | `apps/ios/Sources/Personal/PersonalAssistantSync.swift`, `apps/ios/Sources/Model/NodeAppModel.swift`                       | Written, Swift parses                              |
| Features dropdown                                                       | `apps/shared/OpenClawKit/Sources/OpenClawChatUI/PersonalFeatureMenu.swift` (+ `ChatProTab.swift`, `ChatWindowShell.swift`) | Written, Swift parses                              |
| App name "dopenclaw"                                                    | `apps/ios/project.yml`, `apps/ios/Sources/Info.plist`, macOS `Info.plist`, `identity.name` in config                       | Done                                               |

How the pieces talk:

- The plugins share data through markdown. Any plugin can write
  `personal/alerts/<name>.md` lines (`- YYYY-MM-DD HH:MM | Title | body`) to
  get a phone notification.
- The iPhone app calls the gateway methods `briefing.notifications`,
  `library.places` and `library.arrived`.

## What went wrong (so it doesn't happen again)

- **My first `git clone` was still running** when Claude started working in the
  same folder. The clone failed ("early EOF", slow connection), git deleted the
  folder, and the first version of the work was lost. Claude rebuilt
  everything as `~/dopenclaw/` and now commits after each step. **Don't clone
  into that folder again.**
- **The internet connection drops big downloads.** Chrome failed twice and the
  model download stopped at 93%; re-running `ollama pull` resumed it.
- **Pushing the branch offered a PR to the official OpenClaw repo.** GitHub's
  "Create pull request" link on a fork targets upstream by default. That opened
  openclaw/openclaw#177745 ("dopenclaw v1") by mistake; close it. Never open a
  PR for this branch: it isn't meant to go upstream.
- **The setup config lacked `gateway.mode`**, so the gateway refused to start.
  `config/personal/openclaw.json` now sets `"mode": "local"`.
- **Two Tailscales on the Mac.** The Tailscale app was already installed, and
  starting the Homebrew `tailscale` service added a second device. Use only
  the app; the Homebrew service is stopped.

## Status right now

**Installed and working:** node 26, pnpm, the project dependencies, Ollama
with `qwen3:14b`, ffmpeg, yt-dlp, the Tailscale app (connected, iPhone too), xcodegen, the GitHub CLI
(`gh`, not logged in yet: run `gh auth login`), the config, my markdown files,
and the `dopenclaw` command. The plugin tests pass (21 tests), `dopenclaw
gateway` starts with all three plugins loaded, and `dopenclaw doctor` reports
only warnings.

**Not installed:**

- Google Chrome. The download failed twice; retry with
  `brew install --cask google-chrome`.
- **Xcode.** Install it on the **Mac** from the Mac App Store (it doesn't exist
  for iPhone). **Blocked:** this Mac (M3 MacBook Air) runs macOS 15.6.1, and
  current Xcode needs macOS 26.6+. Older Xcode won't do, because the code needs
  Swift 6.3. Fix: Software Update now offers macOS 27.0.1 (13 GB, restart);
  install it, then Xcode.
- **iPhone requirement:** the app needs iOS 26.2 or later on the phone.

## To do next

1. **Close** openclaw/openclaw#177745, and retry the Chrome install.
2. **Start it:** `dopenclaw gateway` (keep it running).
3. **Doctor follow-ups:** `dopenclaw doctor --fix` applies two small config
   defaults; the `aws` CLI (`brew install awscli`) makes the AWS skill usable.
4. ~~Tailscale~~ done: the Tailscale app on the Mac and the iPhone, same
   account. The gateway answers on the Mac's Tailscale address
   (100.117.160.65:18789).
5. **iPhone app:**
   1. Install Xcode on the Mac.
   2. Copy `apps/ios/LocalSigning.xcconfig.example` to `LocalSigning.xcconfig`
      and set my Apple ID team and a unique bundle ID.
   3. Plug in the iPhone, run `pnpm ios:open`, and press Run.
   4. Pair with `dopenclaw qr`. Set location to **Always** and allow
      notifications.
      With a free Apple ID I have to re-run the app from Xcode every 7 days.
6. **Library:**
   1. Add libraries to `personal/places.md`.
   2. In chat: "log in to KURT".
   3. Then "record KURT": click through _My reservations_ and a check-in.
      Claude then finishes `listReservations` and `checkIn` in
      `extensions/kuleuven-library/src/kurt-site.ts`. They are stubs because
      KURT has no public API docs.
7. **Clipping:**
   1. Create the YouTube, TikTok and Instagram (Creator/Business, linked to a
      Facebook Page) accounts myself.
   2. Register the developer apps and put their keys in
      `plugins.entries.clipper.config` (steps in `PERSONAL.md`).
   3. Say "connect my youtube/tiktok/instagram account".
   4. Fill in `personal/clips/streamers.md`.
   5. Apply for the YouTube and TikTok API reviews. Until then, posts there
      stay private.

## Open questions and known risks

- **KURT:** the real site structure is unknown. The base URL
  `https://kurt3.ghum.kuleuven.be` is unverified.
- **Platform APIs:**
  - Clipper's YouTube/TikTok/Instagram calls were written from the docs but
    not yet tested against real accounts.
  - Instagram's resumable upload may require _Facebook Login for Business_.
  - TikTok rules for unreviewed apps: the account must be private, at most
    5 users a day, posts are private only.
- **Local model:** it may struggle with the AWS steps. A cloud model could be
  switched in temporarily, but then chat text leaves the laptop.
- **Laptop must be on:** if it's off or asleep, the phone can't chat. Scheduled
  alerts the phone already downloaded still fire.
