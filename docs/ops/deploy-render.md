# Deploy to Render (Phase A)

First production deployment of this template. Free for 90 days. Designed so
the work transfers cleanly to GCP / k8s later — see "Migration notes" at the
bottom.

## What you get

| URL | Service | Plan |
|---|---|---|
| `https://react-django-template-frontend.onrender.com` | React app, public | Static Site (free forever) |
| `https://react-django-template-backend.onrender.com` | Django + DRF, public but only accessed via frontend rewrites | Web Service (free, sleeps 15 min) |
| (managed) | Postgres 16 | Database (free for 90 days, then $7/mo) |

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

Two env vars in `render.yaml` are marked to skip auto-sync (`sync: false`)
because they're sensitive or environment-specific:

| Variable | Where to set | Why |
|---|---|---|
| `SENTRY_DSN` | Backend service → Environment → Add Secret File or env var | Optional; enables error tracking. Get a free DSN from [sentry.io](https://sentry.io). |

The blueprint generates `DJANGO_SECRET_KEY` automatically via
`generateValue: true`.

### 4. First deploy completes

Watch the logs:

```
Backend → "Migrations applied"      ← docker-entrypoint.sh runs migrate
Backend → "Listening at: http://0.0.0.0:8000"  ← gunicorn up
Frontend → "Build successful, deploy live"
```

Visit `https://react-django-template-frontend.onrender.com`.

### 5. Create a real admin user

`make seed` won't run in prod (the command refuses unless DEBUG=True). Create
a superuser manually via the Render dashboard → Backend service → Shell:

```sh
python manage.py createsuperuser
```

Then log in at `/login`, click avatar → Settings → Two-factor auth →
Set up, and enroll TOTP via your authenticator app.

## What to validate after first deploy

A short manual smoke-test list — these exercise the load-bearing pieces of
the stack:

- [ ] Frontend loads at the static URL
- [ ] `/login` reaches the backend through the rewrite (network tab shows
  `200 /api/...` from the static origin)
- [ ] Sign up a new user → log out → log in
- [ ] Create a note, refresh, the note persists
- [ ] Open `/admin/` → redirects to MFA enrollment for the staff user
- [ ] Enroll TOTP → can now reach `/admin/`
- [ ] Sentry receives a test exception (if `SENTRY_DSN` is set):
  `python manage.py shell -c "1/0"` via the Render shell
- [ ] `/health/` returns 200 (Render's health check should already be green)

## Common gotchas

### Cold start on the free tier
The backend sleeps after 15 minutes of no traffic. The first request after
sleep takes 20-40 seconds. Pages don't load instantly during cold start —
that's not a bug. Upgrade backend to Starter ($7/mo) to disable sleep.

### "DisallowedHost" errors
If you change the service name, regenerate `DJANGO_ALLOWED_HOSTS` to match
the new `<service>.onrender.com` URL. The blueprint hard-codes the current
name; update it together.

### Database expires at 90 days
Render emails warnings starting around day 75. Either:
- Upgrade to Starter ($7/mo) — keeps all data
- Delete + recreate the database — starts a fresh 90-day clock but **loses
  all data** (acceptable for a learning deployment)

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
