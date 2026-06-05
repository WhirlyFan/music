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
# ffmpeg: required by yt-dlp to extract/convert audio.
# libexpat1: the only system lib the co-located PO-token server's bundled
#            `canvas` needs that isn't vendored alongside it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 ffmpeg libexpat1 && \
    rm -rf /var/lib/apt/lists/*

# Doppler CLI (static Go binary, pinned). Dev wraps startup in `doppler run` so
# secrets are fetched from Doppler into the process env at boot — never a file,
# never the compose allowlist. Unused in prod (Render injects env directly).
COPY --from=dopplerhq/cli:3.76.0 /bin/doppler /usr/local/bin/doppler

# deno: JS runtime yt-dlp uses to solve YouTube's signature / n challenges
# (with `remote_components=ejs:github`). Without it, YouTube returns no playable
# audio formats. Pinned for reproducibility.
COPY --from=denoland/deno:bin-2.8.2 /deno /usr/local/bin/deno

# bgutil PO-token provider — co-located IN this image (its Node binary + the
# prebuilt server, incl. the native `canvas` it needs). The entrypoint starts it
# on internal :4416; yt-dlp's bgutil plugin fetches YouTube PO tokens from it to
# avoid throttling. Running it in-container (vs a separate service) means it's
# free and shares the backend's lifecycle — wakes/sleeps with it. Keep this image
# tag in lockstep with the bgutil-ytdlp-pot-provider plugin in pyproject.toml.
COPY --from=brainicism/bgutil-ytdlp-pot-provider:1.3.1 /usr/local/bin/node /usr/local/bin/node
COPY --from=brainicism/bgutil-ytdlp-pot-provider:1.3.1 /app /opt/bgutil

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app

# Copy venv + source from builder
COPY --from=builder --chown=app:app /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOUTUBE_POT_BASE_URL=http://127.0.0.1:4416 \
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
#   --no-control-socket           Gunicorn 26 defaults its control socket to
#                                 /app/.gunicorn/gunicorn.ctl, which the non-root
#                                 `app` user can't create (read-only /app) — it
#                                 logs "Permission denied" on every boot. We don't
#                                 use the control interface, so disable it.
#   --bind 0.0.0.0:${PORT:-8000}  Bind the platform-assigned port. Render injects PORT
#                                 (we also pin it in render.yaml). Hardcoding 8000 made
#                                 Render's port detection prefer the co-located PO-token
#                                 provider on :4416 and time out / restart-loop. Defaults
#                                 to 8000 for local docker-compose (which maps 8000).
ENV WEB_CONCURRENCY=3
CMD ["sh", "-c", "gunicorn config.wsgi:application \
    --bind 0.0.0.0:${PORT:-8000} \
    --workers ${WEB_CONCURRENCY} \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --timeout 30 \
    --no-control-socket \
    --access-logfile - \
    --error-logfile -"]
