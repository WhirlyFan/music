"""Push room state to everyone connected to a Jam.

The REST mutations stay the single write path; after one commits, the view hands
the freshly-serialized room here to fan out over the channel layer. The
RoomConsumer (Stage 4) relays it to each socket, which feeds it into the same
TanStack Query cache the HTTP response seeds — so "only I see it" becomes
"everyone in the jam sees it."
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

log = logging.getLogger(__name__)


def group_name(room_id) -> str:
    return f"room.{room_id}"


def publish(room_id, room_data: dict) -> None:
    """Fan a serialized room out to its group. Fire-and-forget: a channel-layer
    hiccup must never fail the mutation that triggered it."""
    layer = get_channel_layer()
    if layer is None:  # no channel layer configured (some test setups)
        return
    try:
        async_to_sync(layer.group_send)(
            group_name(room_id),
            {
                "type": "room.update",  # → RoomConsumer.room_update
                "room": room_data,
                "generation": room_data.get("generation", 0),
            },
        )
    except Exception:  # noqa: BLE001 — broadcast is best-effort
        log.exception("room broadcast failed for room %s", room_id)
