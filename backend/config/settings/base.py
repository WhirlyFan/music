"""Shared Django settings. Read from env via django-environ."""

from datetime import timedelta
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

# Spotify Web API (client-credentials) for ingesting public Spotify playlists/
# albums/tracks. Optional — empty means Spotify ingest returns a clear
# "not configured" message. Set both in Doppler.
SPOTIFY_CLIENT_ID = env("SPOTIFY_CLIENT_ID", default="")
SPOTIFY_CLIENT_SECRET = env("SPOTIFY_CLIENT_SECRET", default="")

# Base URL of the bgutil PO-token provider sidecar (bgutil-ytdlp-pot-provider).
# yt-dlp fetches YouTube proof-of-origin tokens from it to avoid throttling under
# load. In docker compose it's the service hostname; empty disables it (the plugin
# then falls back to its localhost default, which won't reach a separate container).
YOUTUBE_POT_BASE_URL = env("YOUTUBE_POT_BASE_URL", default="")

# A Netscape-format cookies.txt exported from a signed-in YouTube account. Lets
# yt-dlp make authenticated requests, which clear the "confirm you're not a bot"
# wall YouTube throws at datacenter IPs (the PO-token sidecar + ejs solver don't
# clear it from Render). Secret — sourced from Doppler in dev, the Render
# dashboard in prod (sync: false); empty in local non-Doppler runs. Rotate by
# updating the value and redeploying — cookies expire / get invalidated.
YOUTUBE_COOKIES = env("YOUTUBE_COOKIES", default="")

# Route yt-dlp extraction (search + playlist/video metadata ingest) through this
# proxy (http://user:pass@host:port). YouTube bot-walls datacenter IPs; a
# residential proxy (e.g. your home connection exposed via a tunnel) makes requests
# look residential and clears the wall. Audio is resolved + fetched on each desktop
# node now, off the user's own IP — the cloud no longer touches audio bytes. Empty
# = direct (dev / unset).
YOUTUBE_PROXY = env("YOUTUBE_PROXY", default="")

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
    "channels",
    "rest_framework",
    "corsheaders",
    "django_extensions",
    "django_filters",
    "django_guid",
    "drf_spectacular",
    "axes",
    "waffle",
    "pghistory",
    "pgtrigger",
    "health_check",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.headless",
    "allauth.mfa",
    "django_rls",
]

LOCAL_APPS = [
    "apps.users",
    "apps.core",
    "apps.catalog",
    "apps.rooms",
    "apps.notifications",
    "apps.friends",
]

# `daphne` MUST be first: in Channels 4 it provides the ASGI `runserver` that
# serves WebSockets (and static files in DEBUG) in dev. Listed first so its
# management command overrides Django's default WSGI runserver.
INSTALLED_APPS = ["daphne", *DJANGO_APPS, *THIRD_PARTY_APPS, *LOCAL_APPS]

# --- Middleware (order matters — see plan) ---
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Pin the host to the public domain on OAuth/auth paths so allauth's
    # redirect_uri is correct behind Render's reverse-proxy rewrite. Must run
    # before CSRF/Common/allauth so get_host() is already pinned. No-ops unless
    # OAUTH_CALLBACK_HOST is set (prod only) — local dev is untouched.
    "apps.core.middleware.CanonicalAuthHostMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django_guid.middleware.guid_middleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    # Staff/superusers must have an MFA factor enrolled before reaching /admin/.
    # After auth (needs request.user); redirects to enrollment if missing.
    "apps.core.middleware.RequireMfaForStaffMiddleware",
    # Authenticated users must verify their email before reaching /api/*. After
    # auth (needs request.user), before RLS (a 403 short-circuits the per-request
    # DB session-var setup).
    "apps.core.middleware.RequireVerifiedEmailMiddleware",
    "django_rls.middleware.RLSContextMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Project templates take precedence over app defaults — used to brand the
        # allauth account emails (templates/account/email/*).
        "DIRS": [BASE_DIR / "templates"],
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

# --- Channels (WebSockets) ---
# In-process channel layer: the fan-out for jam broadcasts lives in memory.
# This REQUIRES the backend to run as a SINGLE process (WEB_CONCURRENCY=1) —
# an in-memory layer can't reach sockets held by other workers. When we outgrow
# one process, swap BACKEND to "channels_redis.core.RedisChannelLayer" with a
# Redis URL; nothing else changes.
CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}

