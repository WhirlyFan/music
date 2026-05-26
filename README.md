# react-django-template

Full-stack starter: Django + DRF + Postgres + RLS + Hatchet on the backend,
React + Vite + TanStack + shadcn on the frontend. Auth, permissions, RLS,
and background workflows wired up day one — owned end-to-end, no SaaS
dependency.

**See [`docs/`](docs/README.md) for architecture, design decisions, and ops
walkthroughs** — the README covers installation and day-to-day commands; the
docs explain *why* the template is shaped this way.

---

## Installation

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker | 24+ (with `docker compose`) | https://docs.docker.com/get-docker/ |
| pnpm | 11.3.0 (pinned) | `corepack enable && corepack prepare pnpm@11.3.0 --activate` |
| uv | 0.11+ | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.13 | (managed by uv; optional locally) | `uv python install 3.13` |

You don't strictly need Python on your host — `uv` will fetch 3.13 the first
time it needs it.

### First-time setup

```bash
# 1. Clone
git clone <repo-url> react-django-template && cd react-django-template

# 2. Env file (defaults are fine for local dev)
cp .env.example .env

# 3. Boot Postgres, install deps, run migrations, seed dev data
make bootstrap

# 4. Hatchet first-run: mint an API token
docker compose up -d hatchet
open http://localhost:8888                # admin@example.com / Admin123!!
# In the UI: Settings → API Tokens → Create. Copy the token.
echo "HATCHET_CLIENT_TOKEN=<paste-here>" >> .env

# 5. Bring up the rest of the stack
make up

# 6. Open the app
open http://localhost                     # routed through nginx → frontend + backend
```

**Default accounts** (seeded automatically by `make seed` / `make bootstrap`):

| Account | Email | Username | Password | Notes |
|---|---|---|---|---|
| Dev user | `dev@example.com` | `dev` | `password1234` | Regular user — log in via `/login` |
| Admin | `admin@example.com` | `admin` | `adminpassword123` | Superuser — log in via `/admin/` |

Passwords are reset to these values on every `make seed`, so it's safe to
change them in `/admin/` for local testing — `make seed` brings them back.

**Seeded users skip email verification** — they're created with a verified
`EmailAddress` row, so `dev` and `admin` log in straight to home. A
freshly-signed-up user from `/signup` lands on `/account/verify-email`
(the holding page) and stays there until they click the link in their
email. In dev, that email lands in Mailpit (`http://localhost:8025`).
See [docs/auth.md](docs/auth.md) and [ADR 0008](docs/decisions/0008-email-verification-optional-plus-gate.md)
for the full flow.

### Deploying to production

