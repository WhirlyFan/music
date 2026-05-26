# Ops

Day-to-day operating: compose, env vars, migrations, seed, health checks.
For deploy specifics, see [`ops/deploy-render.md`](ops/deploy-render.md).

## Local dev — first time

```sh
git clone <repo> && cd react-django-template
cp .env.example .env          # adjust if needed
make bootstrap                # brings everything up + migrate + seed
```

`make bootstrap` does:
1. `docker compose up -d db` — Postgres only; waits for healthy
2. `docker compose up --build -d` — backend, frontend, worker, hatchet, nginx
3. `make migrate` (uses `DATABASE_URL_ADMIN`)
4. `make seed` (uses `DATABASE_URL_ADMIN`, refuses in non-DEBUG)

Visit `http://localhost`. Login: `dev@example.com` / `password1234`.

## Branching

- **Feature PRs target `dev`.** That's the integration branch — CI gates it,
  same as `main`, so nothing untested lands.
- **`main` is the deploy line.** Render auto-deploys whatever's on `main`.
  Promote `dev → main` when ready to ship: open a PR `dev → main` and merge.
- Hotfixes can branch from `main` directly when a prod issue needs an
  immediate fix — PR to `main`, then sync `dev` from `main` to avoid drift.

See [decisions/0007-dev-branch-staging.md](decisions/0007-dev-branch-staging.md).

## Makefile targets

| Target | What it does |
|---|---|
| `make bootstrap` | First-time setup (above) |
| `make up` / `make down` | Start / stop the stack |
| `make logs` / `make ps` | Tail / inspect |
| `make mm` | `makemigrations` |
| `make migrate` | `migrate` (admin role) |
| `make seed` | Seed data (admin role; refuses if `DEBUG=False`) |
| `make reset-db` | **DESTRUCTIVE.** Drop volume, recreate, migrate, seed |
| `make shell` | Django shell (admin role) |
| `make test` | `pytest` |
| `make lint` | ruff + ESLint + Prettier + tsc |
| `make format` | ruff format + Prettier --write |
| `make gen-api` | Regenerate FE types from backend OpenAPI |
| `make hatchet-token` | Fetch worker token from local Hatchet engine |

## Environment variables

Source of truth: [`.env.example`](../.env.example) at repo root. Real
values go in `.env` (gitignored). The frontend's Vite-build-time vars
live in `frontend/.env` (also gitignored; example tracked).

### Backend
| Variable | Required? | Notes |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | ✅ | `config.settings.dev` or `config.settings.prod` |
| `DJANGO_SECRET_KEY` | ✅ in prod | Auto-generated locally; Render `generateValue: true` in prod |
| `DJANGO_DEBUG` | ✅ | `True` for dev. `False` for prod. The seed command refuses on `False`. |
| `DJANGO_ALLOWED_HOSTS` | ✅ in prod | Comma-separated. `localhost,127.0.0.1` default in dev. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | ✅ in prod | Comma-separated full URLs including `https://` |
| `DJANGO_CORS_ALLOWED_ORIGINS` | optional | Defense-in-depth backstop; not load-bearing when same-origin |
| `DATABASE_URL` | ✅ | Runtime — `app_user` role |
| `DATABASE_URL_ADMIN` | ✅ | Migrations + seed — `app_admin` role |
| `WEB_CONCURRENCY` | optional | Gunicorn workers; default 3, lower on small instances |
| `SENTRY_DSN` | optional | Opt-in error tracking |
| `HATCHET_CLIENT_TOKEN` | for worker | Generated via `make hatchet-token` |
| `HATCHET_CLIENT_HOST_PORT` | for worker | `hatchet:7077` in compose |
| `DJANGO_LOG_LEVEL` | optional | Default `INFO` |

### Frontend (Vite-baked)
| Variable | Required? | Notes |
|---|---|---|
| `VITE_API_BASE` | ✅ | Usually `/api/v1` because we proxy same-origin |
| `VITE_SENTRY_DSN` | optional | Frontend error tracking |

## Database migrations

```sh
# Add a field, then:
make mm                       # makemigrations
git add backend/apps/.../migrations/
make migrate                  # apply

# Other devs:
git pull
make migrate                  # idempotent — applies new ones
```

