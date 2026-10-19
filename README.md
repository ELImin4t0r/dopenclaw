# dopenclaw

**dopenclaw** is my private fork of [OpenClaw](https://github.com/openclaw/openclaw): a
personal assistant that runs on my own Mac. The dopenclaw iPhone and Mac apps
are the only way to chat with it.

- **Private:** a local AI model (Ollama); no WhatsApp, Discord or other chat
  channels; no cloud storage. Everything it knows lives in markdown files under
  `~/.openclaw/workspace/`.
- **Phone-friendly:** the iPhone app downloads its alerts from the Mac and
  shows them itself, so reminders still arrive when the Mac is asleep.
- **Extensible:** new features are a markdown skill or a small plugin.

## Features

| Feature               | What it does                                                                                                                                                   | Code                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **My day**            | "Starting soon" alerts for my calendar, reminders, to-dos, and a morning briefing at 08:00                                                                     | [`extensions/daily-briefing`](extensions/daily-briefing)                                                |
| **KU Leuven library** | KURT reservation alerts, and check-in when my phone shows I've arrived at the library                                                                          | [`extensions/kuleuven-library`](extensions/kuleuven-library)                                            |
| **Clipping**          | Finds highlights from streamers I'm allowed to clip, cuts vertical captioned clips, and posts the ones I approve to YouTube Shorts, TikTok and Instagram Reels | [`extensions/clipper`](extensions/clipper)                                                              |
| **AWS credits**       | Walks me through AWS sign-up and the free-tier credit activities                                                                                               | [`skills/aws-free-credits`](skills/aws-free-credits/SKILL.md)                                           |
| **Features menu**     | A dropdown in the chat top bar (iPhone and Mac) that lists all of the above                                                                                    | [`PersonalFeatureMenu.swift`](apps/shared/OpenClawKit/Sources/OpenClawChatUI/PersonalFeatureMenu.swift) |

## Quick start

On the Mac:

```bash
brew install node pnpm ollama tailscale xcodegen
./scripts/personal-setup.sh      # config, markdown files, AI model, video tools, dependencies
dopenclaw gateway                # start dopenclaw; keep it running
dopenclaw qr                     # pair the iPhone app
```

For the iPhone app you need macOS 26 and Xcode on the Mac, and iOS 26.2+ on
the phone. Run `pnpm ios:open`, connect the iPhone and press Run.

The Mac must be on and running `dopenclaw gateway` for the phone app to chat.
Alerts the phone already downloaded still go off when the Mac is asleep.

## Docs

- [`PERSONAL.md`](PERSONAL.md): setup, where data lives, each feature,
  connecting the clipping accounts, and adding new features.
- [`CONTEXT.md`](CONTEXT.md): why things were built this way, current status,
  and the to-do list.

## Status

Work in progress, on the `personal` branch:

- The **iPhone app** isn't installed yet; it's waiting on the macOS 26 update
  and Xcode.
- **KURT** reservation reading and check-in still need to be mapped against the
  real site.
- **YouTube and TikTok** keep posts private until they review my developer app.

## Based on OpenClaw

dopenclaw is built on [OpenClaw](https://github.com/openclaw/openclaw). Its
[docs](https://docs.openclaw.ai) cover everything that isn't specific to
dopenclaw, such as the gateway, the apps and the plugin system. Every
`openclaw` command also works as `dopenclaw`. OpenClaw is MIT-licensed; see
[`LICENSE`](LICENSE).

This fork is for my own use. Changes here aren't meant to go back into
OpenClaw.
