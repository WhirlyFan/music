"""Development settings."""

from .base import *  # noqa: F401,F403
from .base import INSTALLED_APPS, MIDDLEWARE

DEBUG = True

INSTALLED_APPS = INSTALLED_APPS + ["debug_toolbar"]
MIDDLEWARE = MIDDLEWARE + ["debug_toolbar.middleware.DebugToolbarMiddleware"]

INTERNAL_IPS = ["127.0.0.1"]

# Mailpit catches outgoing email locally and renders it at http://localhost:8025.
# Set EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend in your local
# .env if you'd rather see emails printed to docker compose logs (no UI, but
# zero containers).
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "mailpit"  # docker-compose service name
EMAIL_PORT = 1025
EMAIL_USE_TLS = False  # Mailpit has no TLS in default config
EMAIL_HOST_USER = ""  # No auth by default
EMAIL_HOST_PASSWORD = ""

# Looser CSRF in dev so the Vite dev server works through nginx
CSRF_TRUSTED_ORIGINS = ["http://localhost", "http://localhost:80"]
