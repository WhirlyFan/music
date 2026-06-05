# Foundational Decisions

The load-bearing choices this template makes, and why. One document, organized
by layer — not a chronological log. Each entry states the decision, the
alternatives weighed, and the tradeoff accepted. When a decision is reversed,
we revise it here and keep a short note of what we tried and why it failed —
the failure is part of the rationale, not separate history.

For runtime mechanics, follow the per-topic links. This page is *why*; the
topic docs are *how*.

---

## Data layer — Row-Level Security, day one

**Decision.** Enforce owner isolation at the database with `django-rls` and a
two-role Postgres setup. An owner-scoped model inherits `RLSModel` and declares
`rls_policies = [owner_scoped_policy("<owner_field>")]`. The app connects as
`app_user` (no `BYPASSRLS`); migrations and seed connect as `app_admin`
(`BYPASSRLS`). `RLSContextMiddleware` sets `rls.user_id` per request.

**What's RLS-scoped (and what isn't).** Only **`catalog.Playlist`** — a user's
private library — is RLS-scoped today (reads also allow `is_public` via a
SELECT-only policy; writes stay owner-only). RLS is the DB-level backstop under
the viewset's `created_by` filter. The rest of the catalog (tracks, sources) is
**shared-global** by design, and the **rooms** tables are **app-scoped, not RLS**,
because the roadmap's Jam feature makes a session shareable (others read the
host's room) — RLS there would fight that. *(History: the template shipped with a
`Notes` example as the lone RLS model; Notes was removed when this became a music
app, and RLS was re-pointed at Playlist rather than torn out — a forgotten
`.filter` on someone's library is exactly the leak RLS is meant to catch.)*

**Why, not the alternatives.** Three ways to isolate tenants:

| Approach | Failure mode |
|---|---|
| ORM-only `.filter(owner=request.user)` | A *forgotten filter* — new endpoint, raw SQL, `loaddata`, broad `Prefetch` — silently leaks rows. No error, just wrong data. |
| Schema-per-tenant | Doesn't scale to per-user tenancy; complicates migrations. |
| **RLS policies (chosen)** | Enforced farthest from human error. A forgotten filter or raw SQL still can't escape — the runtime role lacks `BYPASSRLS`. |

**Tradeoff accepted.** More setup (two roles, `init.sql`, middleware); tests
need a fixture to bypass RLS for cross-user setup; single-role managed Postgres
(Render free tier) needs the two roles collapsed in Phase A. In exchange, a
normal-looking ORM call can't introduce a data-leak regression.

**Future.** Sharing features extend the policy with an `EXISTS` subquery against
a `shares` table; org multi-tenancy adds `org_id` alongside `user_id` in the
session vars and policy. See [rls.md](rls.md) and the object-level-permissions
discussion in [permissions.md](permissions.md).

---

## Auth — django-allauth, headless

The template ships a complete auth story — password, email, social, MFA — from
day one. Three decisions hang together here: the library, the MFA policy, and
the email-verification model.

### Library: allauth headless (over djoser / custom DRF)

**Decision.** `django-allauth` with the **headless** add-on. The SPA hits
`/_allauth/browser/v1/*`, which sets standard Django session + CSRF cookies —
the same session DRF `SessionAuthentication` consumes and the same one that
powers `/admin/`.

```python
HEADLESS_ONLY = True
ACCOUNT_LOGIN_METHODS = {"email", "username"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
```

**Why, not the alternatives.** allauth covers password, email verification,
password reset, social, and MFA as standard modules. `djoser` is smaller but
needs extra libraries bolted on for social + MFA, with less coherence. Custom
DRF views are a rewrite of what allauth maintains.

**Tradeoff accepted.** More moving parts than djoser if all we ever wanted was
password login; `AccountMiddleware` ordering matters (after Auth + Messages,
before XFrame). Use the **browser/v1** flavor, never app/v1 — app/v1 returns a
token in JSON that `SessionAuthentication` never sees.

### MFA policy: fully optional (opt-in for everyone)

**Decision.** `MFA_REQUIRED = False` and there is **no staff gate** — 2FA is
opt-in for everyone, staff included. Users enroll (TOTP, recovery codes, or
WebAuthn) voluntarily from Settings; nothing is ever forced.

**Why, not the alternatives.** Required-for-everyone is hostile UX, especially at
signup. We previously force-enrolled `is_staff` users before `/admin/` (a
`RequireMfaForStaffMiddleware` gate + a seeded dev TOTP), but for this app's
threat model that nag wasn't worth it — `/admin/` is already behind login + a
strong password, and when SAML/SSO lands the IdP owns MFA. So the gate, the
seeded admin TOTP, and the `RequireMfaForStaffMiddleware` middleware were
**removed**. *(History: the template shipped role-scoped, required-for-`/admin/`
MFA; dropped in favor of fully optional.)*