# Origins allowed to open a WebSocket — the WS analogue of CSRF (guards against
# cross-site WebSocket hijacking, since cookies are sent on the upgrade). In dev
# the SPA and API share the localhost origin; in prod the SPA is on
# music.whirlyfan.com while the socket connects to api.whirlyfan.com, so the
# SPA's hostname must be listed. Entries are hostnames (OriginValidator matches
# the Origin header's host); "*" disables the check.
WEBSOCKET_ALLOWED_ORIGINS = env.list(
    "DJANGO_WEBSOCKET_ALLOWED_ORIGINS",
    default=["localhost", "127.0.0.1"],
)

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
# "optional" + middleware gate, NOT "mandatory".
#
# Why: with "mandatory" allauth refuses to create a real authenticated
# session until verification — instead it returns 401 + a `verify_email`
# flow tied to an in-flight signup session. Close the tab and that session
# is gone, the resend endpoint stops working, and the user is locked out
# until they click the (possibly already-stale) email link.
#
# With "optional" the user gets a normal authenticated session at signup;
# `apps.core.middleware.RequireVerifiedEmailMiddleware` blocks /api/* until
# the email is verified, and the frontend's root route guard redirects them
# to /account/verify-email. Resend works any time post-signup.
#
# The seed command bakes admin@example.com + dev@example.com with verified
# email rows so local /admin/ access + dev login keep working out-of-box.
ACCOUNT_EMAIL_VERIFICATION = "optional"
# Allow the frontend to re-send the verification email during the signup
# flow (POST /auth/email/verify/resend). Without this, allauth returns
# 409 and the user can't recover from a missed / lost email.
ACCOUNT_EMAIL_VERIFICATION_SUPPORTS_RESEND = True
# Historically this would auto-login a user on email confirmation. As of
# django-allauth 65.x (2024) it is effectively a no-op — verifying via link
# NEVER mints a session, even with this set to True. The change closed an
# account-claim vector where an attacker could pre-register a victim's
# email, then re-direct the victim into the attacker's session on click.
# We keep the value set in case allauth re-introduces a same-session
# variant of the behavior, but the frontend assumes no auto-login: clicks
# from a fresh browser land on a "verified, please log in" screen.
ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION = True
# Single-email semantics: "change email" replaces the address rather than
# accumulating multiple. allauth adds the new email + sends verification;
# once verified, it becomes primary and the old address is removed. Until
# then the old email stays active so the account isn't locked out if the
# new address was a typo.
ACCOUNT_CHANGE_EMAIL = True
ACCOUNT_LOGIN_METHODS = {"email", "username"}
# Signup collects username + email + password (+ confirm). The `*` suffix
# marks required fields.
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_UNIQUE_EMAIL = True
# Case-insensitive uniqueness for usernames: 'Foo' collides with 'foo'.
ACCOUNT_PRESERVE_USERNAME_CASING = False
# Invite-only platform: a custom adapter lets only emails with a pending invitation
# sign up (see apps/users/adapter.py). `createsuperuser` bypasses it (bootstrap).
ACCOUNT_ADAPTER = "apps.users.adapter.AccountAdapter"

# --- Social login (Google) ---
# Credentials come from env (set in Render dashboard / Doppler; never the repo).
# The `APPS` list configures the provider entirely from settings, so there's no
# need to create a SocialApp row in the admin. Empty creds = the Google button
# simply won't work until they're set; nothing else breaks.
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APPS": [
            {
                "client_id": env("GOOGLE_OAUTH_CLIENT_ID", default=""),
                "secret": env("GOOGLE_OAUTH_CLIENT_SECRET", default=""),
                "key": "",
            }
        ],
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "OAUTH_PKCE_ENABLED": True,
    }
}
# Gate social *signup* behind the same invite_only switch as email signup, and
# accept the invite on signup (see apps/users/adapter.SocialAccountAdapter).
SOCIALACCOUNT_ADAPTER = "apps.users.adapter.SocialAccountAdapter"
# Connect a Google login to an existing local account with the SAME verified
# email instead of erroring on the unique-email constraint or creating a
# duplicate. Safe because Google asserts the email as verified — no
# unverified-email account-takeover vector. So an existing email/password user
# can also "Continue with Google" and land on their same account.
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True
# Trust Google's verified-email assertion → the new account's email is marked
# verified, so social users skip the RequireVerifiedEmailMiddleware gate.
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
# We don't need an extra "confirm your details" signup step for social — take
# the provider's email/name straight through.
SOCIALACCOUNT_AUTO_SIGNUP = True

HEADLESS_ONLY = True

# The user-facing frontend origin. allauth uses this to construct URLs in
# transactional emails (password reset link, signup confirmation). MUST be
# overridden in any non-localhost deploy — otherwise reset emails contain
# `http://localhost/...` links that go nowhere when clicked.
#
# Set FRONTEND_ORIGIN in Render / k8s / GCP env to your real domain, e.g.
#     FRONTEND_ORIGIN=https://app.yourdomain.com
FRONTEND_ORIGIN = env("FRONTEND_ORIGIN", default="http://localhost")
# The backend's own public origin. Email-verification links point HERE (a backend-
# rendered page), not the web frontend, so the desktop app doesn't depend on the
# (dead) web app for that flow. Defaults to FRONTEND_ORIGIN for local dev; set
# DJANGO_BACKEND_ORIGIN=https://api.whirlyfan.com in prod.
BACKEND_ORIGIN = env("DJANGO_BACKEND_ORIGIN", default=FRONTEND_ORIGIN) or FRONTEND_ORIGIN
# Where invitees download the desktop app (the invite landing page's CTA). The web
# app is retired, so an invitee with no app yet needs somewhere to get it. Set
# DESKTOP_DOWNLOAD_URL in env to the real release location.
DESKTOP_DOWNLOAD_URL = env(
    "DESKTOP_DOWNLOAD_URL", default="https://github.com/WhirlyFan/music/releases/latest"
)
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": f"{BACKEND_ORIGIN}/account/verify-email/{{key}}/",
    # Password reset is a backend-rendered page (like email verification), not the
    # dead web frontend. The desktop user resets in their browser, then returns to
    # the app and logs in with the new password.
    "account_reset_password_from_key": f"{BACKEND_ORIGIN}/account/password/reset/key/{{key}}/",
    # "Sign up" links in edge-case emails (unknown-account / account-already-exists)
    # send people to get the app — signup itself happens in-app and is invite-gated.
    "account_signup": DESKTOP_DOWNLOAD_URL,
    # Where allauth sends the browser when a social login fails (and the flow's
    # own `next`/callback_url is unavailable). REQUIRED once a social provider is
    # enabled — allauth raises ImproperlyConfigured (→ 500 on the OAuth callback)
    # if a social error occurs and this key is missing. Our /auth/callback reads
    # the appended `?error=` and shows the right message.
    "socialaccount_login_error": f"{FRONTEND_ORIGIN}/auth/callback",
}

