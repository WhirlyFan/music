"""Production settings."""
from .base import *  # noqa: F401,F403

DEBUG = False

# Security headers
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Email: configure via django-anymail provider env vars in real deploys.
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
