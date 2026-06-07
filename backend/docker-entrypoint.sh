#!/bin/sh
# Run migrations as the admin role, then drop privileges and exec the real
# command. Idempotent — `migrate` is a no-op when the schema is current, so
# this is safe to run on every container start.
#
# DATABASE_URL_ADMIN must be set (it is, by docker-compose / .env). The
# runtime DATABASE_URL stays scoped to the app_user role so RLS applies
# normally once the process is serving.

set -e

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

exec "$@"
