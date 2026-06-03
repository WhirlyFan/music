# syntax=docker/dockerfile:1
# Multi-stage build using uv. Final image contains only runtime deps.

FROM python:3.14-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first (cached layer).
# We include dev deps in the image so `config.settings.dev` (which imports
# debug_toolbar etc.) works inside the container. Prod swaps to settings.prod
# via env, which doesn't load those modules.
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project || \
    uv sync --no-install-project

# Copy app source
COPY . .

# ---- Final runtime stage ----
FROM python:3.14-slim AS runtime

# libpq5: Postgres client lib needed by psycopg.
# ffmpeg: required by yt-dlp to extract/convert audio (used by the worker).
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Doppler CLI (static Go binary, pinned). Dev wraps startup in `doppler run` so
# secrets are fetched from Doppler into the process env at boot — never a file,
# never the compose allowlist. Unused in prod (Render injects env directly).
COPY --from=dopplerhq/cli:3.76.0 /bin/doppler /usr/local/bin/doppler

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app

# Copy venv + source from builder
COPY --from=builder --chown=app:app /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod

# --- Collect static files into STATIC_ROOT so WhiteNoise can serve them.
#     Runs at build time (Django admin assets, DRF browsable API CSS, etc.).
#     Uses dev settings just for this — collectstatic only reads STATIC_*
#     settings and never touches the DB, but prod settings demand a bunch
#     of secrets we don't have at build time.
USER root
RUN DJANGO_SETTINGS_MODULE=config.settings.dev \
    DJANGO_DEBUG=false \
    DJANGO_SECRET_KEY=collectstatic-build-time-only \
    DATABASE_URL=postgres://collectstatic@invalid/db \
    /app/.venv/bin/python manage.py collectstatic --noinput && \
    chown -R app:app /app/staticfiles

USER app
EXPOSE 8000

# Migrate-then-exec wrapper. Runs on every container start; idempotent.
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Gunicorn flags chosen to match the standard production checklist:
#   --workers $WEB_CONCURRENCY    Env-overridable worker count.
#   --max-requests / --jitter     Recycle workers periodically so any slow
#                                 memory creep self-heals.
#   --timeout 30                  Kill long-running workers before they pile up.
#   --access-logfile - / --error-logfile -  stdout; orchestrator captures it.
ENV WEB_CONCURRENCY=3
CMD ["sh", "-c", "gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers ${WEB_CONCURRENCY} \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --timeout 30 \
    --access-logfile - \
    --error-logfile -"]