**SAML compatibility (when it lands).** App-level MFA stays opt-in; the
customer's IdP owns their MFA policy and we trust the assertion (re-prompting
in-app is the "duplicate MFA" SSO anti-pattern). Invariants that keep this clean:
`useSession()` exposes `is_authenticated` + `mfa_enrolled`, never "how they
logged in"; a social-adapter seam lives in `apps/users/social_adapter.py`;
`AUTHENTICATION_BACKENDS` is a list a SAML backend appends to.

**Tradeoff accepted.** Admin accounts rely on password-only auth unless their
owner opts into 2FA — acceptable here; revisit if `/admin/` exposure grows.

### Email verification: `optional` mode + a gate (not `mandatory`)

**Decision.** `ACCOUNT_EMAIL_VERIFICATION = "optional"`, with verification
enforced by middleware + a frontend route guard rather than allauth's
`mandatory` mode:

- `RequireVerifiedEmailMiddleware` returns `403 {"detail":
  "email_verification_required"}` on `/api/*` when the user is authenticated but
  has no verified `EmailAddress`.
- `routes/__root.tsx` `beforeLoad` reads the email list
  (`GET /_allauth/browser/v1/account/email`) and redirects to
  `/account/verify-email` if none is verified.
- `lib/api/client.ts` also catches `403 email_verification_required` as a
  belt-and-suspenders for mid-session unverification.

**Why, not `mandatory`.** `mandatory` looks like the obvious pick — "can't log
in until verified" — but it has no persistent session: signup returns a 401
carrying an in-flight `verify_email` flow tied to that one request. Close the
tab and the flow (and the resend endpoint) is gone; the single-use link
becomes a dead end on a second click; and `is_authenticated` stays `False`, so
the frontend can't distinguish "anonymous" from "authenticated-but-stuck." The
`optional` + gate model gives a real session at signup (resend works across
browser restarts), one source of truth for "are you verified"
(`EmailAddress.objects.filter(verified=True).exists()` — same query in
middleware and guard), idempotent verification links (a stale click lands on a
holding page that can resend), and an honest `is_authenticated` boolean. It's
also symmetric with the staff/MFA gate: allauth permits the action, we gate it
in middleware — one mental model for both factors.

**Tradeoff accepted.** ~40 lines of middleware + tests we own forever, and two
enforcement layers (exempt-path lists in `_VERIFIED_EMAIL_EXEMPT_PREFIXES` and
the frontend `VERIFY_EXEMPT_PREFIXES`) that must stay in sync — drift shows up
as a signup redirect loop. Each list carries a comment pointing at the other.

> Note: allauth no longer auto-logs-in on a verification-link click (2024
> release), regardless of mode — so a click from a *different* browser lands on
> "Email verified, log in to continue," by design.

See [auth.md](auth.md) for endpoint shapes, CSRF handling, and the runtime flow.

---

## Background jobs — Hatchet Lite

**Decision.** Use **Hatchet Lite** (self-hosted, MIT) as the workflow engine,
day one. The `hatchet` engine container shares our Postgres (separate
`hatchetdb`); the `worker` service is the same Django image as `backend` on a
different command. A small RLS-scoped, audit-logged `WorkflowRun` model in
`appdb` insulates the public API contract (`/api/jobs/...` → `run_id`) from the
orchestrator.

**Why, not the alternatives.** The first real use case is LLM workflows:
fan-out parallel calls, fan-in aggregation, retries — where per-step durability
is a cost concern (without it, one failure in a 100-item batch re-runs and
re-pays for all 100).

| Engine | DAG | Per-step durability | Postgres-backed | Free self-host | UI |
|---|---|---|---|---|---|
| **Hatchet Lite** | ✅ first-class | ✅ | ✅ | ✅ MIT | ✅ |
| Celery | ⚠️ Canvas | ❌ | ❌ Redis/RabbitMQ | ✅ | ⚠️ Flower |
| Procrastinate | ❌ | ⚠️ | ✅ | ✅ MIT | ❌ |
| Temporal | ✅ | ✅ | ❌ | ⚠️ heavy | ✅ |
| Django-q2 | ❌ | ❌ | ✅ | ✅ | ⚠️ |

Hatchet is the only option combining first-class DAGs, per-step durability,
Postgres backing (no new infra), free self-hosting, and an observability UI.
Temporal is more powerful but heavier than this scale needs; Celery's Canvas is
weaker and adds a Redis/RabbitMQ broker.

**Tradeoff accepted.** One extra container and SDK; worker hosting costs on
platforms without free background workers (Render +$7/mo each — which is why
Render Phase A defers it).

**Upgrade path.** >100k runs/hour → Hatchet's RabbitMQ-backed deploy, *same
workflow code*. Cross-service sagas → Temporal. See [jobs.md](jobs.md) for the
canonical DAG example.

