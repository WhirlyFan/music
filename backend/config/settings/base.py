"""Shared Django settings. Read from env via django-environ."""
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)
# Load .env from the repo root if present
environ.Env.read_env(BASE_DIR.parent / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# --- Apps ---
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
    "django_extensions",
    "django_filters",
    "django_guid",
    "drf_spectacular",
    "axes",
    "pghistory",
    "pgtrigger",
    "health_check",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.headless",
    # "allauth.mfa",  # add `django-allauth[mfa]` extra + fido2 to enable
    "django_rls",
]

LOCAL_APPS = [
    "apps.users",
    "apps.core",
    "apps.notes",
    "apps.jobs",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# --- Middleware (order matters — see plan) ---
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django_guid.middleware.guid_middleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django_rls.middleware.RLSContextMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Database ---
# We connect to Postgres using one of two roles, controlled by which env var
# the running process loads. The DB itself is the same (appdb) — only the role
# differs, which is the whole point of RLS:
#
#   DATABASE_URL          → app_user  (no BYPASSRLS — RLS policies enforced)
#   DATABASE_URL_ADMIN    → app_admin (BYPASSRLS  — for migrations + seed)
#
# Web/worker containers set DATABASE_URL.
# `make migrate`, `make seed`, and other admin commands inject DATABASE_URL_ADMIN.
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://app_user:app_user@localhost:5432/appdb",
    ),
}
# Use django-rls's custom Postgres backend so the schema editor knows how to
# emit ENABLE ROW LEVEL SECURITY / CREATE POLICY / etc. for RLSModel subclasses.
DATABASES["default"]["ENGINE"] = "django_rls.backends.postgresql"

# --- Auth ---
AUTH_USER_MODEL = "users.User"

AUTHENTICATION_BACKENDS = [
    # AxesBackend must be first so lockouts are checked before any other backend.
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

SITE_ID = 1

# Password policy follows NIST SP 800-63B Rev. 4 (2025):
#   - Length over complexity (min 12 chars — no special-char / mixed-case rules)
#   - Screen against known-breached passwords via haveibeenpwned
#   - No forced rotation
#
# `pwned-passwords-django` uses k-anonymity: only the first 5 chars of the
# password's SHA-1 hash leave the server. Network call adds ~50-200ms to
# signup/password-change — acceptable for those flows. Falls open on
# network failure (don't lock users out if HIBP is down).
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "pwned_passwords_django.validators.PwnedPasswordsValidator"},
]

# --- allauth (headless mode) ---
# Sign in with either email or username. allauth detects which one based on
# whether the input looks like an email; both flows hit the same endpoint.
# REQUIRES django-allauth >= 65.16 (April 2026) — earlier versions had a
# 400 invalid_login bug when both methods were enabled in headless mode.
ACCOUNT_EMAIL_VERIFICATION = "optional"
ACCOUNT_LOGIN_METHODS = {"email", "username"}
# Signup collects username + email + password (+ confirm). The `*` suffix
# marks required fields.
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_UNIQUE_EMAIL = True
# Case-insensitive uniqueness for usernames: 'Foo' collides with 'foo'.
ACCOUNT_PRESERVE_USERNAME_CASING = False

HEADLESS_ONLY = True
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": "http://localhost/account/verify-email/{key}",
    "account_reset_password_from_key": "http://localhost/account/password/reset/key/{key}",
    "account_signup": "http://localhost/signup",
}

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    # Rate limiting. AnonRateThrottle keys on IP; UserRateThrottle keys on user ID.
    # Override per-view with `throttle_classes = [...]` when an endpoint is more
    # sensitive (login, signup, password reset → tighter; bulk read → looser).
    # Backed by Django's default cache (LocMem in dev; Redis once we add it).
    # NOTE per docs: misspelling these keys silently disables throttling.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/hour",
        "user": "1000/hour",
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "react-django-template API",
    "DESCRIPTION": "Backend API for the react-django-template project.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- django-axes ---
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1  # hours
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]

# --- django-guid ---
DJANGO_GUID = {
    "GUID_HEADER_NAME": "X-Request-ID",
    "VALIDATE_GUID": False,
    "RETURN_HEADER": True,
    "INTEGRATIONS": [],
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=["http://localhost"])
CORS_ALLOW_CREDENTIALS = True

# --- Internationalization ---
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static files ---
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# --- Logging ---
# Single stdout sink with a CorrelationId filter from django-guid. Every log
# line carries the request id so a single user request can be traced across
# Django, gunicorn access logs, and the worker. In prod, container runtime
# (docker/k8s/Render/Fly) captures stdout — no file rotation in-process.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "correlation_id": {
            "()": "django_guid.log_filters.CorrelationId",
        },
    },
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)-5s [%(correlation_id)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["correlation_id"],
            "formatter": "standard",
        },
    },
    "loggers": {
        # Root — catch-all
        "": {
            "handlers": ["console"],
            "level": env("DJANGO_LOG_LEVEL", default="INFO"),
        },
        # Django itself is chatty at DEBUG; keep at INFO unless overridden
        "django": {
            "handlers": ["console"],
            "level": env("DJANGO_LOG_LEVEL", default="INFO"),
            "propagate": False,
        },
        # Quiet noisy 3rd parties unless explicitly turned up
        "django.utils.autoreload": {"level": "INFO"},
        "django_guid": {"level": "WARNING"},
    },
}

# --- Defaults ---
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