CI gate: `python manage.py migrate --check` exits non-zero if there's an
un-checked-in migration. Add this to GitHub Actions when CI lands.

### Conflicts on the migration history

Two devs add migrations to the same app in parallel. Django will refuse
to apply with a clear error:

```sh
make mm -- --merge            # creates a merge migration
```

Commit + apply. Done.

### Data migrations

Use `RunPython`. Example pattern: backfilling a new non-null column.
Keep them small + idempotent. Tests should run them (pytest-django does
by default).

## Seed command

[`apps/core/management/commands/seed.py`](../backend/apps/core/management/commands/seed.py).

Two account layers:
1. **`KNOWN_ACCOUNTS`** — `dev@example.com` (regular) + `admin@example.com`
   (superuser with auto-enrolled TOTP). Always present after seed; flags +
   passwords reset every run.
2. **Fake users** (`--fake-users N`, default 5) — anonymous via UserFactory.
   Makes the DB feel busy + lets you visually verify RLS isolation in
   `/admin/`.

Every user gets fake notes via `seed_user_data()`. When you add new
models, append the factory call there — both account types pick it up.

Flags:
- `--notes N` (default 10) — notes per user
- `--fake-users N` (default 5) — anonymous accounts
- `--flush` — wipe notes + non-superuser users before seeding
- `--allow-in-prod` — escape hatch from the DEBUG guard (almost certainly wrong)

### Why the seed bakes a fixed TOTP

`admin@example.com` is `is_staff=True`. The `RequireMfaForStaffMiddleware`
redirects `/admin/` to `/account/mfa` until they enroll. Without the seed
enrolling TOTP, every fresh `make seed` leaves admin unable to reach
`/admin/`. The fixed secret means devs can keep one authenticator-app
entry across reseeds.

The DEBUG guard ensures this can never run in prod. See ADR 0006 and
[auth.md](auth.md).

## Health check

`/health/` is served by `django-health-check`. Checks DB, cache, storage,
migration state. Returns 200 + JSON when healthy, 503 + reasons when not.

```sh
curl http://localhost/health/
```

Render uses it as the backend health check. k8s can use it for readiness
probes.

## Logging

Single stdout sink with a `CorrelationId` filter from `django-guid`.
Every log line carries an X-Request-ID so a single request can be traced
across Django, gunicorn access logs, and the worker.

```
2026-05-25 17:45:30 INFO  [a3b1c2d4...] django.request: GET /api/v1/notes/ 200
```

In production, the container runtime (Render, k8s, etc.) captures
stdout. No in-process file rotation.

## Tests

```sh
make test                          # all backend tests
docker compose exec backend pytest apps/notes/tests/test_rls.py -v
docker compose exec backend pytest -k mfa
```

Backend test count today: **11**.
- 6 in `apps/notes/tests/test_rls.py` (RLS load-bearing)
- 5 in `apps/core/tests/test_staff_mfa_middleware.py` (MFA gate)

## Pre-push hook

`.githooks/pre-push` (installed automatically by `frontend/package.json`'s
`postinstall` script).

1. Diff against `origin/main` via `git merge-base`
2. Frontend: ESLint --fix → re-check → `tsc --noEmit`
3. Backend: `ruff check --fix` → `ruff format` → re-check
4. If auto-fix changed files, **block** with "review + commit" message
5. Errors block; warnings allow push
6. `LINT_SKIP="regex"` env var for emergencies; `--no-verify` is the
   nuclear option

## What happens at container boot

`backend/docker-entrypoint.sh`:

```sh
DATABASE_URL="$DATABASE_URL_ADMIN" python manage.py migrate --noinput
exec "$@"   # gunicorn / runserver
```

Idempotent — `migrate` is a no-op when current. Safe on every boot, in
every environment.

## Backups

Local: none. Run `make reset-db` whenever.

Render Phase A: none (free Postgres has no backups). Phase B upgrade
to Starter includes daily backups + PITR.

GCP later: Cloud SQL automated backups + PITR are first-class.

## See also

- [ops/deploy-render.md](ops/deploy-render.md) — Render Phase A walkthrough
- [architecture.md](architecture.md) — service topology
- [rls.md](rls.md) — the two-role Postgres setup
