# Deploy to Render (Phase A)

First production deployment of this template. Free for 90 days. Designed so
the work transfers cleanly to GCP / k8s later — see "Migration notes" at the
bottom.

## What you get

| URL | Service | Plan |
|---|---|---|
| `https://music-frontend.onrender.com` | React app, public | Static Site (free forever) |
| `https://music-backend.onrender.com` | Django + DRF, public but only accessed via frontend rewrites | Web Service (free, sleeps 15 min) |
| (managed) | Postgres 18 | Database (free, then $7/mo — see expiry note below) |

> **Free-database expiry:** Render deletes free Postgres after a fixed window
> and **only allows one free database per workspace**. That window has been as
> short as 30 days (it was 90 historically) — check Render's current pricing
> before relying on a number. Upgrade to Starter ($7/mo) to keep the data +
> get backups, or delete-and-recreate to reset the clock (wipes all data).

The frontend's `render.yaml` rewrites `/api/*`, `/_allauth/*`, `/admin/*`,
`/static/*`, and `/health` to the backend, so from the browser's perspective
the entire app is same-origin.

## What's deferred to Phase B

- **Hatchet engine + worker** — would require two background-worker services
  at $7/mo each. No user-visible workflows exist yet; add when needed.
- **Custom domain + SSL** — use the auto-generated `.onrender.com` URLs first.
- **Two-role Postgres split** — Render's managed Postgres gives one
  privileged role; Phase A collapses `DATABASE_URL` and `DATABASE_URL_ADMIN`
  to the same connection string. Phase B can restore the split via a
  migration that `CREATE ROLE app_user` and a Render-secret password.

## First-time deploy

### 1. Push the repo to GitHub

```sh
git push origin main
```

The `render.yaml` at the repo root drives the deploy spec.

### 2. Connect the repo to Render

