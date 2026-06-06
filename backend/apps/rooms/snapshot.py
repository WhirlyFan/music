"""Load + serialize a room in the player's shape.

Shared by the REST views and the WebSocket consumer so an HTTP response and a
socket frame for the same room are byte-identical — the client can feed either
into the same TanStack Query cache without reconciling shape differences.
"""

from django.db.models import Prefetch

from .models import QueueItem, Room
from .serializers import RoomSerializer


def load_room(room_id) -> Room:
    """A fully-prefetched room (now-playing track + sources, both queue layers,
    members) — everything RoomSerializer touches, in one round of queries."""
    return (
        Room.objects.select_related(
            "playback", "playback__current_item", "playback__current_item__track"
        )
        .prefetch_related(
            Prefetch(
                "items",
                queryset=QueueItem.objects.select_related("track").order_by("position"),
            ),
            "items__track__playback_sources",
            "playback__current_item__track__playback_sources",
            "members__user",
        )
        .get(pk=room_id)
    )


def serialize_room(room_id) -> dict:
    return RoomSerializer(load_room(room_id)).data
