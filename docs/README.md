# Docs

Living documentation for this template. Lives next to code, reviewed in
PRs, versioned with git. These pages are the source of truth.

## When to update what

| You're changing… | Touch this file | And maybe |
|---|---|---|
| The set of services in compose | `architecture.md` | `ops.md` if env vars change |
| Anything about nginx (proxy, routes, role) | `architecture/nginx.md` | `architecture.md` topology section |
| Login flow, sessions, CSRF, social, MFA | `auth.md` | new ADR if it's an architectural shift |
| RLS policies, two-role Postgres setup | `rls.md` | tests in `apps/notes/tests/test_rls.py` |
| Who can do what (staff vs superuser vs groups) | `permissions.md` | |
| Hatchet workflow topology, DAG patterns | `jobs.md` | |
| TanStack stack, theming, FE auth wrapper | `frontend.md` | |
| Compose, env vars, migrations, seed | `ops.md` | `architecture.md` if a service is added |
| Render / GCP deploy mechanics | `ops/deploy-*.md` | new ADR if changing target |
| A **one-way-door choice** (rename, swap, drop) | new `decisions/000N-*.md` | the affected topic doc |

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

## Architecture Decision Records (ADRs)

Short, immutable records of one-way-door choices. To revisit a decision, write
a **new** ADR that *supersedes* the old one — never edit accepted ADRs.

| ID | Title |
|---|---|
| [0001](decisions/0001-rls-day-one.md) | Row-Level Security enforced at the database layer, day one |
| [0002](decisions/0002-hatchet-lite-over-celery.md) | Hatchet Lite as the workflow engine, over Celery / Procrastinate |
| [0003](decisions/0003-allauth-headless.md) | django-allauth headless mode for auth (over djoser / dj-rest-auth) |
| [0004](decisions/0004-tanstack-router.md) | TanStack Router over React Router |
| [0005](decisions/0005-render-first-deploy.md) | Deploy to Render first; GCP/k8s when the project justifies it |
| [0006](decisions/0006-mfa-optional-staff-required.md) | 2FA optional for users, mandatory for `/admin/` access |
| [0007](decisions/0007-dev-branch-staging.md) | `dev` branch as integration target; `main` as deploy line |
| [0008](decisions/0008-email-verification-optional-plus-gate.md) | Email verification: `optional` allauth mode + middleware/route gate |

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
