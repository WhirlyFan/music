"""Hatchet workflow definitions.

Workers register these workflows and execute them when the Django backend
calls `hatchet.client.admin.run_workflow(...)`. Each step is independently
durable: a failed step retries on its own without re-running upstream steps.

The `ParallelLLMWorkflow` is a template for the fan-out / fan-in pattern
described in the plan — replace the `_call_llm` placeholder with a real
provider call (OpenAI, Anthropic, etc.) when you wire LLM work in.
"""

from __future__ import annotations

import asyncio
import os

from hatchet_sdk import Context, Hatchet

# Lazily create the Hatchet client only when this module is imported by the
# worker process; the web container doesn't need to instantiate it on every
# request. Pulls config from HATCHET_CLIENT_* env vars.
hatchet = Hatchet(debug=os.getenv("HATCHET_DEBUG", "") == "1")


@hatchet.workflow(name="HelloWorkflow", on_events=["hello:requested"])
class HelloWorkflow:
    """Smoke-test workflow. Triggered manually or via event."""

    @hatchet.step()
    def greet(self, context: Context) -> dict:
        payload = context.workflow_input() or {}
        name = payload.get("name", "world")
        return {"message": f"hello, {name}"}


@hatchet.workflow(name="ParallelLLMWorkflow", on_events=["llm:batch-requested"])
class ParallelLLMWorkflow:
    """Template: fetch data → fan out parallel AI calls → aggregate.

    Each child step inherits durability + per-step retries, so a single
    failed AI call retries in isolation without re-running the others.
    """

    @hatchet.step(timeout="30s")
    def fetch_data(self, context: Context) -> dict:
        payload = context.workflow_input() or {}
        # Replace with real data loading — e.g. load items by id from Postgres.
        return {"items": payload.get("items", [])}

    @hatchet.step(parents=["fetch_data"], timeout="5m", retries=3)
    async def fan_out_ai(self, context: Context) -> dict:
        items = context.step_output("fetch_data")["items"]
        # Bound parallelism so we don't hammer the LLM provider.
        sem = asyncio.Semaphore(8)

        async def _process(item):
            async with sem:
                return await _call_llm(item)

        results = await asyncio.gather(*(_process(item) for item in items))
        return {"results": results}

    @hatchet.step(parents=["fan_out_ai"])
    def aggregate(self, context: Context) -> dict:
        results = context.step_output("fan_out_ai")["results"]
        return {"summary": _combine(results)}


# ---- Placeholders. Replace with real LLM calls in your worker code. ----


async def _call_llm(item) -> dict:
    """Replace this with a real provider call (OpenAI/Anthropic/etc).
    Keep it pure-async so `asyncio.gather` actually parallelizes."""
    await asyncio.sleep(0)  # yield to the event loop
    return {"input": item, "output": f"processed:{item}"}


def _combine(results: list[dict]) -> dict:
    return {"count": len(results), "items": results}
