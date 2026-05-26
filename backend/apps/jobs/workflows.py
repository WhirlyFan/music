"""Hatchet workflow definitions.

Workers register these workflows and execute them when the Django backend
calls the workflow's `run` method (or fires the relevant event). Each task
is independently durable: a failed task retries on its own without re-running
upstream tasks.

`parallel_llm_workflow` is a template for the fan-out / fan-in pattern from
the original plan — replace the `_call_llm` placeholder with a real provider
call (OpenAI, Anthropic, etc.) when wiring LLM work in.

SDK note: hatchet-sdk 1.x dropped the class-decorator API
(`@hatchet.workflow` on a class, `@hatchet.step` on methods). The current
shape is "workflow factory returns a Workflow object, then `.task(...)`
decorates module-level functions." See:
https://docs.hatchet.run/sdks/python-sdk/workflows
"""

from __future__ import annotations

import asyncio
import os
from datetime import timedelta

from hatchet_sdk import Context, Hatchet

# Lazily instantiate the Hatchet client only when this module is imported by
# the worker process; the web container doesn't need it on every request.
# Pulls config from HATCHET_CLIENT_TOKEN / HATCHET_CLIENT_HOST_PORT.
hatchet = Hatchet(debug=os.getenv("HATCHET_DEBUG", "") == "1")


# ─── Hello (smoke test) ────────────────────────────────────────────────────

hello_workflow = hatchet.workflow(name="HelloWorkflow", on_events=["hello:requested"])


@hello_workflow.task()
def greet(_input, context: Context) -> dict:
    """Smoke-test task. Triggered manually or via the `hello:requested` event."""
    payload = context.workflow_input() or {}
    name = payload.get("name", "world") if isinstance(payload, dict) else "world"
    return {"message": f"hello, {name}"}


# ─── Parallel LLM template (fan-out / fan-in) ──────────────────────────────

parallel_llm_workflow = hatchet.workflow(
    name="ParallelLLMWorkflow", on_events=["llm:batch-requested"]
)


@parallel_llm_workflow.task(execution_timeout=timedelta(seconds=30))
def fetch_data(_input, context: Context) -> dict:
    """Load the input batch. Replace with real loading (e.g. by id from PG)."""
    payload = context.workflow_input() or {}
    items = payload.get("items", []) if isinstance(payload, dict) else []
    return {"items": items}


@parallel_llm_workflow.task(
    parents=[fetch_data],
    execution_timeout=timedelta(minutes=5),
    retries=3,
)
async def fan_out_ai(_input, context: Context) -> dict:
    """Fan out N parallel AI calls with bounded concurrency.

    Note: parallel here is in-task parallelism via `asyncio.gather`. Hatchet's
    true fan-out across workers happens via `Context.spawn_workflows`, which
    is the right pattern once each call is heavy enough to need its own
    retry/durability budget. Keeping it inline for the template.
    """
    items = context.task_output(fetch_data)["items"]
    sem = asyncio.Semaphore(8)  # bound provider concurrency

    async def _process(item):
        async with sem:
            return await _call_llm(item)

    results = await asyncio.gather(*(_process(i) for i in items))
    return {"results": results}


@parallel_llm_workflow.task(parents=[fan_out_ai])
def aggregate(_input, context: Context) -> dict:
    results = context.task_output(fan_out_ai)["results"]
    return {"summary": _combine(results)}


# ─── Placeholders. Replace with real LLM calls in your worker code. ────────


async def _call_llm(item) -> dict:
    """Replace this with a real provider call (OpenAI / Anthropic / etc).
    Keep it pure-async so `asyncio.gather` actually parallelizes."""
    await asyncio.sleep(0)  # yield to the event loop
    return {"input": item, "output": f"processed:{item}"}


def _combine(results: list[dict]) -> dict:
    return {"count": len(results), "items": results}


# ─── Registry ──────────────────────────────────────────────────────────────
# Map workflow name → workflow object. Used by `apps.jobs.views` to look up
# a workflow by the name the API caller submitted, then call `.run(input,
# wait_for_result=False)` to enqueue. Keep in sync with the workflows
# defined above + with the `workflows=[...]` arg in `hatchet_worker.py`.
WORKFLOWS = {
    "HelloWorkflow": hello_workflow,
    "ParallelLLMWorkflow": parallel_llm_workflow,
}
