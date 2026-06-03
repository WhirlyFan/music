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
    """One upcoming entry in a room, in one of two layers (Spotify's model):

    - CONTEXT: the list you're playing *from* (album/playlist/import). It shrinks
      as you play — consumed items are deleted — and is replaced when you start a
      new context.
    - QUEUE: tracks you explicitly "Add to queue". They play *before* the context
      resumes and survive a context change.

    Up-next render + advance order is: all QUEUE items, then all CONTEXT items,
    each by `position`. `created_at` = added time.
    """

    class Kind(models.TextChoices):
        CONTEXT = "context", "From context"
        QUEUE = "queue", "User queue"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="items")
    track = models.ForeignKey(Track, on_delete=models.PROTECT, related_name="queue_items")
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.CONTEXT)
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
        indexes = [models.Index(fields=["room", "kind", "position"])]

    def __str__(self) -> str:
        return f"{self.room_id}[{self.kind}:{self.position}] → {self.track_id}"


class PlaybackState(BaseModel):
    """Now-playing head for a room. `current_track` is what's playing (a plain
    Track — a consumed queue/context item is deleted, so the head can't dangle).
    `context_label` is the source name for the "Next from: …" line. In a shared
    room the server is the clock authority (Phase B uses `position_ms` +
    `updated_at` for drift correction)."""

    room = models.OneToOneField(Room, on_delete=models.CASCADE, related_name="playback")
    current_track = models.ForeignKey(
        Track, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    context_label = models.CharField(max_length=255, blank=True)
    position_ms = models.IntegerField(default=0)
    is_playing = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"Playback({self.room_id}, track={self.current_track_id}, playing={self.is_playing})"
