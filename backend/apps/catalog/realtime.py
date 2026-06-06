"""Ephemeral per-playlist pub-sub for live VIEW updates.

Distinct from the notification outbox (apps.notifications.events): that delivers
durable, per-user events to the people ASSOCIATED with a playlist (owner +
collaborators). THIS is a transient subscription for whoever is CURRENTLY VIEWING
a playlist — an open-ended set you can't enumerate. They join the `playlist.{id}`
group while on the page and get a content-less `playlist.changed` nudge when it's
edited, then refetch over the (RLS-protected) REST API. No DB rows; the frame
carries no payload, so it leaks nothing.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

log = logging.getLogger(__name__)


def playlist_group(playlist_id) -> str:
    return f"playlist.{playlist_id}"


def broadcast_playlist_changed(playlist_id) -> None:
    """After the surrounding transaction commits, nudge everyone viewing this
    playlist to refetch. Best-effort — a channel-layer hiccup never fails the edit,
    and a missed nudge just means 'seen on next load'. Deferred to on_commit so
    subscribers refetch the post-change state, not a mid-transaction snapshot."""

    def _send():
        layer = get_channel_layer()
        if layer is None:
            return
        try:
            async_to_sync(layer.group_send)(
                playlist_group(playlist_id), {"type": "playlist.changed"}
            )
        except Exception:  # noqa: BLE001 — broadcast is best-effort
            log.warning("playlist broadcast failed for %s", playlist_id, exc_info=True)

    transaction.on_commit(_send)