- Sign in at [render.com](https://render.com)
- New → Blueprint → connect your GitHub account → pick the repo
- Render parses `render.yaml` and shows a preview of what it will create:
  one Static Site, one Web Service, one Postgres database
- Click "Apply" — Render provisions everything in parallel (3-5 min)

### 3. Set secrets that aren't in the blueprint

Several env vars in `render.yaml` are marked to skip auto-sync (`sync: false`)
because they're sensitive or environment-specific. Set them in the **backend
service → Environment**:

| Variable | Required? | Why / where to get it |
|---|---|---|
| `MFA_FIELD_ENCRYPTION_KEY` | **Yes** | Fernet key encrypting TOTP secrets at rest. Generate: `python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`. **Store it** — if lost, enrolled MFA can't be decrypted and users must re-enroll. |
| `RESEND_API_KEY` | **Yes for email** | Signup-verification + invite emails. Free key from [resend.com](https://resend.com). Without it those flows silently fail — and signup is invite-only by default (see below). |
| `DEFAULT_FROM_EMAIL` | with Resend | A verified sender; unset falls back to `onboarding@resend.dev` (fine for testing). |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Enables Spotify import. Apple Music + YouTube need nothing. |
| `SENTRY_DSN` | Optional | Error tracking. Free DSN from [sentry.io](https://sentry.io). |

The blueprint generates `DJANGO_SECRET_KEY` automatically via
`generateValue: true`, and wires `DATABASE_URL` from the linked database.

> **Invite-only gate:** the `invite_only` waffle switch is ON by default (data
> migration). On a fresh prod DB with no members, nobody can self-sign-up —
> create the superuser first (step 5) and invite from the app, or flip the
> switch off in `/admin/` → Waffle → Switches to allow open signup.

### 4. First deploy completes

Watch the logs:

```
Backend → "Migrations applied"      ← docker-entrypoint.sh runs migrate
Backend → "Listening at: http://0.0.0.0:8000"  ← gunicorn up
Frontend → "Build successful, deploy live"
```

Visit `https://music-frontend.onrender.com`.

### 5. Create a real admin user

`make seed` won't run in prod (the command refuses unless DEBUG=True). Create
a superuser manually via the Render dashboard → Backend service → Shell:

```sh
python manage.py createsuperuser
```

Then log in at `/login`, click avatar → Settings → Multi-factor
authentication → Enroll, and enroll TOTP via your authenticator app.

## What to validate after first deploy

A short manual smoke-test list — these exercise the load-bearing pieces of
the stack:

- [ ] Frontend loads at the static URL
- [ ] `/login` reaches the backend through the rewrite (network tab shows
  `200 /api/...` from the static origin)
- [ ] Sign up a new user → log out → log in
- [ ] Import a playlist → save it → refresh, it persists under "My playlists"
- [ ] Open `/admin/` → redirects to MFA enrollment for the staff user
- [ ] Enroll TOTP → can now reach `/admin/`
- [ ] Sentry receives a test exception (if `SENTRY_DSN` is set):
  `python manage.py shell -c "1/0"` via the Render shell
- [ ] `/health/` returns 200 (Render's health check should already be green)

## Custom domain (music.whirlyfan.com)

The domain attaches to the **frontend** static site only — the backend stays on
its `.onrender.com` URL and is reached through the frontend rewrites, so the
whole app is same-origin under the custom domain.

1. **Render:** `music-frontend` → Settings → Custom Domains → add
   `music.whirlyfan.com`. Render shows a DNS target (a CNAME value).
2. **DNS** (wherever `whirlyfan.com` is hosted): add a `CNAME` record —
   name `music`, value = the target Render showed. On Cloudflare, set it
   **DNS-only (grey cloud)** until Render issues the cert, then you may proxy.
   Free SSL provisions automatically once Render sees the record.
3. **Backend origins** (already set in `render.yaml`): `DJANGO_CSRF_TRUSTED_ORIGINS`
   and `DJANGO_CORS_ALLOWED_ORIGINS` list both `https://music.whirlyfan.com` and
   the `.onrender.com` origin; `FRONTEND_ORIGIN` points at the custom domain so
   emailed links use it. `DJANGO_ALLOWED_HOSTS` stays the backend host — the
   rewrites preserve it, so the custom domain does **not** go there.

## Common gotchas

### Cold start on the free tier
The backend sleeps after 15 minutes of no traffic. The first request after
sleep takes 20-40 seconds. Pages don't load instantly during cold start —
that's not a bug. Upgrade backend to Starter ($7/mo) to disable sleep.

### "DisallowedHost" errors
If you change the service name, regenerate `DJANGO_ALLOWED_HOSTS` to match
the new `<service>.onrender.com` URL. The blueprint hard-codes the current
name; update it together.

### Free database expires
See the expiry note up top — Render deletes free Postgres after a fixed window
(verify the current length on their pricing page) and emails warnings first. Either:
- Upgrade to Starter ($7/mo) — keeps all data + adds backups
- Delete + recreate the database — resets the clock but **loses all data**
  (acceptable for a learning deployment)

### CSRF 403 on POST
If you see "Origin checking failed" or "Forbidden (CSRF token missing or
incorrect)", verify `DJANGO_CSRF_TRUSTED_ORIGINS` includes the frontend's
exact URL (including `https://`).

### Static admin assets 404
WhiteNoise serves these from `/static/` on the backend. The blueprint
rewrites `/static/*` from the frontend to the backend. If admin CSS doesn't
load: confirm the rewrite is active in Render dashboard → Frontend → Routes.

### "Database is unreachable" on first deploy
Backend starts before the database is fully provisioned the very first time.
Render auto-restarts; usually heals within 30 seconds. If not:
manual restart of the backend service in the dashboard.

## Phase B promotions

In rough order of value-for-effort:

| Add | Cost | Effort | Value |
|---|---|---|---|
| Upgrade Postgres to Starter | +$7/mo | 1 click | Backups, no 90-day expiry |
| Upgrade backend off free tier | +$7/mo | 1 click | No cold starts |
| Custom domain | $0 | DNS + TXT verification | Real URL, free SSL |
| Hatchet engine + worker | +$14/mo | New service entries in `render.yaml` | Enables workflows |
| Restore two-role Postgres | $0 | One migration | RLS defense-in-depth |
| Sentry alerts + Slack | $0 | Sentry dashboard | Notifications on production errors |

## Migration notes — when this becomes GCP / k8s

| Asset in this template | Transfers as-is? | What changes |
|---|---|---|
| `backend/Dockerfile` | ✅ | Tag + push to Artifact Registry instead of building on Render |
| `frontend/` build | ✅ | Upload `dist/` to a GCS bucket, front with Cloud CDN + URL Map |
| `docker-entrypoint.sh` | ✅ | Same script |
| `config/settings/prod.py` | ✅ | Same |
| Env var contract (DJANGO_*, DATABASE_URL, etc.) | ✅ | Move to Secret Manager + Cloud Run env refs (or k8s ConfigMap + Secret) |
| `/health/` endpoint | ✅ | Same — k8s readiness probe uses it |
| **`render.yaml`** | ❌ Rewrite | Becomes Cloud Run service YAML, or a Helm chart |
| **Render rewrites** | ❌ Rewrite | URL Maps in Cloud Load Balancer, or nginx ingress in k8s |
| **Postgres connection** | ✅ shape | New host (Cloud SQL or AlloyDB); `DATABASE_URL` env var works unchanged |

Estimate: 1-2 days of work to port to GCP + Cloud Run once you've done the
Render deploy once, because the *contract* (env vars, container, health
endpoint, migrations-on-boot) is platform-agnostic. Only the orchestration
glue is rewritten.