```bash
# On any docker-capable host:
git clone <repo> && cd react-django-template
cp .env.production.example .env
$EDITOR .env                              # fill in real secrets — see comments in the file

# First-time only: mint a Hatchet API token
docker compose up -d hatchet
# → open http://<host>:8888, log in, Settings → API Tokens → Create
# → paste the token into HATCHET_CLIENT_TOKEN in .env

# Bring everything up using the prod overrides
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Subsequent deploys are just:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Migrations run automatically** on backend startup (the entrypoint wrapper runs
`migrate` as the admin role before starting gunicorn — idempotent on every restart).

**TLS:** put Cloudflare (free tier) in front. Their proxy handles certs, DDoS,
and CDN at no cost. Configure `SECURE_PROXY_SSL_HEADER` (already in
`config/settings/prod.py`) so Django trusts the upstream `X-Forwarded-Proto`.

**Hosts that work out of the box:** Render, Railway, Fly.io, any VM with
Docker installed. Managed Kubernetes adds zero-downtime rolling deploys
but is overkill for solo dev.

### What you have running after `make up`

| Service | Port | URL | Notes |
|---|---|---|---|
| nginx (entry point) | 80 | http://localhost | Routes `/api/*`, `/_allauth/*`, `/admin/*` → backend; everything else → frontend |
| Django (DRF API) | 8000 | http://localhost/api/ | OpenAPI schema at `/api/schema/`, docs at `/api/docs/` |
| Vite dev server | 5173 | http://localhost/ | Through nginx in dev (HMR via WS upgrade) |
| Postgres | 5432 | — | Two roles: `app_user` (runtime, RLS-enforced), `app_admin` (migrations/seed) |
| Hatchet Lite | 7077 (gRPC), 8888 (UI) | http://localhost:8888 | Workflow engine |
| Mailpit | 1025 (SMTP), 8025 (UI) | http://localhost:8025 | Captures outgoing email locally — see [docs/ops/email.md](docs/ops/email.md) |
| Worker | — | — | Runs `manage.py hatchet_worker` against Hatchet |

---

## Using this as a template

When you clone this repo for a real project, here's what you need to change.
Skip the rename if you're just kicking the tires.

### 1. Rebrand (one-time find-and-replace)

The string `react-django-template` appears in 44 places — service names,
package metadata, route titles, the TOTP issuer label, the docker-compose
project name, etc. They're all real labels you want to update.

```bash
# Pick your new name and run from the repo root:
NEW=my-app
grep -rl "react-django-template" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.venv \
  --exclude-dir=dist --exclude=pnpm-lock.yaml --exclude=uv.lock \
  | xargs sed -i '' "s/react-django-template/${NEW}/g"   # macOS

# On Linux: sed -i (no '') instead of -i ''
```

Then verify and commit:

```bash
grep -r "react-django-template" . --exclude-dir=node_modules --exclude-dir=.git
# Should print zero matches.
```

Files that **don't** get renamed by this:
- `pnpm-lock.yaml`, `uv.lock` — regenerated automatically by next install
- `dist/`, `node_modules/`, `.venv/` — build artifacts; gitignored
- Per-repo git config (`user.email`, `user.name`) if you want a project-specific identity — set via `git config user.email ...`

### 2. Required env vars for production

Before deploying, set these in your deploy target's env (Render dashboard / k8s secret / etc.):

| Variable | What to set | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | random 50+ chars | Render's `generateValue: true` auto-creates |
| `DJANGO_ALLOWED_HOSTS` | comma-separated backend hostnames | e.g. `api.yourdomain.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | full URLs incl. `https://` | e.g. `https://app.yourdomain.com` |
| `DJANGO_CORS_ALLOWED_ORIGINS` | full URLs incl. `https://` | Same shape as CSRF |
| `FRONTEND_ORIGIN` | the user-facing frontend URL | Drives reset/verify email links |
| `DATABASE_URL` | Postgres connection | Render auto-wires from linked DB |
| `DATABASE_URL_ADMIN` | same DB, optionally an admin role | For migrations + seed |
| `MFA_FIELD_ENCRYPTION_KEY` | Fernet key | Encrypts TOTP secrets at rest. Generate fresh per environment: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. **Never reuse** the dev key from `.env.example` in prod. |
| `RESEND_API_KEY` | Resend API token (optional) | Without it, password-reset + verification emails silently fail. See [docs/ops/email.md](docs/ops/email.md). |
| `DEFAULT_FROM_EMAIL` | From: address for outgoing email | Defaults to `onboarding@resend.dev` in prod; override once your domain is DKIM-verified |

`render.yaml` already wires these for the Render deploy — see [docs/ops/deploy-render.md](docs/ops/deploy-render.md). For other targets, the env-var contract is the same.

> ⚠️ **`MFA_FIELD_ENCRYPTION_KEY` is irrecoverable.** If you lose the key on a deploy with existing TOTP enrollments, every user must re-enroll. Treat it like `DJANGO_SECRET_KEY` — back it up in a secrets manager, don't rotate without a migration plan. The committed dev key (`eNu83iHsGyg...` in `.env.example`) is *intentionally* in the repo because it only ever protects local dev data; do not reuse it in prod.

### 3. Optional integrations (wire when ready)

| Integration | How | Cost | Why |
|---|---|---|---|
| **Email delivery** (password reset, signup verification) | Mailpit wired in dev. Resend wired in prod via Anymail — just paste `RESEND_API_KEY` into Render dashboard. See [docs/ops/email.md](docs/ops/email.md) | Free (3K/mo on Resend) | Without the API key, reset emails fail silently |
| **Sentry error monitoring** | Set `SENTRY_DSN` env var | Free tier generous | Backend + frontend both auto-report |
| **Social login** (Google etc.) | Add provider to `INSTALLED_APPS` + config — see [docs/auth.md](docs/auth.md) | Free | `allauth.socialaccount` is already installed |
| **Custom domain** | Render dashboard or your DNS provider | Free on Render | Replace `*.onrender.com` URLs throughout |
| **Hatchet for workflows** | Already wired in dev; deferred for Render Phase A — see [docs/jobs.md](docs/jobs.md) | $0 free self-hosted; +$14/mo on Render | Background DAG engine |
| **File storage** (avatars, uploads, exports) | Not yet wired — pick S3-compatible (Cloudflare R2: free 10 GB + free egress) when first needed; swap to GCS later via `django-storages` env var. See [docs/ops/storage.md](docs/ops/storage.md) | Free for hobby (R2 10 GB) | No use case yet; design path locked in so future wiring is mechanical |

### 4. Dev-only credentials baked into the seed (DO NOT touch unless you understand why)

The seed command creates two known accounts for local dev:

- `dev@example.com` / `password1234`
- `admin@example.com` / `adminpassword123` (with a fixed TOTP secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`)

These exist so `make seed` reproduces the same login state every time
— useful for testing flows in development. The seed command **refuses
to run when `DJANGO_DEBUG=False`** so these credentials can never end
up in production. See [docs/ops.md](docs/ops.md) for details.

If you want to remove them entirely (e.g. you don't want them visible in
your repo), edit `KNOWN_ACCOUNTS` in `backend/apps/core/management/commands/seed.py`.

### 5. GitHub repo settings (manual, post-fork)

These don't transfer when you fork — you have to set them up on the new repo:

- **Branch protection ruleset** — see the existing one for reference. Required rules: `pull_request`, `required_linear_history`, `required_status_checks` (after CI runs at least once). Configured in repo Settings → Rules → Rulesets.
- **GitHub Actions secrets** — none required for CI itself, but any deploy step you add later will need its own secrets (Render API key, AWS keys, etc.).
- **CODEOWNERS** — optional, if you want PR reviews routed.

---

## Commands reference

All commands run from the repo root. The Makefile auto-injects the right
DB role (`app_admin` for migrations/seed, `app_user` for runtime).

### Docker / stack

```bash
make up                       # docker compose up -d (everything)
make down                      # docker compose down
make logs                      # tail logs from all services
make ps                        # show running services
```

### Local dev (outside Docker)

```bash
make dev-backend               # Django runserver as app_user on :8000
make dev-frontend              # Vite dev server on :5173
```

Useful if you want fast hot-reload + a debugger attached. Postgres + Hatchet
still need to be running via `docker compose up -d db hatchet`.

### Database & migrations

```bash
make mm                        # makemigrations (as app_admin)
make migrate                   # apply migrations (as app_admin)
make seed                      # seed dev data (idempotent; creates dev@example.com)
make reset-db                  # DESTRUCTIVE: drop volume, recreate, migrate, seed
make shell                     # Django shell_plus with auto-imports
```

Multi-dev migration workflow: commit the `apps/<app>/migrations/000N_*.py`
file alongside your model change. Other devs run `make migrate` to sync.

### Tests

```bash
make test                      # pytest (RLS isolation tests + smoke)

# A specific test:
cd backend && uv run pytest apps/notes/tests/test_rls.py::test_user_isolation -v
```

The RLS tests in `backend/apps/notes/tests/test_rls.py` prove:
- The Note table has Postgres RLS enabled with the `owner_isolation` policy
- Anonymous traffic (no `rls.user_id`) returns zero rows
- User A cannot see User B's notes — even when the viewset returns
  `Note.objects.all()` with no app-layer filter

### Lint, format, type-check

```bash
make lint                      # ruff + ESLint + Prettier check + tsc
make format                    # auto-fix everything

# Individually:
cd backend  && uv run ruff check --fix && uv run ruff format
cd frontend && pnpm lint:fix && pnpm format && pnpm typecheck
```

A pre-push hook at `.githooks/pre-push` does this automatically on `git push`,
linting only files unique to your branch. To skip in an emergency:

```bash
LINT_SKIP="path/regex" git push   # skip matching files
git push --no-verify              # skip the hook entirely
```

### API type generation

The frontend's `src/lib/api/types.ts` is generated from the backend's OpenAPI
schema. Run after backend API changes:

```bash
make gen-api                   # pulls /api/schema/ → types.ts
```

Backend must be running (either `make up` or `make dev-backend`).

### Hatchet

```bash
make hatchet-token             # prints token-creation walkthrough
docker compose logs -f hatchet # watch engine logs
docker compose logs -f worker  # watch worker logs (workflow execution)
open http://localhost:8888     # workflow runs UI (login: admin@example.com / Admin123!!)
```

Trigger a workflow from the API:

```bash
curl -X POST http://localhost/api/jobs/trigger/ \
  -H "Content-Type: application/json" \
  -H "Cookie: $(curl -c - -s http://localhost/_allauth/app/v1/config | grep csrftoken)" \
  -d '{"workflow": "HelloWorkflow", "input": {"name": "world"}}'
```

### Admin / debugging

```bash
# Create a superuser for /admin/
cd backend && DATABASE_URL=postgres://app_admin:app_admin@localhost:5432/appdb \
  uv run python manage.py createsuperuser

# Open the Django admin
open http://localhost/admin/

# Connect to Postgres
docker compose exec db psql -U postgres appdb
docker compose exec db psql -U app_user appdb       # as the RLS-constrained role

# Show RLS policies
docker compose exec db psql -U postgres -d appdb -c \
  "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE '%_note';"
```

---

## Stack

**Backend** — Python 3.13 + Django 5 + DRF + uv, custom user model
(email as USERNAME_FIELD), django-allauth (headless), django-rls (Postgres
RLS policies on models), drf-spectacular (OpenAPI), django-axes
(brute-force lockout), django-ratelimit, django-health-check
(`/health/`), django-pghistory (Postgres-trigger audit log),
django-guid (request correlation → Sentry transaction_id),
Hatchet SDK (durable workflows), gunicorn for prod.

**Frontend** — React 19, Vite, TypeScript, pnpm, Tailwind v4, shadcn/ui
primitives, TanStack Query / Router / Form / Table, Zod schemas,
ESLint + Prettier, `openapi-typescript` for generated types.

**Infra** — Docker Compose orchestrating Postgres 17 (with two roles),
Django + worker, Hatchet Lite, Vite (dev) or static build (prod), nginx
reverse proxy. Pre-push git hook auto-fixes lint + blocks broken pushes.

---

## Architecture highlights

- **Two Postgres roles.** `app_user` (no BYPASSRLS) is the runtime role —
  RLS policies are enforced. `app_admin` (BYPASSRLS) is used only by
  migrations, the seed command, and other admin operations.
- **RLS day-1.** The `Note` and `WorkflowRun` models inherit `RLSModel`
  with a `UserPolicy`. The `RLSContextMiddleware` sets per-request
  `rls.user_id`. **Even if a viewset forgets `.filter(owner=request.user)`,
  the database blocks cross-user reads.** Proof is in the test suite.
- **Same-origin everywhere.** Nginx fronts both apps so session cookies +
  CSRF "just work" — no CORS dance, no JWT plumbing.
- **Workflows on Hatchet Lite.** First-class DAGs, per-step durability +
  retries — critical for LLM workflows where re-running steps costs real
  money. Self-hosted at $0.
- **Generated API types.** drf-spectacular → OpenAPI → openapi-typescript →
  TypeScript types. Frontend uses a thin `fetch` wrapper with those types.

---

## Repository layout

```
.
├── backend/                Django app (uv-managed)
│   ├── apps/
│   │   ├── users/          Custom user model
│   │   ├── core/           RLS post-migrate hook, shared middleware
│   │   ├── notes/          Day-1 RLS-protected Note model + viewset + tests
│   │   └── jobs/           Hatchet workflows + WorkflowRun tracking
│   ├── config/             Django settings (base/dev/prod)
│   └── tests/              Shared pytest fixtures (set_rls_user, etc.)
├── frontend/               Vite + React + TS + TanStack + shadcn
│   ├── src/
│   │   ├── routes/         TanStack Router file-based routes
│   │   ├── lib/api/        fetch wrapper + GENERATED types
│   │   ├── lib/auth/       allauth headless hooks
│   │   └── lib/query/      TanStack Query keys + Note hooks
│   └── .claude/skills/     Project-scoped Claude skills (frontend)
├── nginx/                  Reverse-proxy configs (dev + prod)
├── postgres/init.sql       Creates app_user, app_admin, appdb, hatchetdb
├── .githooks/pre-push      Auto-fix + re-lint changed files
├── docker-compose.yml      Base compose
├── docker-compose.prod.yml Prod overrides (gunicorn, prod nginx)
├── Makefile                Common dev tasks
└── .env.example            Documented env vars
```

---

## Footguns to know

- **RLS silently returns zero rows** when `rls.user_id` isn't set. If an
  authenticated request unexpectedly sees empty results, check that
  `RLSContextMiddleware` is wired up and `request.user` is populated.
- **Don't run the web container as `app_admin`** — it bypasses RLS. `.env`
  defaults to `app_user`; the `Makefile` injects `app_admin` only for
  commands that need it.
- **Hatchet worker fails to start without `HATCHET_CLIENT_TOKEN`.** Follow
  the first-time setup above before `make up`.
- **Custom User model is set in stone after the first migrate.** Already
  done here — `apps.users.User` — but changing `AUTH_USER_MODEL` later is
  painful.

---

## Deferred / future work

- **Realtime** — Channels + Redis + Postgres `LISTEN/NOTIFY`. ASGI server
  already configured in `config/asgi.py`.
- **Object-level permissions** — `django-guardian` (dynamic grants) or
  `django-rules` (predicate logic). Add when you build sharing/collab.
- **Multi-tenant organizations** — switch RLS scope from `user_id` to
  `tenant_id` in addition to (or instead of) user.
- **File storage** — `django-storages` + S3/R2 + `django-cleanup`.
- **CI** — GitHub Actions: ruff + pytest + ESLint + Prettier --check + tsc + build.
- **Deploy target** — pick Fly / Railway / Render / AWS; `docker-compose.prod.yml`
  is the starting point.
- **Sentry** — already wired; set `SENTRY_DSN` in `.env` to activate.
