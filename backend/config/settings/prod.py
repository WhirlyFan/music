"""Production settings."""

from .base import *  # noqa: F401,F403
from .base import INSTALLED_APPS, env

# anymail must be in INSTALLED_APPS for the backend to load.
# Append in prod only — dev uses Mailpit via plain SMTP backend.
INSTALLED_APPS = [*INSTALLED_APPS, "anymail"]

DEBUG = False

# --- Behind-a-proxy posture ---
# Cloudflare / nginx / load balancer terminates TLS; the origin sees HTTP.
# Trust the upstream `X-Forwarded-Proto` header so Django treats the request
# as HTTPS for redirect + cookie + CSRF purposes.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True

# --- HSTS ---
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Misc browser-side hardening ---
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = "Lax"
X_FRAME_OPTIONS = "DENY"

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
