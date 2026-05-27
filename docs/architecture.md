# Architecture

High-level shape of the system. For per-topic depth see the other docs in this folder.

## Goal of this template

A production-quality full-stack starter — auth, permissions, RLS,
background jobs, realtime-ready — built on Django + Postgres so we own the
entire stack and can extend it freely. Same-repo monorepo with a React
frontend.

## Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Python tooling | **uv** | 10-100× faster than pip; single tool for deps + lockfile + venvs |
| Web framework | **Django 5.x** | Mature, batteries-included, built-in ORM + migrations |
| API framework | **DRF** | Best auth/permissions ecosystem for the "complete package" goal |
| Auth | **django-allauth (headless)** | Modern replacement for allauth + dj-rest-auth combo; built-in MFA, social, OpenAPI |
| Row-Level Security | **django-rls** | Postgres RLS policies on models — defense in depth at the DB layer ([rls.md](rls.md)) |
| Audit log | **django-pghistory** | Postgres-trigger audit — captures mutations from ORM, raw SQL, admin, anywhere |
| Brute-force | **django-axes** | Login lockout per (user + IP) |
| Rate limits | **django-ratelimit** | Decorator-based per-IP / per-user limits |
| Health checks | **django-health-check** | `/health/` endpoint validates DB, cache, storage |
| Request correlation | **django-guid** | X-Request-ID → log records + Sentry `transaction_id` |
| Database | **Postgres 17** | Via Docker locally; managed Postgres in cloud |
| ORM | **Django ORM** | Built-in |
| WSGI server (prod) | **gunicorn** | Standard. Swap for daphne/uvicorn when we need Channels |
| Background jobs | **Hatchet Lite** | Postgres-backed DAG engine. ([jobs.md](jobs.md)) |
| Email | **django-anymail** | Provider-agnostic backend; required for allauth verify + reset |
| OpenAPI | **drf-spectacular** | Feeds the frontend's TS type generator |
| Frontend build | **Vite + pnpm** | Fast HMR, lockfile-driven, modern TS |
| Frontend UI | **shadcn/ui + Tailwind v4** | Copy-paste components we own |
| Frontend data | **TanStack Query** | Caching/refetching layer |
| Frontend routing | **TanStack Router** | File-based, typed routes ([decision](decisions.md#frontend-routing--tanstack-router)) |
| Frontend forms | **TanStack Form + Zod** | Type-safe, schema-driven |
| Frontend tables | **TanStack Table** | Headless table primitives |
| FE API client | **openapi-typescript** | Reads OpenAPI → TS types; `fetch` wrapper, no runtime client |
| Reverse proxy | **nginx** | Same-origin dev + self-hosted prod option ([architecture/nginx.md](architecture/nginx.md)) |
| Error monitoring | **Sentry** | DSN-driven; opt-in via env |
| Orchestration | **Docker Compose** | One file, one command, portable |
| Linters | **ruff (BE) / ESLint + Prettier (FE)** | One tool per side |
| Pre-push hook | **`.githooks/pre-push`** | Auto-fix + re-lint changed files |

## Services

```
                   ┌────────── browser ──────────┐
                   │                              │
                   ▼                              │
              localhost:80                        │
                   │                              │
                   ▼                              │
              ┌─────────┐                         │
              │  nginx  │                         │
              └────┬────┘                         │
                   │                              │
       ┌───────────┼────────────┐                 │
       │           │            │                 │
       │           │            │                 │
   /api/*      / (everything    /hatchet-ui/*     │
   /admin/*    else, incl HMR)  (optional)        │
   /_allauth/* SPA routes                         │
   /static/*                                      │
       │           │            │                 │
       ▼           ▼            ▼                 │
   ┌────────┐  ┌──────────┐  ┌──────────┐         │
   │backend │  │frontend  │  │ hatchet  │         │
   │Django  │  │Vite dev  │  │  Lite    │─────────┘
   │+ DRF   │  │server    │  │(engine)  │
   └───┬────┘  └──────────┘  └────┬─────┘
       │                          │
       │      ┌───────────────────┘
       ▼      ▼
   ┌──────────┐
   │ Postgres │
   │ (appdb + │
   │ hatchetdb│
   └──────────┘
       ▲
       │
       │ same Django code, different command
   ┌───┴────┐
   │ worker │  subscribes to Hatchet, runs DAG steps
   └────────┘
```

Six containers in dev:

| Service | Image | Role |
|---|---|---|
| `db` | postgres:17.10-alpine | Two DBs (`appdb`, `hatchetdb`) + two roles (`app_user`, `app_admin`) |
| `backend` | local Dockerfile | Django + DRF; `runserver` in dev, `gunicorn` in prod |
| `worker` | same image as backend | Runs `manage.py hatchet_worker`; picks up DAG steps |
| `hatchet` | hatchet-dev/hatchet-lite | Postgres-backed workflow engine; gRPC :7077, admin UI :8080 |
| `frontend` | local Dockerfile | Vite dev server :5173 in dev; built `dist/` served by nginx in prod |
| `nginx` | nginx:alpine | Same-origin reverse proxy at :80 |

## Request paths (illustrative)

### `POST /api/v1/notes/` from the React app (logged in)

1. Browser sends `POST /api/v1/notes/` to `localhost:80`
2. nginx matches `/api/*` → proxies to `backend:8000`
3. Django middleware chain runs (see [auth.md](auth.md) + [rls.md](rls.md))
4. DRF SessionAuthentication reads session cookie → resolves `request.user`
5. `RLSContextMiddleware` sets Postgres session var `rls.user_id = request.user.id`
6. `NoteViewSet.create()` runs; the `INSERT` happens under the `app_user` role
7. RLS policy on the new row uses `current_setting('rls.user_id')` to set `owner_id`
8. Response → nginx → browser; session cookie unchanged

### `POST /api/jobs/<workflow>/trigger`

1. Same routing path through nginx → backend
2. View creates a `WorkflowRun` row (RLS-scoped to user)
3. View calls `hatchet.client.admin.run_workflow(...)` → gRPC to `hatchet:7077`
4. Hatchet engine enqueues; worker picks up next step
5. Worker runs Django code with same ORM + RLS context
6. Frontend polls `/api/jobs/<run_id>/` via TanStack Query

## Dev vs prod topology

| | Dev (`docker-compose.yml`) | Self-hosted prod (`docker-compose.prod.yml`) | Render (Phase A) |
|---|---|---|---|
| Frontend serving | Vite dev server :5173 | Built into nginx image | Render Static Site CDN |
| Backend serving | `runserver` | `gunicorn` | `gunicorn` (free Web Service) |
| TLS termination | None (localhost) | nginx (you bring certs) | Render edge |
| Reverse proxy | dedicated `nginx` container | nginx bundled into frontend image | Render Static Site rewrites |
| Static files | WhiteNoise via Django; nginx primary in prod | nginx serves `dist/` directly | Render Static Site CDN |
| Database | `db` container (volume-backed) | `db` container (or external managed) | Render managed Postgres |
| Hatchet | engine + worker containers | engine + worker containers | Deferred to Phase B (paid tier) |

## Repository layout

```
/
├── docker-compose.yml          # dev — six services
├── docker-compose.prod.yml     # prod overrides
├── render.yaml                 # Render blueprint (Phase A)
├── Makefile                    # bootstrap, mm, migrate, seed, reset-db, lint, test
├── nginx/                      # nginx.dev.conf, nginx.prod.conf
├── .githooks/pre-push          # auto-fix + lint, modeled on usul-policy-research-app
├── backend/                    # Django project
│   ├── Dockerfile              # multi-stage uv build
│   ├── pyproject.toml          # uv-managed
│   ├── manage.py
│   ├── docker-entrypoint.sh    # migrates as admin role, then exec gunicorn/runserver
│   ├── config/                 # Django project (settings, urls, asgi/wsgi)
│   └── apps/                   # users, core, notes, jobs
├── frontend/                   # React + Vite
│   ├── Dockerfile              # multi-stage; prod stage = nginx + dist/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/                    # routes/, components/, lib/
├── docs/                       # ← you are here
└── postgres/init.sql           # creates app_user / app_admin on first boot
```

## What's day-one vs deferred

**Day one (already in the template):**
- Custom user model, allauth headless, MFA opt-in + staff-required
- Postgres RLS via django-rls, two-role setup, staff bypass on /admin/
- Hatchet Lite engine + worker, WorkflowRun tracking model
- TanStack ecosystem (Router, Query, Form, Table) on the frontend
- Pre-push hook, ruff, ESLint+Prettier, tsc
- django-axes, ratelimit, health-check, pghistory, guid
- WCAG AA accessibility, OKLCH color system, design tokens

**Deferred — documented but not yet built:**
- Object-level permissions (`django-guardian` or `django-rules`)
- Realtime via Channels + Redis + LISTEN/NOTIFY
- Social login (allauth.socialaccount enabled but no providers configured)
- File storage (django-storages + S3/R2/MinIO)
- Multi-tenant Organization model
- CI workflows
- Hatchet's RabbitMQ-backed production upgrade

Adding any of these is a few lines of config or a small new app — never a
rewrite — because the foundations were laid day one.

## Out-of-scope

- **SAML / SCIM** — see [auth.md](auth.md) and [decisions.md → MFA policy](decisions.md#mfa-policy-optional-for-users-required-for-admin) (SAML compatibility). Defer until a B2B customer asks.
- **GCP / k8s** — see [ops/deploy-render.md](ops/deploy-render.md) "Migration notes." Same images, different orchestration.
