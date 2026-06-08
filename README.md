# music

A collaborative music player **desktop app** for macOS. All YouTube resolution and
audio streaming happen **locally on your machine** (a bundled `yt-dlp` + a small Rust
reverse-proxy engine); the cloud is a thin metadata/social/sync backend. Listen alone
or start a "jam" and play in sync with friends.

> ⚠️ **Educational / personal-use beta, provided as-is with no warranty.** The hosted
> backend is a throwaway test environment — **accounts and data are ephemeral and can be
> wiped at any time.** Not affiliated with any music or video platform; you're
> responsible for complying with the terms of service of anything it talks to.

**See [`docs/`](docs/README.md)** for architecture, design decisions, and ops
walkthroughs — this README covers the shape of the project, building the app, and
day-to-day commands.

---

## How it works

```
┌─────────────────────────── your Mac ───────────────────────────┐
│  music.app  (Tauri v2 / WKWebView)                              │
│  ┌───────────────────────┐   ┌──────────────────────────────┐  │
│  │ React SPA (the UI)     │──▶│ Rust engine (axum, 127.0.0.1) │  │
│  │ TanStack + Tailwind    │   │  • /stream/:id  ← yt-dlp      │  │
│  └───────────────────────┘   │  • /yt/* search·ingest·match  │  │
│                              │  • /__login  (Google PKCE)     │  │
│                              │  • proxies /api + /ws → cloud  │  │
│                              │  bundles yt-dlp + deno         │  │
│                              └───────────────┬───────────────┘  │
└──────────────────────────────────────────────┼─────────────────┘
                                                │  HTTPS + WSS
                                                ▼
                         Django backend  (api.whirlyfan.com, on Render)
                         metadata · playlists · social · jam sync (Channels)
                         Postgres  ·  NO YouTube traffic ever touches it
```

- **YouTube is the only audio source.** It is resolved and streamed entirely on the
  user's residential IP by the bundled `yt-dlp` — never from the cloud. The Rust engine
  streams the audio progressively and caches it to disk (LRU).
- **Spotify is metadata-only** — album art and filling in missing track details.
- **The cloud stores everything else** — accounts, playlists, the catalog, and real-time
  "jam" playback sync (Django Channels over WebSockets). It never calls YouTube.
- **The web app is retired.** The browser SPA used to deploy as a static site; the
  product is now the desktop app. The same React code is bundled *into* the app.

---

## Download

Grab the latest `.app` from [**Releases**](../../releases) (macOS, **Apple Silicon /
M1+**). The app is ad-hoc signed but **not notarized**, so a downloaded copy is
quarantined and macOS says *"music is damaged and can't be opened"* — it isn't; that's
Gatekeeper blocking an un-notarized app. Clear it once after unzipping:

```bash
xattr -dr com.apple.quarantine /Applications/music.app   # adjust path if elsewhere
```

Then double-click to launch. (Right-click → Open usually does **not** clear the
"damaged" verdict for an un-notarized app — the `xattr` step is the reliable one.)

---

## Build the desktop app from source

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust | stable (rustup) | https://rustup.rs |
| Xcode Command Line Tools | — | `xcode-select --install` |
| Node | 24.16.0 | https://nodejs.org |
| pnpm | 11.3.0 (pinned) | `corepack enable && corepack prepare pnpm@11.3.0 --activate` |

### Build

```bash
cd desktop
pnpm install

# Bake the PUBLIC Google OAuth client id so in-app Google sign-in works.
# (Only the public client id is baked; the client SECRET lives on the backend.)
# Omit it and the app builds fine, but Google login is disabled.
GOOGLE_OAUTH_CLIENT_ID="<your-public-client-id>.apps.googleusercontent.com" \
  pnpm tauri build --bundles app
```

The runnable artifact lands at
`desktop/src-tauri/target/release/bundle/macos/music.app`.

> The `beforeBuildCommand` builds the frontend with `--mode desktop` and embeds it into
> the Rust binary, so the `.app` is self-contained. A proper `.dmg`/notarized installer
> is a future (macOS-CI) concern — `--bundles app` skips the headless `bundle_dmg.sh`
> step. See [`desktop/README.md`](desktop/README.md).

