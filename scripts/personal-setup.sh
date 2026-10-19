#!/usr/bin/env bash
# One-time setup for dopenclaw, the personal local-only OpenClaw (laptop side).
# Installs the personal config and seeds the markdown files under
# ~/.openclaw/workspace/personal/. Safe to re-run: never overwrites your files.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
PERSONAL="$STATE/workspace/personal"
MODEL="${OPENCLAW_PERSONAL_MODEL:-qwen3:14b}"

for bin in node pnpm ollama; do
  command -v "$bin" >/dev/null || { echo "Missing '$bin'. Install it first (brew install node pnpm ollama)." >&2; exit 1; }
done
command -v tailscale >/dev/null || echo "Note: Tailscale not found; the phone can only reach the laptop once it is installed (gateway falls back to loopback)."

mkdir -p "$STATE"
if [[ -e "$STATE/openclaw.json" ]]; then
  echo "Keeping existing $STATE/openclaw.json (compare with config/personal/openclaw.json)."
else
  TOKEN="$(openssl rand -hex 24)"
  sed -e "s/__GATEWAY_TOKEN__/$TOKEN/" -e "s#ollama/qwen3:14b#ollama/$MODEL#" \
    "$REPO/config/personal/openclaw.json" > "$STATE/openclaw.json"
  chmod 600 "$STATE/openclaw.json"
  echo "Wrote $STATE/openclaw.json"
fi

mkdir -p "$PERSONAL/alerts"
seed() { [[ -e "$1" ]] || { printf '%s\n' "$2" > "$1"; echo "Created $1"; }; }
seed "$PERSONAL/todo.md" "# To do

- [ ] Example: replace me"
seed "$PERSONAL/places.md" "# Places

Libraries the phone watches for automatic KURT check-in.
Format: \`- Name | latitude, longitude | radius in metres\`
The name must appear in the KURT location name (e.g. \"Agora\").
Get coordinates by long-pressing the entrance in Apple Maps.
"
seed "$PERSONAL/alerts/manual.md" "# Reminders

Format: \`- YYYY-MM-DD HH:MM | Title | optional body\`"
seed "$PERSONAL/aws-credits.md" "# AWS credits progress"
mkdir -p "$PERSONAL/clips/videos"
seed "$PERSONAL/clips/streamers.md" "# Streamers to clip

Only add creators you're allowed to clip (a clipping program, or their OK).
Lines without a permission are ignored.
Format: \`- Name | twitch:login | permission: how you're allowed\`
Other sources: \`youtube:https://www.youtube.com/@channel/videos\`, \`kick:channel\`
"

for bin in ffmpeg yt-dlp; do
  command -v "$bin" >/dev/null || brew install "$bin"
done

pgrep -x ollama >/dev/null || brew services start ollama
# The service needs a few seconds before it accepts requests.
for _ in $(seq 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done
ollama pull "$MODEL"
(cd "$REPO" && pnpm install)
echo
echo "Done. Start dopenclaw with: dopenclaw gateway"
echo "Then pair the iPhone with: dopenclaw qr"
