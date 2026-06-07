# Ops

Day-to-day operating: compose, env vars, migrations, seed, health checks.
For deploy specifics, see [`ops/deploy-render.md`](ops/deploy-render.md).

## Local dev — first time

```sh
git clone <repo> && cd music
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

Trunk-based / GitHub Flow — `main` is the single long-lived branch.

- **Branch off `main` for everything** (feature, fix, hotfix).
- **PR → `main`.** CI gates it (Backend, Frontend, Security). Squash merge.
- **Merging to `main` deploys to prod** — Render auto-deploys `main`. Keep
  branches small so each merge is a low-risk increment.
- **No `dev` branch.** One trunk = no squash-merge hash divergence.
- Risky change that needs validation before prod? Use a feature flag or a
  Render preview deploy — not a shared staging branch.

See [decisions.md → Workflow](decisions.md#workflow--trunk-based-main-only).

## Makefile targets

| Target | What it does |
|---|---|
| `make bootstrap` | First-time setup (above) |
| `make up` / `make down` | Start / stop the stack |
| `make logs` / `make ps` | Tail / inspect |
| `make mm` | `makemigrations` |
| `make migrate` | `migrate` (admin role) |
| `make seed` | Seed data (admin role; refuses if `DEBUG=False`) |
| `make reset` | Rebuild the backend image + recreate its `.venv` volume. **Run this after changing backend deps** — a plain `up` keeps the stale venv. DB untouched. |
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
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | Spotify ingest (metadata only); unset → "not configured" |
| `HATCHET_CLIENT_TOKEN` | for worker | Generated via `make hatchet-token` |
| `HATCHET_CLIENT_HOST_PORT` | for worker | `hatchet:7077` in compose |
| `DJANGO_LOG_LEVEL` | optional | Default `INFO` |

### Frontend (Vite-baked)
| Variable | Required? | Notes |
|---|---|---|
| `VITE_API_BASE` | ✅ | Usually `/api/v1` because we proxy same-origin |
| `VITE_SENTRY_DSN` | optional | Frontend error tracking |

## YouTube

**All YouTube I/O runs on the desktop app — the cloud (Django) never touches
YouTube.** Search, playlist/video metadata ingest, audio resolve, and the audio
bytes all go through the bundled `yt-dlp`/`deno` in `desktop/src-tauri`, off the
user's own residential IP. So there's no `yt-dlp`/`deno`/`ffmpeg` in the backend
image, no `YOUTUBE_COOKIES`/proxy, and no datacenter bot wall to fight. Django just
stores the metadata the desktop sends:

- **Match-on-play** — the desktop's `/yt/search` returns candidates; the cloud
  (`match.match_track_to_youtube`) scores + persists them. No candidates → no match.
- **Paste a YouTube URL** — the desktop's `/yt/ingest` extracts the playlist/video;
  the cloud (`services.ingest_youtube`) persists the supplied metadata. A YouTube URL
  with no metadata is rejected (the cloud can't extract it).
- **Audio** — the desktop's `/stream/<video_id>` resolves + proxies the bytes.

**Format/client matters (desktop engine).** `resolve_audio` (`desktop/src-tauri/src/lib.rs`)
pins the progressive **itag-140 m4a/AAC** stream via the **`web_embedded`** player
client. The default clients return only an **HLS manifest** for `bestaudio` (YouTube's
SABR rollout) — a plain `<audio>` element can't play HLS in Chrome, and on Safari the
visualizer's `createMediaElementSource` can't tap a native-HLS stream, so playback
goes **silent while the timeline keeps advancing**. `web_embedded` is the one client
whose progressive URL we can fetch directly, with **no PO token / visitor-data /
residential proxy needed** — which is why neither a PO-token provider nor a Tailscale
residential exit (both since removed) was ever the fix. If audio goes silent, check
that resolution still returns a non-HLS `https` m4a URL first.

> Duration note: the player shows + ends on the **metadata** duration
> (`active_source.duration_ms`, from yt-dlp), never the browser's `el.duration` —
> some itag-140 AAC streams make Chromium report it ~2× too long.

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
   (superuser). Always present after seed; flags + passwords reset every run.
   MFA is optional — neither account is enrolled; enroll from Settings if wanted.
2. **Fake users** (`--fake-users N`, default 5) — anonymous via UserFactory.
   Makes the DB feel busy + lets you visually verify RLS isolation in
   `/admin/`.

Each fake user gets a few owned playlists via `seed_user_data()` — RLS-scoped,
so owner isolation is visible in `/admin/`. The dev account gets the real
Spotify/Apple seed playlists instead.

Flags:
- `--playlists N` (default 2) — owned playlists per fake user
- `--fake-users N` (default 5) — anonymous accounts
- `--flush` — wipe the catalog + non-superuser users before seeding
- `--skip-real-playlists` — skip the network import of the real seed playlists
- `--allow-in-prod` — escape hatch from the DEBUG guard (almost certainly wrong)

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
docker compose exec backend pytest apps/catalog/tests/test_rls.py -v
```

RLS load-bearing tests live in `apps/catalog/tests/test_rls.py` (Playlist
owner-isolation + public-read).

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
