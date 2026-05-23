"""Lightweight tracking layer over Hatchet workflow runs.

Hatchet stores the canonical workflow state in its own database. We keep
a small `WorkflowRun` row per kickoff so we can:

  * scope runs to a user via RLS (`owner_id`)
  * attach billing / quota / audit context to a run
  * expose a stable, RLS-aware API (`/api/jobs/<run_id>/`) regardless of
    whether we ever swap orchestrators

The Hatchet workflow code is the source of truth for *what happened*;
this table is the source of truth for *who triggered it*.
"""
from django.conf import settings
from django.db import models
from django_rls import RLSModel
from django_rls.policies import UserPolicy


class WorkflowRun(RLSModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workflow_runs",
    )
    workflow = models.CharField(max_length=128, help_text="Hatchet workflow class name")
    hatchet_run_id = models.CharField(max_length=128, blank=True, db_index=True)
    input = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        rls_policies = [
            UserPolicy(name="owner_isolation", user_field="owner"),
        ]

    def __str__(self) -> str:
        return f"{self.workflow} ({self.id}, {self.status})"
