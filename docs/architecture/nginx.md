# nginx

Why nginx is in this stack, what it actually does, and which deploy targets
make it irrelevant.

## TL;DR

nginx solves **same-origin** for our SPA + Django combo. Without it, the
React app on port 5173 would talk cross-origin to Django on port 8000,
breaking session cookies and CSRF in ways that *only show up in dev* — the
worst kind of bug.

In **cloud deploys** (Render, Cloud Run, k8s with ingress-nginx) the
platform's edge subsumes nginx's job. The `nginx/` config in this repo is
for local dev + self-hosted compose, not Render.

## The two roles

### Role 1: Dev-time reverse proxy (`docker-compose.yml`)

The `nginx` service binds to `localhost:80` and routes by URL prefix:

| Browser request | nginx forwards to |
|---|---|
| `/api/*`, `/admin/*`, `/_allauth/*`, `/health/`, `/static/*` | `backend:8000` (Django + DRF) |
| `/hatchet-ui/*` (optional) | `hatchet:8080` (Hatchet admin UI) |
| Everything else (`/`, `/playlists`, `/login`, bundles) | `frontend:5173` (Vite dev server) |
| WebSocket Upgrade headers | `frontend:5173` (Vite HMR) |

The *whole point* is **same-origin**: the browser only ever talks to
`localhost:80`. Session cookies, CSRF tokens, and SameSite=Lax behavior all
work identically to how they will in production. No CORS gymnastics.

Config: [`nginx/nginx.dev.conf`](../../nginx/nginx.dev.conf).

### Role 2: Self-hosted prod edge (`docker-compose.prod.yml`)

The dev `nginx` service goes away. Instead, the **frontend's** Dockerfile
has a `prod` target that bakes the Vite build into an nginx image:

```dockerfile
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
```

So in `docker compose -f docker-compose.prod.yml up`, the `frontend`
container *is* nginx — it serves the React `dist/` directly *and*
reverse-proxies `/api/*`, `/admin/*`, `/_allauth/*` to `backend:8000`.
Single edge container, two jobs.

Config: [`nginx/nginx.prod.conf`](../../nginx/nginx.prod.conf).

## Why same-origin matters for *this* stack

We use **session cookies** for auth (django-allauth + DRF
`SessionAuthentication`). Cookies + cross-origin = pain:

| Failure | Why |
|---|---|
| `SameSite=Lax` session cookie | Browsers won't send it on cross-origin fetch by default. You'd need `SameSite=None`, which requires `Secure`, which requires HTTPS — fragile on `http://localhost`. |
| CSRF Origin/Referer check | `CSRF_TRUSTED_ORIGINS` + `CORS_ALLOWED_ORIGINS` + `CORS_ALLOW_CREDENTIALS` + a pre-flight ensureCsrfCookie dance. Workable, but lots of moving parts. |
| Pre-flight OPTIONS on every state-changing request | Latency in dev; masks real-prod behavior. |
| **Dev/prod parity** | Prod IS same-origin. If dev is cross-origin, cookie/CSRF bugs only surface in prod. |

The cost of nginx (one tiny Alpine container, ~5 MB, ~10 ms startup) buys
us the highest-ROI engineering principle: dev/prod parity for the most
error-prone parts of the stack.

## Alternatives we ruled out

### Alternative 1: Cross-origin + CORS

Run Vite at `:5173` and Django at `:8000`, configure
`django-cors-headers` to allow cross-origin with credentials.

| When it's the right call | Why it isn't ours |
|---|---|
| Stateless JWT API (no cookies) | We use session cookies for allauth |
| FE and API intentionally on different domains in prod | Our prod is same-origin |
| Public API consumed by third parties | This is an internal SPA |

### Alternative 2: Vite's built-in proxy

Vite can proxy `/api/*` etc. to Django from its dev server, giving us
same-origin via Vite alone — no nginx container:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api':      'http://localhost:8000',
    '/admin':    'http://localhost:8000',
    '/_allauth': 'http://localhost:8000',
    '/static':   'http://localhost:8000',
    '/health':   'http://localhost:8000',
  },
}
```

Then browse `http://localhost:5173` and skip nginx.

**Why we didn't go with it:** the dev environment no longer mirrors prod
exactly — Vite's proxy is dev-only, so you can't `docker compose up` and
hit the *same* port the way prod will serve. The single-container
simplicity loses dev/prod parity. Not catastrophic; not our preference.

If you *want* leaner local at the cost of parity, this is the swap.

## Per-platform behavior

| Environment | nginx role | Why |
|---|---|---|
| Local dev | Reverse proxy at `:80` for same-origin | Cookies, CSRF, WebSocket HMR all behave like prod |
| Self-hosted prod (compose) | Static-file server + reverse proxy bundled into frontend image | Single edge container; what you'd run on a VPS |
| **Render** | **Not used** | Render's edge replaces both roles |
| Cloud Run / GCP | Optional — Cloud Load Balancer + URL Maps + GCS replace it | Platform edge subsumes nginx |
| Kubernetes | Returns as `nginx-ingress` (or Traefik) | k8s needs an ingress controller; nginx is the default |

### What Render does instead

| Job nginx did | Render equivalent |
|---|---|
| TLS termination | Render's edge (free auto-SSL) |
| Static file serving | Render Static Site (CDN-backed) |
| `/api/*` routing to backend | Render Static Site `rewrites:` in `render.yaml` |
| WebSocket upgrade | Render does this automatically |
| Gzip / compression | Render's edge does it |

That's why [`render.yaml`](../../render.yaml) has no `nginx` service — the
platform's edge subsumes everything our nginx does.

## Footguns

- **WebSocket upgrade for Vite HMR.** The dev nginx config must include
  `proxy_set_header Upgrade $http_upgrade;` + `Connection "upgrade"`
  for `:5173` — otherwise HMR silently fails and you see "Failed to
  connect to WebSocket" in the console.
- **`/static/` vs `/assets/`.** Django's `collectstatic` writes to
  `/static/` (served by WhiteNoise or nginx in prod). Vite's build emits
  `/assets/`. Don't mix them up in routing rules.
- **CSRF cookie path.** Django sets `csrftoken` at `/`. If nginx rewrites
  paths in a way that loses the cookie, login breaks. We don't rewrite —
  nginx is a transparent proxy.
- **Trailing slashes.** Django's `APPEND_SLASH=True` (default) will
  redirect `/api/notes` → `/api/notes/`. nginx passes the redirect
  through; the browser follows. No special config needed, but worth
  knowing if you debug a "double redirect" issue.

## See also

- [architecture.md](../architecture.md) — full topology
- [auth.md](../auth.md) — why session cookies (not JWT)
- [ops/deploy-render.md](../ops/deploy-render.md) — how Render's edge replaces nginx
