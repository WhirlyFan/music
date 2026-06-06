"""The events layer — a single `emit()` provider that everything routes through.

Design (DB-outbox): the durable Notification row is written in the CALLER'S
transaction, so it commits atomically with the change that triggered it and can
never be lost. After commit we push a live nudge over the recipient's global
WebSocket group (best-effort) so an online client refetches immediately. There is
no broker: the database is the queue, and delivery is the (already durable) row +
an optional real-time bump. The same `emit()` API can later enqueue to a broker
for async fan-out / push without callers changing.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from .models import Notification

log = logging.getLogger(__name__)


def notification_group(user_id) -> str:
    """A per-user WS group, independent of any room/page — so a user receives
    events anywhere in the app (the global NotificationConsumer joins it)."""
    return f"notifications.{user_id}"


def emit(kind: str, *, recipient, actor=None, **payload) -> Notification | None:
    """Record a notification for `recipient` and schedule its live delivery. Returns
    the row, or None if there's nothing to send (no recipient, or self-notification)."""
    if recipient is None:
        return None
    if actor is not None and getattr(actor, "id", None) == recipient.id:
        return None  # never notify yourself
    note = Notification.objects.create(
        recipient=recipient, actor=actor, kind=kind, payload=payload or {}
    )
    transaction.on_commit(lambda: _push(recipient.id))
    return note


def emit_many(kind: str, *, recipients, actor=None, **payload) -> list[Notification]:
    """Fan a single event out to several recipients (e.g. every collaborator on a
    playlist). Thin loop over `emit` — which already skips the actor and any None —
    so each recipient gets their own durable row + live nudge. Returns the rows
    actually created."""
    notes = [emit(kind, recipient=r, actor=actor, **payload) for r in recipients]
    return [n for n in notes if n is not None]


def _push(recipient_id) -> None:
    """Nudge the recipient's live socket(s) to refetch. Best-effort — the durable
    row is already committed, so a missed push just means 'seen on next load'."""
    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            notification_group(recipient_id), {"type": "notification.new"}
        )
    except Exception:  # noqa: BLE001 — live push is best-effort
        log.warning("notification live-push failed for %s", recipient_id, exc_info=True)
