# Background Jobs & Workflows

We use **Hatchet Lite** — a self-hosted, Postgres-backed workflow engine
with first-class DAG primitives. Day-one decision because the LLM use
case requires fan-out parallel calls with per-step durability, retries,
and timeouts.

ADR: [decisions/0002-hatchet-lite-over-celery.md](decisions/0002-hatchet-lite-over-celery.md).

## Topology

```
backend (Django web)
   │
   │ hatchet.client.run_workflow(name, input)
   ▼
hatchet-lite (engine)        ← Postgres-backed; shares `db` container
   │                           uses separate `hatchetdb` database
   │ gRPC :7077
   ▼
worker (same Django image, different command)
   │
   │ runs DAG steps; calls external APIs (LLMs);
   │ writes results back via Django ORM
   ▼
appdb (RLS-scoped)
```

Five moving parts:

| Service | Image | What it does |
|---|---|---|
| `hatchet` | `hatchet-dev/hatchet-lite` | Workflow engine. gRPC :7077, admin UI :8080 |
| `worker` | local backend Dockerfile | Runs `manage.py hatchet_worker`. Subscribes to Hatchet, executes step functions |
| `backend` | local backend Dockerfile | Triggers workflows via `hatchet.client.admin.run_workflow(...)` |
| `db` (`hatchetdb`) | postgres:17.10-alpine | Hatchet's internal state (separate from `appdb`) |
| `WorkflowRun` model in `appdb` | — | Lightweight tracking row — owner, status, hatchet_run_id |

## The `WorkflowRun` tracking model

Hatchet stores the canonical workflow state in `hatchetdb`. We keep a
small row per kickoff in `appdb`:

```python
class WorkflowRun(RLSModel):
    owner = models.ForeignKey("users.User", ...)
    workflow = models.CharField(max_length=128)
    hatchet_run_id = models.CharField(max_length=128, db_index=True)
    input = models.JSONField(default=dict)
    status = models.CharField(...)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        rls_policies = [owner_scoped_policy("owner")]
```

Why we keep this even though Hatchet is the source of truth for run state:

| Reason | Detail |
|---|---|
| **RLS-scoped tracking** | Each run belongs to a user, isolated at DB level |
| **Audit trail** | `django-pghistory` captures every state transition |
| **Stable API contract** | `/api/jobs/<run_id>/` works regardless of orchestrator |
| **Easy business associations** | Billing, quotas, customer scoping all hang off this row |
| **Insulation** | If we ever swap Hatchet for something else, the public contract doesn't change |

## Canonical DAG workflow

The use case driving the day-one choice — fan-out parallel LLM calls,
fan-in aggregate, per-step durability:

```python
# apps/jobs/workflows.py
from hatchet_sdk import Hatchet, Context

hatchet = Hatchet()

@hatchet.workflow(on_events=["llm:batch-requested"])
class ParallelLLMWorkflow:

    @hatchet.step(timeout="30s")
    async def fetch_data(self, ctx: Context) -> dict:
        return {"items": load_items(ctx.workflow_input()["batch_id"])}

    @hatchet.step(parents=["fetch_data"], timeout="5m", retries=3)
    async def fan_out_ai(self, ctx: Context) -> dict:
        items = ctx.step_output("fetch_data")["items"]
        # Each child workflow is independently durable + retryable
        results = await ctx.aio.spawn_workflows([
            {"workflow": "ProcessItem", "input": item} for item in items
        ])
        return {"results": [r.result for r in results]}

    @hatchet.step(parents=["fan_out_ai"])
    async def aggregate(self, ctx: Context) -> dict:
        results = ctx.step_output("fan_out_ai")["results"]
        return {"summary": combine(results)}
```

**The value:** if `ProcessItem` step 47 of 100 fails, only step 47 retries
— the other 99 results are persisted. Without per-step durability, a
failed batch re-runs and re-pays for all 100 LLM calls.

## Triggering from the frontend

```python
# apps/jobs/views.py
@api_view(["POST"])
def trigger_batch(request):
    # Tracking row in our DB, RLS-scoped to the user
    run = WorkflowRun.objects.create(owner=request.user, workflow="ParallelLLMWorkflow")
    hatchet_run = hatchet.client.admin.run_workflow(
        "ParallelLLMWorkflow",
        {"batch_id": str(run.id), "user_id": request.user.id},
    )
    run.hatchet_run_id = hatchet_run.workflow_run_id
    run.save()
    return Response({"run_id": run.id})

@api_view(["GET"])
def workflow_status(request, run_id):
    run = WorkflowRun.objects.get(id=run_id)  # RLS already filters
    h = hatchet.client.admin.get_workflow_run(run.hatchet_run_id)
    return Response({"status": h.status, "result": h.output})
```

Frontend uses TanStack Query with `refetchInterval` polling until
`status === "SUCCEEDED"`. When Channels arrives we swap polling for
WebSocket push.

## Why Hatchet over Celery / Procrastinate / Temporal

| | Hatchet Lite | Celery | Procrastinate | Temporal |
|---|---|---|---|---|
| DAG primitives | ✅ first-class | ⚠️ Canvas (weaker) | ❌ | ✅ |
| Per-step durability | ✅ | ❌ | ⚠️ | ✅ |
| Per-step retry/timeout | ✅ | ⚠️ | ⚠️ | ✅ |
| Postgres-backed | ✅ (Lite) | ❌ (Redis/RabbitMQ) | ✅ | ❌ |
| Observability UI | ✅ | ⚠️ Flower | ❌ | ✅ |
| Self-hosted free | ✅ MIT | ✅ | ✅ MIT | ⚠️ heavy |
| Right for LLM batches | ✅ | ⚠️ | ❌ | ✅ but overkill |

**Procrastinate** would be the better choice if we didn't need DAGs — but
the LLM use case requires fan-out/fan-in.

**Temporal** is heavier; not our scale.

**Celery** has the legacy mindshare but DAGs (via Canvas) are not its
strength, and it requires a separate Redis/RabbitMQ broker.

## Upgrade path

| When | Move to |
|---|---|
| Throughput > ~100k workflow runs / hour | Hatchet's RabbitMQ-backed production deploy. **Same workflow code**, different infra. |
| Cross-service distributed transactions, sagas | Temporal. Larger lift; not justified at our current scale. |

The `WorkflowRun` model insulates us: if we ever swap the orchestrator
entirely, the public API contract (`/api/jobs/...` returning a `run_id`)
stays stable.

## Deploy notes

**Local + self-hosted compose:** the `hatchet` + `worker` services in
[docker-compose.yml](../docker-compose.yml) bring everything up.

**Render Phase A:** Hatchet is deferred. Background-worker services on
Render aren't on the free tier — would be +$14/mo (engine + worker). The
template ships with `WorkflowRun` and the wiring, but no workflows are
called from user-visible features yet, so the cost isn't warranted for
the first deploy. See [ops/deploy-render.md](ops/deploy-render.md)
"Phase B promotions."

**GCP / k8s:** worker = Cloud Run Job (or a k8s Deployment with replicas).
The Hatchet engine itself runs as another Cloud Run service or k8s
Deployment. Same image, different orchestration.

## See also

- [decisions/0002-hatchet-lite-over-celery.md](decisions/0002-hatchet-lite-over-celery.md)
- [architecture.md](architecture.md) — system overview
- [Hatchet DAG docs](https://docs.hatchet.run/v1/directed-acyclic-graphs)
- [Hatchet self-hosting (Lite)](https://docs.hatchet.run/self-hosting)