# --- allauth MFA ---
# 2FA is opt-in for regular users (MFA_REQUIRED = False) — they enroll
# voluntarily from Settings. It is MANDATORY for staff/superusers, enforced at
# the /admin/ surface by apps.core.middleware.RequireMfaForStaffMiddleware
# (which redirects to enrollment if no factor exists). We keep it opt-in
# *globally* because when SAML/SSO lands later, the customer's IdP enforces
# their org's MFA policy and the app trusts the assertion — re-prompting every
# user in-app is the SSO anti-pattern; the staff /admin/ gate is the exception.
# Key for transparently encrypting sensitive MFA fields at rest.
# `apps.core.mfa_encryption` uses this to encrypt Authenticator.data["secret"]
# (TOTP secrets, etc.) before persisting to Postgres. Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Empty default fails LOUDLY on first MFA save/load — never silently store
# plaintext if the operator forgot to set it.
MFA_FIELD_ENCRYPTION_KEY = env("MFA_FIELD_ENCRYPTION_KEY", default="")

MFA_SUPPORTED_TYPES = ["totp", "recovery_codes", "webauthn"]
MFA_REQUIRED = False
MFA_TOTP_ISSUER = "music"
# Allow the previous and next 30-second TOTP windows in addition to the
# current one. Closes the common "I typed the last digit just as it rolled
# over" footgun without meaningfully weakening security (still ~90s of
# guess surface vs ~30s, well under the post-trust 30-day cookie window).
MFA_TOTP_TOLERANCE = 1
# "Remember this browser" — after the user passes MFA once, allauth sets a
# signed cookie that skips the MFA challenge for 30 days on this device.
# The cookie ride-alongs with the standard session cookie (Secure, HttpOnly,
# SameSite=Lax in prod via the inherited SESSION_COOKIE_* settings).
MFA_TRUST_ENABLED = True
MFA_TRUST_COOKIE_AGE = timedelta(days=30)
# Allow signing in with a passkey only (no password roundtrip). Modern UX win;
# safe to enable because allauth still requires a password at signup unless
# explicitly configured otherwise.
MFA_PASSKEY_LOGIN_ENABLED = True
MFA_PASSKEY_SIGNUP_ENABLED = False

# --- DRF ---
REST_FRAMEWORK = {
    # Two auth paths, tried in order:
    #  1. X-Session-Token — django-allauth headless "app" client (native/desktop:
    #     the Tauri app obtains a session token via OAuth and the local proxy sends
    #     it as this header). No CSRF (it's not cookie-based).
    #  2. SessionAuthentication — the cookie-based web app (allauth browser client).
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "allauth.headless.contrib.rest_framework.authentication.XSessionTokenAuthentication",
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
        # Per-member cap on invite sends (each one emails someone). Redeem stays on the
        # default `anon` rate — its token is 256-bit, so brute force is infeasible anyway.
        "invites": "20/day",
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "music API",
    "DESCRIPTION": "Backend API for the music project.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Schema only — no bundled Swagger UI. The raw OpenAPI doc at /api/schema/
    # drives `make gen-api` codegen; we don't render an interactive UI in-app.
}

# --- django-axes ---
# axes' out-of-box defaults are harsh (3 attempts, lock forever, IP-only —
# one user can lock out a shared NAT). Override with the standard
# "5 attempts, 1 hour, locked by (user + IP), forgive on good login" combo
# that most production apps run.
AXES_FAILURE_LIMIT = 5
# Lockout cooloff. Set to 5 minutes for development convenience — when
# you're iterating on auth UX you'll lock yourself out often, and waiting
# an hour to retry breaks flow. **Production default is 1 hour**: bump
# back to `timedelta(hours=1)` before shipping, or override per-env via
# `config/settings/prod.py`.
AXES_COOLOFF_TIME = timedelta(minutes=5)
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
# Reset the failure counter when the user logs in successfully — so a
# typo-then-correct sequence doesn't bleed into the next session's budget.
AXES_RESET_ON_SUCCESS = True

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