---

## Local development (backend + UI)

The desktop engine talks to the **production** backend (`api.whirlyfan.com`), so the
fast inner loop for UI/backend work is the local web stack behind nginx — same-origin,
so session cookies + CSRF "just work":

```bash
# 1. Env file (defaults are fine for local dev)
cp .env.example .env

# 2. Boot Postgres, install deps, run migrations, seed dev data
make bootstrap

# 3. Bring up db + backend + Vite + nginx + Mailpit
make up

# 4. Open the app in a browser
open http://localhost
```

**Seeded dev accounts** (recreated by every `make seed` / `make bootstrap`; the seed
command refuses to run when `DJANGO_DEBUG=False`):

| Account | Email | Password | Notes |
|---|---|---|---|
| Dev user | `dev@example.com` | `password1234` | Log in via `/login` |
| Admin | `admin@example.com` | `adminpassword123` | Superuser — `/admin/` |

Outgoing email (password reset, verification) is captured locally by **Mailpit** at
http://localhost:8025. See [docs/auth.md](docs/auth.md) for the verification flow.

### What's running after `make up`

| Service | Port | URL | Notes |
|---|---|---|---|
| nginx (dev entry point) | 80 | http://localhost | Routes `/api/*`, `/_allauth/*`, `/admin/*`, `/health` → backend; everything else → Vite |
| Django (DRF + Channels) | 8000 | http://localhost/api/ | OpenAPI at `/api/schema/`; WS jam sync via Daphne/ASGI |
| Vite dev server | 5173 | http://localhost/ | Through nginx (HMR over WS) |
| Postgres 18 | 5432 | — | Dev has two roles: `app_user` (runtime, RLS-enforced) + `app_admin` (migrations/seed) |
| Mailpit | 1025 / 8025 | http://localhost:8025 | Local SMTP catch-all |

---

## Stack

