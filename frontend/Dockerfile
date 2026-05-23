# syntax=docker/dockerfile:1
# Multi-stage build for the React/Vite frontend.

# CI=true in each stage tells pnpm to skip interactive prompts (e.g. its
# "purge node_modules to fix drift?" prompt that hangs in Docker w/o a TTY).

FROM node:22-alpine AS deps
ENV CI=true
RUN corepack enable
WORKDIR /app
# pnpm-workspace.yaml sets minimumReleaseAge=0 so the in-container install
# doesn't trip on freshly-published packages (pnpm 11+ supply-chain policy).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS dev
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

FROM node:22-alpine AS build
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
