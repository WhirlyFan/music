# 0005 — Deploy to Render first; GCP / k8s when the project justifies it

**Status:** Accepted
**Date:** 2026-05-26

## Context

This template needs a "first prod deployment" path for two reasons:
(1) validating the stack against real-prod constraints (TLS, env vars,
secrets, logging, cold starts, CSRF in non-localhost domains),
(2) exercising the deploy operations so the *next* project — built from
this template — has a documented path.

Options surveyed for hobby / template-scale deploy:

| Platform | Free tier | Containers | Postgres | Best for |
|---|---|---|---|---|
| **Render** | Yes (sleeps after 15 min) | Docker | Free 90d, then $7/mo | First deploy; simplest UX |
| Fly.io | Yes (3 small VMs) | Docker | ~$0-3/mo | More flexibility; longer-running |
| Railway | $5 trial credits | Docker | Yes | Similar feel to Render |
| GCP Cloud Run | Yes (compute) | Docker | ❌ Cloud SQL ~$10/mo | When scale or ecosystem matters |
| GKE / k8s | ❌ | Yes | ❌ | Multi-service, custom infra |
| AWS ECS | Limited | Yes | RDS | Mature, complex |

The honest tradeoff:
- **Free for a hobby project** rules out GCP and AWS (Postgres alone is $7-10/mo)
- **Skills that transfer to GCP later** is the meta-goal — design for portability
- **Container-native** options (Render, Fly, Cloud Run) all consume the same Dockerfile and env-var contract

## Decision

**Phase A:** Deploy this template to Render. Three services: Static Site
(frontend) + Web Service (backend, free tier with sleep) + managed
Postgres (free 90 days). Defer Hatchet (no workflows wired to user-visible
features yet). Use Render's Static Site rewrites for same-origin routing
— mirrors the local nginx setup.

**Phase B:** Add Hatchet engine + worker (+$14/mo); upgrade Postgres
($7/mo); custom domain. Restore two-role Postgres via migration.

**Phase C / next real project:** Port to GCP + Cloud Run + Cloud SQL when
the project justifies the cost ($10-20/mo). The container, env vars,
health endpoint, and migrations-on-boot all transfer unchanged; only the
orchestration glue is rewritten.

## Consequences

### What we gain
- Free first deploy — exercise prod ops without burning budget
- Render's edge subsumes nginx's job — fewer moving parts in cloud than locally
- Render's Blueprint (`render.yaml`) gives us infra-as-code from day one
- The migration to GCP is mechanical because every Render abstraction
  has a GCP equivalent (Static Site → GCS + Cloud CDN, Web Service →
  Cloud Run, env vars → Secret Manager, etc.)

### What we give up
- Cold starts on the backend free tier (~30s on first request after 15 min idle)
- No backups on free Postgres
- Hatchet deferred — workflows aren't testable in this deploy
- Render-specific YAML format (one file we'd rewrite for GCP)

### Portability invariants we maintain
1. No `RENDER_*` env vars in code — only in `render.yaml`
2. Generic env var names (`DATABASE_URL`, `DJANGO_*`, etc.) that any platform consumes
3. Same `Dockerfile` builds locally, on Render, and on Cloud Run unchanged
4. `/health/` endpoint that any platform's health check can consume
5. Migrations on container boot via `docker-entrypoint.sh` — works everywhere

If those invariants stay clean, the Render → GCP port is ~1-2 days of work,
mostly rewriting the orchestration YAML.

## Notes / future work
- Walkthrough: [ops/deploy-render.md](../ops/deploy-render.md).
- When porting to GCP, write `decisions/0007-gcp-cloud-run-migration.md`
  capturing the actual port — what env vars mapped where, what surprised us,
  what we'd do differently next time.