---

## Frontend routing — TanStack Router

**Decision.** TanStack Router with the file-based plugin. Routes live under
`frontend/src/routes/`; codegen produces a checked-in `routeTree.gen.ts`.

**Why, not the alternatives.** The frontend already uses TanStack Query, Form,
and Table. TanStack Router completes that ecosystem with genuinely better
type-safety: rename a route and `tsc` flags every `<Link>` that pointed there —
React Router's hand-written types drift. (Next.js App Router would force a
different framework entirely.) We also get a per-route `head` API for titles,
Zod-validated typed search params, loaders that integrate with Query for
hover-prefetch, and strong devtools.

**Tradeoff accepted.** Smaller community than React Router; a few third-party
libs assume React Router (rare, usually trivial to adapt); a `tsr generate`
build step and a lockfile-style generated file in source control. See
[frontend.md](frontend.md).

---

## Deploy — Render first, GCP when it's justified

**Decision.** A phased path that keeps the first deploy free and portable:

- **Phase A.** Render — Static Site (frontend) + Web Service (backend, free tier
  with sleep) + managed Postgres (free 90d). Defer Hatchet. Render's Static Site
  rewrites do the same-origin routing nginx does locally.
- **Phase B.** Add Hatchet engine + worker (+$14/mo), upgrade Postgres ($7/mo),
  custom domain, restore the two-role Postgres via migration.
- **Phase C / next project.** Port to GCP Cloud Run + Cloud SQL when scale
  justifies the cost. Container, env vars, health endpoint, and
  migrations-on-boot transfer unchanged; only orchestration YAML is rewritten.

**Why, not the alternatives.** Free rules out GCP/AWS for a hobby-scale start
(Postgres alone is $7–10/mo). Render has the simplest UX of the free
container-native options (vs Fly.io, Railway). The meta-goal is skills that
transfer, so we design for portability and treat Render as the proving ground.

**Tradeoff accepted.** Backend cold starts (~30s after 15 min idle on free
tier); no backups on free Postgres; Hatchet not exercised in Phase A;
Render-specific `render.yaml`.

**Portability invariants** (keep these clean and the GCP port is ~1–2 days):
no `RENDER_*` vars in code, generic env-var names, one `Dockerfile` everywhere,
a `/health/` endpoint any platform consumes, migrations on boot via
`docker-entrypoint.sh`. Walkthrough: [ops/deploy-render.md](ops/deploy-render.md).

---

## Workflow — trunk-based, `main` only

