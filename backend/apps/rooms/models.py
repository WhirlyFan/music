"""
Listening sessions ("rooms") + the playback queue.

Room-of-one: every user listens inside a Room (their private queue + now-playing).
Phase B (the Jam) makes a Room *shareable* (members join via a code over
WebSockets) — those fields (code, is_shared, allow_guest_control) + RoomMember
land then. For now a Room is a single user's playback context.

See docs/design/queue-rooms.md.
"""

from django.conf import settings
from django.db import models

from apps.catalog.models import Track
from apps.core.models import BaseModel


class Room(BaseModel):
    """A listening context: an ordered queue + a now-playing head. One active
    Room per user (room-of-one); a future Jam flips one to shared."""

    host = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rooms"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["host"],
                condition=models.Q(is_active=True),
                name="one_active_room_per_host",
            )
        ]

    def __str__(self) -> str:
        return f"Room({self.host_id})"


class QueueItem(BaseModel):
    """One track in a room's single ordered queue (a list + a current pointer —
    the model used by most players). Items aren't deleted as they play: those
    *behind* the `PlaybackState.current_item` are the history (so Previous walks
    back), those *ahead* are up-next. `position` orders the whole list;
    `created_at` = added time."""

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="items")
    track = models.ForeignKey(Track, on_delete=models.PROTECT, related_name="queue_items")
    position = models.IntegerField()
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="queued_items",
    )

    class Meta:
        ordering = ["position"]
        indexes = [models.Index(fields=["room", "position"])]

    def __str__(self) -> str:
        return f"{self.room_id}[{self.position}] → {self.track_id}"


class PlaybackState(BaseModel):
    """Now-playing head for a room: a pointer into the queue (`current_item`).
    Next/Previous move it forward/back; items behind it are history. In a shared
    room the server is the clock authority (Phase B uses `position_ms` +
    `updated_at` for drift correction)."""

    room = models.OneToOneField(Room, on_delete=models.CASCADE, related_name="playback")
    current_item = models.ForeignKey(
        QueueItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    position_ms = models.IntegerField(default=0)
    is_playing = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"Playback({self.room_id}, item={self.current_item_id}, playing={self.is_playing})"
