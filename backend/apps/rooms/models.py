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
    """One entry in a room, in one of Spotify's two layers:

    - CONTEXT: the list you're playing *from* (album/playlist/song). It is a
      STABLE list with a position pointer (`PlaybackState.context_pos`) — it is
      NOT consumed as you play, so moving forward/back just moves the pointer and
      skipped tracks remain in the list (reachable via Previous). Replaced when
      you start a new context.
    - QUEUE: tracks you explicitly "Add to queue". Ephemeral — they play *before*
      the context resumes, are deleted once consumed, and survive a context change.

    `position` orders each layer; `created_at` = added time.
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
    """Now-playing head for a room. `current_item` is the playing row (a CONTEXT
    or QUEUE item); `context_pos` is the pointer into the (stable) context list —
    the position of the context track we're at, so the queue can play "on top"
    and the context resumes after it. `context_label` feeds the "Next from: …"
    line. In a shared room the server is the clock authority (Phase B uses
    `position_ms` + `updated_at` for drift correction)."""

    room = models.OneToOneField(Room, on_delete=models.CASCADE, related_name="playback")
    current_item = models.ForeignKey(
        QueueItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    context_pos = models.IntegerField(null=True, blank=True)
    context_label = models.CharField(max_length=255, blank=True)
    position_ms = models.IntegerField(default=0)
    is_playing = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"Playback({self.room_id}, item={self.current_item_id}, playing={self.is_playing})"