**Desktop** — [Tauri v2](https://tauri.app) (WKWebView) + a Rust **axum** engine:
`reqwest` (cloud proxy with a server-side cookie jar), `tokio-tungstenite` (WS relay for
jam sync), `tauri-plugin-shell` (runs the bundled `yt-dlp`), `sha2`/`base64`/`getrandom`
(Google PKCE), `keyring` (session token in the macOS Keychain). Bundles `yt-dlp` + `deno`
as sidecars.

**Frontend** — React 19, Vite, TypeScript, Tailwind v4, shadcn/Radix primitives,
TanStack Query / Router / Form / Table, dnd-kit (drag-reorder), Zod, Zustand, Sonner.
Same code in the browser (dev) and embedded in the app (prod).

**Backend** — Python 3.14 + Django 5 + DRF + uv. django-allauth (headless, social, MFA)
+ fido2, django-rls (Postgres row-level security), **Channels + Daphne** (WebSocket jam
sync), drf-spectacular (OpenAPI), django-axes / django-ratelimit (abuse), django-waffle
(flags), django-health-check (`/health/`), django-pghistory + django-pgtrigger (audit),
django-csp / django-permissions-policy, Sentry, gunicorn. **No YouTube libraries** — the
cloud never touches YouTube.

**Infra** — Docker Compose for local dev (Postgres 18, Django, Vite, nginx, Mailpit).
Backend deploys to **Render** from `render.yaml` (Docker image, auto-deploy on `main`,
custom domain `api.whirlyfan.com`). Pre-push git hook auto-fixes lint + blocks broken
pushes. CI on GitHub Actions.

---

## Repository layout

```
.
├── desktop/                Tauri v2 desktop app (the product)
│   └── src-tauri/
│       ├── src/lib.rs       Rust engine: /stream, /yt/*, /__login, /api + /ws proxy
│       ├── binaries/        bundled yt-dlp + deno (aarch64-apple-darwin)
│       └── tauri.conf.json
├── frontend/               React + Vite + TS + TanStack + shadcn (the UI)
│   └── src/
│       ├── routes/          TanStack Router file-based routes
│       ├── components/player/  now-playing bar, full-screen player, jam, queue
│       ├── lib/api/         fetch wrapper + GENERATED types + IS_DESKTOP/engine()
│       └── lib/auth/        allauth headless hooks
├── backend/                Django app (uv-managed)
│   ├── apps/
│   │   ├── users/           Custom user model (email as USERNAME_FIELD)
│   │   ├── core/            RLS post-migrate hook, shared middleware
│   │   ├── catalog/         Tracks/playlists/sources, Spotify enrich, YT match
│   │   ├── rooms/           Listening rooms: queue + playback state + jam sync
│   │   ├── friends/         Friendships
│   │   └── notifications/   In-app notifications
│   └── config/             Django settings (base/dev/prod) + asgi.py (Channels)
├── nginx/nginx.dev.conf    Dev reverse proxy (Vite + Django, same-origin)
├── postgres/init.sql       Creates app_user, app_admin, appdb
├── render.yaml             Render blueprint (backend service + Postgres)
├── docker-compose.yml      Local dev stack
├── Makefile                Common dev tasks
└── docs/                   Architecture, auth, data model, ops
```

---

## Commands reference

Run from the repo root. The Makefile auto-injects the right DB role (`app_admin` for
migrations/seed, `app_user` for runtime).

```bash
# Stack
make up                 # docker compose up -d (db, backend, frontend, nginx, mailpit)
make down               # stop everything
make logs               # tail all logs
make reset              # rebuild backend image + recreate its .venv volume

# Local dev outside Docker (fast hot-reload / debugger)
make dev-backend        # Django runserver as app_user on :8000
make dev-frontend       # Vite dev server on :5173

# Database & migrations
make mm                 # makemigrations (as app_admin)
make migrate            # apply migrations (as app_admin)
make seed               # seed dev data (idempotent; creates dev@/admin@)
make reset-db           # DESTRUCTIVE: drop volume, recreate, migrate, seed
make shell              # Django shell_plus

# Quality
make test               # pytest (RLS isolation + smoke)
make lint               # ruff + ESLint + Prettier check + tsc
make format             # auto-fix everything
make gen-api            # regenerate frontend/src/lib/api/types.ts from /api/schema/
```

> **After changing backend Python deps, run `make reset`, not `make up`** — the backend's
> `.venv` lives in an anonymous Docker volume that survives `up`, so a plain `up` keeps
> using the old venv.

### Building the desktop app

```bash
cd desktop && GOOGLE_OAUTH_CLIENT_ID="<public-id>" pnpm tauri build --bundles app
```

(`cargo` must be on PATH — `source ~/.cargo/env` if a fresh shell can't find it.)

---

## Deploying the backend

The backend auto-deploys to **Render** from [`render.yaml`](render.yaml) on every push to
`main` (Docker image; `migrate` runs idempotently on boot before gunicorn). Secrets
(`DJANGO_SECRET_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SPOTIFY_CLIENT_SECRET`, …) are set in
the Render dashboard, not in the repo. See
[docs/ops/deploy-render.md](docs/ops/deploy-render.md).

There is **no web frontend deploy** — the app is the deliverable. `api.whirlyfan.com` is
the backend's custom domain (the desktop engine proxies `/api` + `/ws` to it).

---

## Notes & footguns

- **RLS returns zero rows when `rls.user_id` isn't set.** If an authenticated request
  sees empty results, check `RLSContextMiddleware` and that `request.user` is populated.
  In dev/test the runtime role is `app_user` (no BYPASSRLS); on Render the managed
  Postgres has a single owner role, so RLS policies are owner-bypassed there.
- **Don't run the backend as `app_admin`** in dev — it bypasses RLS. `.env` defaults to
  `app_user`; the Makefile injects `app_admin` only for migrations/seed.
- **Custom User model is set in stone** (`apps.users.User`) — changing `AUTH_USER_MODEL`
  later is painful.
- **Desktop Google login** uses an `http://127.0.0.1:8765` loopback redirect (registered
  in the Google OAuth client) → the Rust engine exchanges the code with the backend and
  stores the session token in the Keychain. Only the **public** client id is baked into
  the binary; the secret stays on the backend.
- **Tests need the right DB URL:** `DATABASE_URL=postgres://app_admin:app_admin@localhost:5432/appdb uv run pytest`.
