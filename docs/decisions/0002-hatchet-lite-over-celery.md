# 0002 — Hatchet Lite as the workflow engine

**Status:** Accepted
**Date:** 2026-05-22

## Context

The template's first real use case is LLM workflows: fan-out parallel API
calls (one per item in a batch), fan-in aggregation, with retries on
transient failures. Per-step durability matters for cost — without it, a
single failure in the middle of a 100-item batch re-runs and re-pays for
all 100 LLM calls.

Options surveyed:

| Engine | DAG | Per-step durability | Postgres-backed | Free self-host | UI |
|---|---|---|---|---|---|
| **Hatchet Lite** | ✅ first-class | ✅ | ✅ | ✅ MIT | ✅ |
| Celery | ⚠️ Canvas | ❌ | ❌ Redis/RabbitMQ | ✅ | ⚠️ Flower |
| Procrastinate | ❌ | ⚠️ | ✅ | ✅ MIT | ❌ |
| Temporal | ✅ | ✅ | ❌ | ⚠️ heavy | ✅ |
| Django-q2 | ❌ | ❌ | ✅ | ✅ | ⚠️ |

Hatchet is the only option that combines first-class DAG primitives,
per-step durability, Postgres backing (no new infra dep), free
self-hosting, and an observability UI.

Temporal is technically the most powerful — but heavier than we need at
this scale.

Celery's DAG support (Canvas) is real but weaker, and adding a
Redis/RabbitMQ broker is meaningful infra growth.

## Decision

Use **Hatchet Lite**, day one. The `hatchet` engine container shares our
existing Postgres (separate `hatchetdb` DB). The `worker` service is the
same Django image as `backend`, running a different command.

Keep a small `WorkflowRun` model in `appdb` (RLS-scoped, audit-logged) to
insulate the public API contract from the orchestrator: `/api/jobs/...`
returning a `run_id` works even if we ever swap engines.

## Consequences

### What we gain
- DAG ergonomics: `@hatchet.step(parents=[...])` + `ctx.aio.spawn_workflows([...])`
- Per-step durability — failed step retries; persisted steps don't re-run
- Per-step timeouts + retry policies (data fetch vs LLM call have different needs)
- Observability UI for LLM debugging — prompts/responses are the whole story
- Zero new infra beyond one extra container

### What we give up
- An extra container to operate
- One more SDK to learn
- Worker deployment cost on platforms without free background workers (Render +$7/mo each)

### Upgrade path
- > 100k workflow runs/hour → swap Hatchet Lite for Hatchet's
  RabbitMQ-backed production deploy. **Same workflow code**, different infra.
- Cross-service distributed transactions / sagas → Temporal. Larger lift.

## Notes / future work
- See [jobs.md](../jobs.md) for the architecture + canonical DAG example.
- Render Phase A defers Hatchet to keep the first deploy free — see
  [ops/deploy-render.md](../ops/deploy-render.md) "Phase B promotions."
