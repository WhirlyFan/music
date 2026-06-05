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

if [ -n "$DATABASE_URL_ADMIN" ]; then
  echo "[entrypoint] running migrations as admin role…"
  DATABASE_URL="$DATABASE_URL_ADMIN" python manage.py migrate --noinput
else
  echo "[entrypoint] WARNING: DATABASE_URL_ADMIN not set, skipping migrations"
fi

# Bootstrap a superuser on shell-less hosts (Render free tier): no-ops unless
# BOOTSTRAP_ADMIN_* env vars are set. Runs as the admin role to bypass RLS for
# the user/email writes. Non-fatal — a failure here must never block serving.
echo "[entrypoint] ensuring bootstrap admin (if BOOTSTRAP_ADMIN_* set)…"
DATABASE_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}" python manage.py ensure_admin \
  || echo "[entrypoint] ensure_admin failed (non-fatal)"

exec "$@"
