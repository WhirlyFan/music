"""
Listening sessions ("rooms") + the playback queue.

Room-of-one by default: every user listens inside a Room (their private queue +
now-playing). A Room can be *shared* as a Jam — others join via a short code and
follow the host's playback in sync over WebSockets. Sharing state lives on the
Room (`code`, `is_shared`, `allow_guest_control`) plus `RoomMember`; the server
is the clock authority (`PlaybackState.playing_since` + `position_ms`).

See docs/design/queue-rooms.md.
"""

import random

from django.conf import settings
from django.db import models

from apps.catalog.models import Track
from apps.core.models import BaseModel


def _new_shuffle_seed() -> int:
    """A fresh seed for a room's next shuffle. Module-level (not a lambda) so
    migrations can reference it. 63 bits keeps it inside a signed BIGINT."""
    return random.getrandbits(63)


class Room(BaseModel):
    """A listening context: an ordered queue + a now-playing head. One active
    Room per user (room-of-one); a future Jam flips one to shared."""

    host = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rooms"
    )
    is_active = models.BooleanField(default=True)

    # --- Jam (sharing) ---
    # When `is_shared`, others join with `code` and follow the host's playback.
    # `code` is blank for a private room and unique among shared rooms (the
    # partial constraint below). `allow_guest_control` opens transport/queue to
    # guests; default is host-only (guests follow + suggest).
    code = models.CharField(max_length=12, blank=True, db_index=True)
    is_shared = models.BooleanField(default=False)
    allow_guest_control = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["host"],
                condition=models.Q(is_active=True),
                name="one_active_room_per_host",
            ),
            # Join codes only need to be unique among the rooms that are actually
            # shareable; a private room keeps `code` blank.
            models.UniqueConstraint(
                fields=["code"],
                condition=models.Q(is_shared=True),
                name="unique_active_jam_code",
            ),
        ]

    def __str__(self) -> str:
        return f"Room({self.host_id})"


class RoomMember(BaseModel):
    """A participant in a shared room (Jam). The host gets a `host` row when they
    share; everyone who joins by code gets a `guest` row. A user is a guest in at
    most one jam at a time (joining a new one leaves the previous)."""

    class Role(models.TextChoices):
        HOST = "host", "Host"
        GUEST = "guest", "Guest"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="room_memberships"
    )
    role = models.CharField(max_length=8, choices=Role.choices, default=Role.GUEST)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "user"], name="unique_room_member"),
        ]

    def __str__(self) -> str:
        return f"{self.role}:{self.user_id}@{self.room_id}"


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
    # Server clock authority for jam sync: `playing_since` is the server time the
    # head started advancing from `position_ms` (None while paused/stopped), so
    # any client computes the live position as `position_ms + (now - playing_since)`.
    # `generation` is a per-room monotonic counter bumped on every broadcast; a
    # client drops frames older than the latest generation it has seen.
    playing_since = models.DateTimeField(null=True, blank=True)
    generation = models.IntegerField(default=0)
    # Synced start: in a shared room a freshly-chosen track waits here
    # (is_playing=false, no clock) until every PRESENT node reports its audio is
    # ready (each desktop node caches locally now, so the server can't tell from
    # its own cache) OR `start_deadline` passes — so a slow node is waited for but
    # a crashed/disconnected one can't stall the jam. Flips to is_playing then; a
    # late node catches up to the clock on its next frame. Always false in a solo
    # room (starts immediately). See apps.rooms.coordination.
    pending_start = models.BooleanField(default=False)
    # Hard cap on the synced-start wait: the server starts a pending shared room no
    # later than this, even if some node never reports ready (failure tolerance).
    # None unless a track is pending. See coordination.GRACE_SECONDS.
    start_deadline = models.DateTimeField(null=True, blank=True)
    # Seed for the room's NEXT shuffle. Because shuffle is server-side and seeded,
    # the result is deterministic from (seed, current context) — so prewarm can
    # warm the exact track a shuffle will land on. shuffle() rotates this after it
    # runs, so the following shuffle differs.
    next_shuffle_seed = models.BigIntegerField(default=_new_shuffle_seed)

    def __str__(self) -> str:
        return f"Playback({self.room_id}, item={self.current_item_id}, playing={self.is_playing})"
