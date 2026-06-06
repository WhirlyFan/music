"""Production settings."""

from urllib.parse import urlsplit

from csp.constants import NONE, SELF

from .base import *  # noqa: F401,F403
from .base import ALLOWED_HOSTS, FRONTEND_ORIGIN, INSTALLED_APPS, MIDDLEWARE, env

# anymail must be in INSTALLED_APPS for the backend to load.
# Append in prod only — dev uses Mailpit via plain SMTP backend.
INSTALLED_APPS = [*INSTALLED_APPS, "anymail"]

DEBUG = False

# --- Allowed hosts ---
# Render gives each service a (possibly suffixed) public hostname — e.g.
# `music-backend-ll7r.onrender.com` when the plain name is taken — and injects
# it as RENDER_EXTERNAL_HOSTNAME. Trust it automatically so the backend accepts
# its own host (and Render's health probe) regardless of any random suffix,
# without having to keep DJANGO_ALLOWED_HOSTS in sync with it by hand.
_render_host = env("RENDER_EXTERNAL_HOSTNAME", default="")
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS = [*ALLOWED_HOSTS, _render_host]

# --- Behind-a-proxy posture ---
# Cloudflare / nginx / load balancer terminates TLS; the origin sees HTTP.
# Trust the upstream `X-Forwarded-Proto` header so Django treats the request
# as HTTPS for redirect + cookie + CSRF purposes.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True

# Prefer the forwarded host for absolute-URL building where the proxy provides
# it. Render's rewrite doesn't reliably forward the public host, so this alone
# isn't enough for the OAuth redirect_uri — CanonicalAuthHostMiddleware pins the
# auth-path host explicitly (see OAUTH_CALLBACK_HOST below). get_host() still
# validates against ALLOWED_HOSTS and falls back to the Host header (the onrender
# host) for Render's direct health probe.
USE_X_FORWARDED_HOST = True

# Host CanonicalAuthHostMiddleware pins onto /accounts/* and /_allauth/* requests
# so allauth's OAuth redirect_uri (and the session cookie that callback sets) use
# the public domain rather than the internal *.onrender.com service host. Derived
# from the public frontend origin, under which those paths are served via the
# rewrite. Must be present in ALLOWED_HOSTS.
OAUTH_CALLBACK_HOST = urlsplit(FRONTEND_ORIGIN).netloc

# --- HSTS ---
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Misc browser-side hardening ---
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"  # Referrer-Policy header (Django built-in)
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = "Lax"
X_FRAME_OPTIONS = "DENY"

# --- Cross-subdomain cookie scope (WebSocket backend) ---
# Render static sites don't proxy WebSocket upgrades, so the SPA
# (music.whirlyfan.com) connects its jam socket directly to the backend on its
# own custom domain (api.whirlyfan.com). For the session cookie to ride along on
# that upgrade, it must be scoped to the shared parent domain rather than being
# host-only. music. ↔ api. is same-site (registrable domain whirlyfan.com), so
# SameSite=Lax still sends it — no SameSite=None needed.
#
# Set DJANGO_SESSION_COOKIE_DOMAIN=.whirlyfan.com ONLY once both custom domains
# are live. Leave it unset on *.onrender.com hosts (a parent-domain cookie won't
# be sent there, which would break auth). Unset → host-only cookie = today's
# same-origin-rewrite behavior, unchanged.
_cookie_domain = env("DJANGO_SESSION_COOKIE_DOMAIN", default="")
if _cookie_domain:
    SESSION_COOKIE_DOMAIN = _cookie_domain
    CSRF_COOKIE_DOMAIN = _cookie_domain

# --- Response security headers (prod only) ---
# CSP + Permissions-Policy aren't wired in dev: Vite's HMR uses inline scripts,
# eval, and ws: connections that a strict policy would flag as noise that
# doesn't reflect prod. Both middlewares only emit a response header, so we
# slot them right after SecurityMiddleware.
_security_idx = MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
MIDDLEWARE = [
    *MIDDLEWARE[: _security_idx + 1],
    "csp.middleware.CSPMiddleware",
    "django_permissions_policy.PermissionsPolicyMiddleware",
    *MIDDLEWARE[_security_idx + 1 :],
]

# --- Content Security Policy (django-csp 4.0) ---
# ENFORCED. We audited every HTML surface Django serves under this exact policy:
#   - /admin/             — all assets same-origin /static/, no inline scripts ✓
#   - DRF browsable API   — same-origin /static/, no inline scripts ✓
# (No Swagger UI is served — only the raw /api/schema/ JSON, used for codegen.)
# `style-src` keeps 'unsafe-inline' because admin widgets use inline style
# attributes (styles can't run code, so this is low-risk). Everything
# else is locked to 'self'. If you add a surface that needs an external script
# or connects to another origin, widen the specific directive — or scope it to
# that view with csp.decorators.csp_update rather than loosening the global.
CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": [SELF],
        "script-src": [SELF],
        "style-src": [SELF, "'unsafe-inline'"],  # admin inline styles
        "img-src": [SELF, "data:", "https://api.dicebear.com"],  # user avatars
        "font-src": [SELF],
        "connect-src": [SELF, "wss://api.whirlyfan.com"],  # jam WebSocket (cross-origin)
        "object-src": [NONE],
        "base-uri": [SELF],
        "frame-ancestors": [NONE],  # defense-in-depth alongside X-Frame-Options
        "form-action": [SELF, "https://accounts.google.com"],
        # "report-uri": "https://<your-collector>",  # wire a Sentry/report endpoint
    },
}

# --- Permissions-Policy (django-permissions-policy) ---
# Disable powerful browser features the app doesn't use. An empty list means
# "deny for all origins, including self." We deliberately omit the
# publickey-credentials-* features so WebAuthn / passkey enrollment keeps
# working (they default to allowing `self`).
PERMISSIONS_POLICY = {
    "accelerometer": [],
    "autoplay": [],
    "camera": [],
    "display-capture": [],
    "encrypted-media": [],
    "fullscreen": [],
    "geolocation": [],
    "gyroscope": [],
    "magnetometer": [],
    "microphone": [],
    "midi": [],
    "payment": [],
    "usb": [],
}

# --- CSRF trusted origins ---
# When Django sits behind a reverse proxy (nginx, Cloudflare, etc.), CSRF
# verification rejects unfamiliar Origin/Referer values unless we list the
# real public origins here. Comma-separated list, e.g.
#   DJANGO_CSRF_TRUSTED_ORIGINS=https://app.example.com,https://www.example.com
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# --- Email (Resend via django-anymail) ---
#
# Why Resend specifically: free tier (3K/mo, 100/day, no card) covers
# template/hobby traffic forever; clean Django integration via Anymail
# (already a dep). Swapping providers later is a 1-line backend change
# plus matching ANYMAIL key — see docs/ops/email.md.
#
# DEFAULT_FROM_EMAIL must either match a verified sender on Resend OR be
# a domain you've verified DKIM+SPF for. Defaults to Resend's shared
# `onboarding@resend.dev` so this template works out-of-box for testing
# — point your real domain at it once you verify one via the Resend
# dashboard, then update DEFAULT_FROM_EMAIL via env (no code change).
EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"
ANYMAIL = {
    "RESEND_API_KEY": env("RESEND_API_KEY", default=""),
}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="onboarding@resend.dev")
SERVER_EMAIL = DEFAULT_FROM_EMAIL  # for Django's error emails to admins
