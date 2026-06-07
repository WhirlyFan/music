#!/usr/bin/env bash
# Print the YOUTUBE_PROXY value to paste into Render's backend env.
# Combines the proxy creds (.env) with the live ngrok TCP endpoint (read from
# ngrok's local API on :4040). Re-run after restarting ngrok — the URL changes.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || {
  echo "Missing .env — run: cp .env.example .env  (then fill it in)" >&2
  exit 1
}
set -a
. ./.env
set +a

api=$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null || true)
if [ -z "$api" ]; then
  echo "Can't reach ngrok on :4040. Is it up?  docker compose up -d  (then wait a few seconds)" >&2
  exit 1
fi

# Pull the tcp:// public_url. Prefer jq if present, else grep/sed (no dep).
if command -v jq >/dev/null 2>&1; then
  endpoint=$(printf '%s' "$api" | jq -r '.tunnels[] | select(.proto=="tcp") | .public_url' | head -1)
else
  endpoint=$(printf '%s' "$api" | grep -o '"public_url":"tcp://[^"]*"' | head -1 \
    | sed 's/.*tcp:\/\///; s/"$//')
  endpoint="${endpoint:+tcp://$endpoint}"
fi

host_port="${endpoint#tcp://}"
if [ -z "$host_port" ]; then
  echo "No TCP tunnel found yet — give it a few seconds after 'docker compose up'." >&2
  exit 1
fi

echo
echo "Paste this into Render → backend service → Environment, then redeploy:"
echo
echo "  YOUTUBE_PROXY=http://${PROXY_USER}:${PROXY_PASS}@${host_port}"
echo
