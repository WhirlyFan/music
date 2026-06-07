#!/bin/sh
# Run migrations as the admin role, then drop privileges and exec the real
# command. Idempotent — `migrate` is a no-op when the schema is current, so
# this is safe to run on every container start.
#
# DATABASE_URL_ADMIN must be set (it is, by docker-compose / .env). The
# runtime DATABASE_URL stays scoped to the app_user role so RLS applies
# normally once the process is serving.

set -e

# Start the co-located PO-token provider (internal :4416) in the background.
# Best-effort: if it isn't up, yt-dlp just resolves without PO tokens (the
# bundled solver still works), so a failure here never blocks playback.
if [ -f /opt/bgutil/build/main.js ]; then
  echo "[entrypoint] starting PO-token provider on :4416…"
  node /opt/bgutil/build/main.js >/tmp/bgutil.log 2>&1 &
fi

# Phase A collapses the admin + runtime roles into one, so the admin URL is just
# DATABASE_URL. Fall back to it when DATABASE_URL_ADMIN isn't set (e.g. it isn't
# provided via Doppler) so migrations still run. Phase B (a real separate admin
# role) would set DATABASE_URL_ADMIN explicitly, which then wins.
: "${DATABASE_URL_ADMIN:=$DATABASE_URL}"
if [ -n "$DATABASE_URL_ADMIN" ]; then
  echo "[entrypoint] running migrations…"
  DATABASE_URL="$DATABASE_URL_ADMIN" python manage.py migrate --noinput
else
  echo "[entrypoint] WARNING: no DATABASE_URL[_ADMIN] set, skipping migrations"
fi

# Optional: route YouTube extraction through a Tailscale exit node (e.g. a home
# machine running home-proxy/) so requests use a residential IP instead of
# Render's datacenter IP, which YouTube bot-walls. Userspace networking (no TUN
# needed on Render) + an outbound HTTP proxy on :1055; YOUTUBE_PROXY points at
# it so ONLY YouTube traffic egresses via the exit node (DB etc. stay direct).
# Best-effort + gated on TS_AUTHKEY: a bad key or an offline exit node never
# blocks boot — playback just falls back to direct (the "home machine off" case).
if [ -n "$TS_AUTHKEY" ]; then
  echo "[entrypoint] starting tailscaled (userspace) + HTTP proxy on :1055…"
  tailscaled \
    --tun=userspace-networking \
    --socket=/tmp/tailscaled.sock \
    --statedir=/tmp/ts-state \
    --outbound-http-proxy-listen=localhost:1055 \
    >/tmp/tailscaled.log 2>&1 &
  i=0
  while [ ! -S /tmp/tailscaled.sock ] && [ "$i" -lt 10 ]; do
    i=$((i + 1))
    sleep 0.5
  done
  # Join the tailnet WITHOUT --exit-node so boot can't fail when the home node
  # isn't up yet (`tailscale up` errors on an unknown exit node).
  if tailscale --socket=/tmp/tailscaled.sock up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-music-backend}" \
    >/tmp/ts-up.log 2>&1; then
    # Don't override an explicitly-set proxy (e.g. a manual bore/ngrok URL).
    export YOUTUBE_PROXY="${YOUTUBE_PROXY:-http://localhost:1055}"
    echo "[entrypoint] tailscale up OK — YOUTUBE_PROXY via :1055"
    if [ -n "$TS_EXIT_NODE" ]; then
      # Attach (and keep) the exit node in the background, idempotently — so order
      # never matters: the backend can boot before the home node, and it re-attaches
      # whenever the node appears, cycles down/up, or re-registers with a new ID.
      # `set` is a no-op once attached. ~1 CLI call / 30s — negligible.
      (
        attached=0
        while true; do
          if tailscale --socket=/tmp/tailscaled.sock set --exit-node="$TS_EXIT_NODE" >/dev/null 2>&1; then
            [ "$attached" = 1 ] || { echo "[entrypoint] exit node attached: $TS_EXIT_NODE"; attached=1; }
          else
            attached=0
          fi
          sleep 30
        done
      ) &
    fi
  else
    echo "[entrypoint] tailscale up FAILED (see /tmp/ts-up.log) — continuing without proxy"
  fi
fi

exec "$@"
