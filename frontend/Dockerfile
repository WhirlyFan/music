# syntax=docker/dockerfile:1
# Image for the React/Vite frontend's LOCAL DEV server (the `frontend` service in
# docker-compose.yml). There's no production web image — the UI ships embedded in
# the desktop app (built with `pnpm tauri build`, not Docker), so the old
# build/nginx stages were removed.
#
# CI=true tells pnpm to skip interactive prompts (e.g. its "purge node_modules to
# fix drift?" prompt that hangs in Docker without a TTY).

FROM node:24.16.0-alpine AS deps
ENV CI=true
RUN corepack enable
WORKDIR /app
# pnpm-workspace.yaml sets minimumReleaseAge=0 so the in-container install
# doesn't trip on freshly-published packages (pnpm 11+ supply-chain policy).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:24.16.0-alpine AS dev
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]