**Decision.** GitHub Flow: `main` is the single long-lived branch and the
source of truth. Feature branches cut from `main`, PR back to `main` (CI gates:
Backend, Frontend, Security), squash-merge. Merging to `main` deploys to prod
via Render. Hotfixes are ordinary feature branches. Only `main` is protected
(ruleset #16860368, `ref_name.include = ["~DEFAULT_BRANCH"]`).

**Why — including what we tried first.** The template briefly ran a long-lived
`dev` integration branch between features and `main`, for a staging buffer. It
backfired: the squash-only ruleset rewrites dev's commits into a fresh hash on
`main` at each release, leaving the two branches with identical *content* under
different *hashes* — so the next feature branch and the next `dev → main` PR
showed `CONFLICTING` with nothing to resolve. We hit this on consecutive
releases, each needing a manual rebase/cherry-pick dance. And the buffer never
earned its keep: Render only ever deploys `main`, so `dev` was never a real
pre-prod environment — just a second protected branch to sync. One trunk = no
hash divergence, no ghost conflicts, one PR per change, an unambiguous "what's
in prod."

**Tradeoff accepted.** No staging buffer — anything merged to `main` ships. The
mitigation is what GitHub Flow already assumes: small PRs, green CI, and — for
genuinely risky changes — a feature flag or a **Render preview environment**
(per-PR ephemeral deploy), *not* a shared long-lived branch. That's the path to
real pre-prod validation if we ever need it. See the branching section of
[ops.md](ops.md).

---

## Platform versions — track latest stable, pin Django to its LTS

**Decision.** Dependencies float to the latest stable release. **Django is the
one exception**: pin to the current **LTS** line (today `>=5.2,<6.0`), not the
newest feature release.

**Why, not the alternatives.** A template's defining trait is that it gets
cloned and then *left alone* — downstream projects rarely track the framework's
8-month feature cadence. Django LTS releases get security + data-loss fixes for
~3 years (5.2 → April 2028); a non-LTS feature release (6.0) drops out of
support in ~1 year. Pinning to the LTS maximizes the patch window for everything
built on this template. Everything *else* (DRF, allauth, axes, the Postgres
stack, etc.) we keep current — those track Django and ship fixes continuously,
so floating to latest stable is the lower-risk choice there.

**Tradeoff accepted.** We forgo new Django feature-release goodies until the
next LTS — including Django 6.0's *built-in* CSP support, which is why we use
the `django-csp` package instead (see below). When 6.2 LTS lands, bump the pin,
re-lock, run the suite, and at that point migrate CSP to the built-in
`SECURE_CSP` setting.

---

## Security headers — CSP + Permissions-Policy (enforced, both layers)

**Decision.** Emit a strict Content-Security-Policy and a Permissions-Policy
header on **both** layers in production:

- **Django layer** (`prod.py`): `django-csp` 4.0 + `django-permissions-policy`
  middleware, slotted right after `SecurityMiddleware`. Covers admin, Swagger,
  the browsable API, and any other HTML Django serves.
- **Frontend layer** (`nginx/nginx.prod.conf` + `render.yaml` static-site
  headers): the same baseline policy on the SPA shell + `/assets/`. nginx adds
  nothing on backend-proxied paths so Django's headers come through clean.

Same policy on both sides:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
base-uri 'self'; frame-ancestors 'none'; form-action 'self'`. Plus
`Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, and
`X-Frame-Options: DENY`.

**Why this shape.**
- **Enforced, because we made every surface compatible first** — not the usual
  "ship report-only and tune for weeks" pattern. Real audits done under the
  exact policy:
  - **Django admin** (5.2) and the **DRF browsable API** load all assets from
    same-origin `/static/` with no inline scripts — clean as-is.
  - **Swagger UI** (`/api/docs/`) was the only Django offender: it loaded JS/CSS
    from `cdn.jsdelivr.net` and bootstrapped via an inline `<script>`. Fixed by
    self-hosting assets (`drf-spectacular-sidecar`) and serving the bootstrap as
    an external same-origin file (`SpectacularSwaggerSplitView`).
  - **The Vite SPA build** emits a single external module script with no inline
    `<script>` — clean. As belt-and-suspenders against future code-splitting
    silently reintroducing Vite's inline modulepreload polyfill, `vite.config.ts`
    sets `build.modulePreload.resolveDependencies = () => []` (the working
    workaround from [vitejs/vite#11889](https://github.com/vitejs/vite/issues/11889);
    `polyfill: false` is documented but broken).
- **Swagger UI + the OpenAPI schema are staff-only in prod.** A public Swagger
  page hands attackers a complete map of the API. We gate both `/api/docs/`
  and `/api/schema/` with `staff_member_required` whenever `DEBUG=False`. Dev
  stays open so codegen (`make gen-api`) and iteration don't need a session.
- **Prod only on the Django side.** Vite's dev server uses inline scripts,
  `eval`, and `ws:` HMR — a strict policy floods with noise that doesn't reflect
  prod. So, like `SECURE_SSL_REDIRECT` and HSTS, the Django CSP lives in
  `prod.py`, not `base.py`. (The nginx and Render headers are inherently prod-
  only — dev uses `nginx.dev.conf` / Vite directly.)
- **`style-src` keeps `'unsafe-inline'`.** Admin, Swagger, and component
  libraries (sonner toasts, Radix primitives, etc.) set inline `style=`
  attributes at runtime. Styles can't execute code, so this is the low-risk
  concession; scripts stay locked to `'self'`.
- **Passkeys stay working.** Permissions-Policy deliberately omits the
  `publickey-credentials-get` / `-create` features. Listing them with `[]`
  would *disable* WebAuthn; omitting them keeps the browser default (allow
  `self`), so passkey enrollment is unaffected. This is the one easy-to-get-
  wrong footgun.

**Tradeoff accepted.** The policy is deliberately tight. The day you add a
feature that loads an external script, embeds a third-party iframe, calls
another origin's API, or needs the camera/microphone, the browser *will* block
it until you widen the matching directive — prefer **scoping the loosening to
the one view that needs it** (`csp.decorators.csp_update` on the Django side; a
narrower `path` on Render headers; a `location` block in nginx) over weakening
the global. Two enforcement layers can drift; if the SPA needs to talk to a new
origin, remember to widen `connect-src` on the *frontend* host config, not
just Django. No violation collector is wired by default; there's a commented
`report-uri` slot in the Django config to point at Sentry or similar.

**Where the wiring lives:**
- Django: [`backend/config/settings/prod.py`](../backend/config/settings/prod.py)
- Local prod nginx: [`nginx/nginx.prod.conf`](../nginx/nginx.prod.conf)
- Render: [`render.yaml`](../render.yaml) (frontend static-site `headers`)
- Vite polyfill guard: [`frontend/vite.config.ts`](../frontend/vite.config.ts)
- Swagger/schema gate: [`backend/config/urls.py`](../backend/config/urls.py) (`_docs_gate`)
