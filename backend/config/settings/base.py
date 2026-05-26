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
    "allauth.mfa",
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
    # Staff users must enroll MFA before reaching /admin/. Lives after
    # AuthenticationMiddleware (needs request.user) and before RLSContextMiddleware
    # so a redirect short-circuits RLS session-var setup we don't need.
    "apps.core.middleware.RequireMfaForStaffMiddleware",
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

# Extra session vars set per request, on top of django-rls's defaults
# (rls.user_id, rls.tenant_id). `set_admin_bypass` flips rls.bypass = 'true'
# for is_staff users on /admin/ so the Django admin can see every row.
# API endpoints stay RLS-scoped because the processor only fires on /admin/.
RLS_CONTEXT_PROCESSORS = [
    "apps.core.rls_context.set_admin_bypass",
]

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

# The user-facing frontend origin. allauth uses this to construct URLs in
# transactional emails (password reset link, signup confirmation). MUST be
# overridden in any non-localhost deploy — otherwise reset emails contain
# `http://localhost/...` links that go nowhere when clicked.
#
# Set FRONTEND_ORIGIN in Render / k8s / GCP env to your real domain, e.g.
#     FRONTEND_ORIGIN=https://app.yourdomain.com
FRONTEND_ORIGIN = env("FRONTEND_ORIGIN", default="http://localhost")
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": f"{FRONTEND_ORIGIN}/account/verify-email/{{key}}",
    "account_reset_password_from_key": (f"{FRONTEND_ORIGIN}/account/password/reset/key/{{key}}"),
    "account_signup": f"{FRONTEND_ORIGIN}/signup",
}

# --- allauth MFA ---
# 2FA is opt-in for all users (MFA_REQUIRED = False). A separate policy
# in apps.core.middleware.RequireMfaForStaffMiddleware makes it mandatory
# specifically for is_staff users hitting /admin/, regardless of how they
# authenticated. The reason MFA stays opt-in globally: when SAML/SSO lands
# later, the customer's IdP enforces their org's MFA policy and your app
# trusts the assertion — re-prompting in-app is the textbook SSO anti-pattern.
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes", "webauthn"]
MFA_REQUIRED = False
MFA_TOTP_ISSUER = "react-django-template"
# Allow signing in with a passkey only (no password roundtrip). Modern UX win;
# safe to enable because allauth still requires a password at signup unless
# explicitly configured otherwise.
MFA_PASSKEY_LOGIN_ENABLED = True
MFA_PASSKEY_SIGNUP_ENABLED = False

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
