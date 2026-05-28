# Docs

Living documentation for this template. Lives next to code, reviewed in
PRs, versioned with git. These pages are the source of truth.

## When to update what

| You're changing… | Touch this file | And maybe |
|---|---|---|
| The set of services in compose | `architecture.md` | `ops.md` if env vars change |
| Anything about nginx (proxy, routes, role) | `architecture/nginx.md` | `architecture.md` topology section |
| Login flow, sessions, CSRF, social, MFA | `auth.md` | revise the Auth section of `decisions.md` if it's an architectural shift |
| RLS policies, two-role Postgres setup | `rls.md` | tests in `apps/notes/tests/test_rls.py` |
| Who can do what (staff vs superuser vs groups) | `permissions.md` | |
| Hatchet workflow topology, DAG patterns | `jobs.md` | |
| TanStack stack, theming, FE auth wrapper | `frontend.md` | |
| Compose, env vars, migrations, seed | `ops.md` | `architecture.md` if a service is added |
| Render / GCP deploy mechanics | `ops/deploy-*.md` | revise the Deploy section of `decisions.md` if changing target |
| A **one-way-door choice** (rename, swap, drop) | a new section (or revision) in [`decisions.md`](decisions.md) | the affected topic doc |

## Topic docs

| File | What it covers |
|---|---|
| [architecture.md](architecture.md) | System overview, services, request path, dev vs prod topology |
| [architecture/nginx.md](architecture/nginx.md) | Why nginx is here, its two roles, per-platform behavior, alternatives ruled out |
| [auth.md](auth.md) | allauth headless, sessions + CSRF, login methods, MFA design, axes lockouts |
| [rls.md](rls.md) | Row-Level Security: two-role Postgres, policies, middleware, staff bypass, testing |
| [permissions.md](permissions.md) | `is_staff` vs `is_superuser`, Groups, object-level perms deferral |
| [jobs.md](jobs.md) | Hatchet topology, WorkflowRun tracking, DAG patterns, upgrade path |
| [frontend.md](frontend.md) | Vite + TanStack stack, theming, auth integration, type codegen |
| [ops.md](ops.md) | Compose, env vars, migrations, seed, health checks |
| [ops/deploy-render.md](ops/deploy-render.md) | First production deploy on Render (Phase A) |
| [ops/email.md](ops/email.md) | Transactional email — providers, wiring, deliverability |
| [ops/storage.md](ops/storage.md) | File storage — deferred design, R2 → GCS migration story |

## Foundational decisions

The load-bearing choices — RLS, auth, jobs, routing, deploy, workflow — live in
one cohesive doc rather than a chronological ADR log: [decisions.md](decisions.md).
Revise it in place when a decision changes, keeping a short note of what we tried
and why it failed (the failure is part of the rationale).

| Topic | Decision |
|---|---|
| [Data layer](decisions.md#data-layer--row-level-security-day-one) | Row-Level Security enforced at the DB, day one |
| [Auth](decisions.md#auth--django-allauth-headless) | allauth headless; MFA optional (required for `/admin/`); email verification `optional` + gate |
| [Background jobs](decisions.md#background-jobs--hatchet-lite) | Hatchet Lite over Celery / Procrastinate |
| [Frontend routing](decisions.md#frontend-routing--tanstack-router) | TanStack Router over React Router |
| [Deploy](decisions.md#deploy--render-first-gcp-when-its-justified) | Render first; GCP/k8s when the project justifies it |
| [Workflow](decisions.md#workflow--trunk-based-main-only) | Trunk-based, `main` only (no long-lived `dev`) |
| [Platform versions](decisions.md#platform-versions--track-latest-stable-pin-django-to-its-lts) | Latest stable everywhere; Django pinned to its LTS |
| [Security headers](decisions.md#security-headers--csp--permissions-policy-enforced-both-layers) | CSP + Permissions-Policy enforced in prod, on both Django and the SPA host |

## House rules

- **One topic per file.** A 2000-line monolith never gets updated.
- **Lead with *why*, not *what*.** Code already says *what*; docs exist to capture intent and trade-offs.
- **Don't document things derivable from code** (file paths, signatures, type shapes). `git grep` is faster than reading prose.
- **Cross-link liberally.** Wikipedia-style internal links keep the docs network navigable as it grows.
- **Verify before you cite.** A doc that says "the X function in Y" is making a claim that X exists at write-time — keep it true.

The full doctrine — ADR rules, the per-topic update matrix, style guide,
and verification checklist — lives in the
[`docs-maintenance` skill](../.claude/skills/docs-maintenance/SKILL.md).
Read it before editing or adding docs.
