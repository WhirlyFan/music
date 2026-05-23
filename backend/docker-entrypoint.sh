#!/bin/sh
# Run migrations as the admin role, then drop privileges and exec the real
# command. Idempotent — `migrate` is a no-op when the schema is current, so
# this is safe to run on every container start.
#
# DATABASE_URL_ADMIN must be set (it is, by docker-compose / .env). The
# runtime DATABASE_URL stays scoped to the app_user role so RLS applies
# normally once the process is serving.

set -e

if [ -n "$DATABASE_URL_ADMIN" ]; then
  echo "[entrypoint] running migrations as admin role…"
  DATABASE_URL="$DATABASE_URL_ADMIN" python manage.py migrate --noinput
else
  echo "[entrypoint] WARNING: DATABASE_URL_ADMIN not set, skipping migrations"
fi

exec "$@"
