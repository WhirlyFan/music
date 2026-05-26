"""Production settings."""

from .base import *  # noqa: F401,F403
from .base import env

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

# Email: configure via django-anymail provider env vars in real deploys.
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
