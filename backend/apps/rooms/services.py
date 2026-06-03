"""Queue / playback operations for a room (room-of-one, Phase A — no WebSockets).

The play verbs from docs/design/queue-rooms.md: add / play-next / play-now,
play-playlist, save-queue-as-playlist, advance, clear.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import F, Max

from .models import PlaybackState, QueueItem, Room

ADD = "add"
PLAY_NEXT = "play_next"
PLAY_NOW = "play_now"


def get_active_room(user) -> Room:
    """The user's single active room (created on first use), with playback state."""
    room, _ = Room.objects.get_or_create(host=user, is_active=True)
    PlaybackState.objects.get_or_create(room=room)
    return room


def _next_position(room: Room) -> int:
    highest = room.items.aggregate(m=Max("position"))["m"]
    return 0 if highest is None else highest + 1


@transaction.atomic
def enqueue(room: Room, track, *, added_by=None, mode: str = ADD) -> QueueItem:
    """Add a track to the room's queue.

    - ADD: append. PLAY_NEXT: insert right after the current item.
    - PLAY_NOW: append and make it the now-playing head.
    """
    playback, _ = PlaybackState.objects.get_or_create(room=room)

    if mode == PLAY_NEXT and playback.current_item_id:
        after = playback.current_item.position
        room.items.filter(position__gt=after).update(position=F("position") + 1)
        item = QueueItem.objects.create(
            room=room, track=track, position=after + 1, added_by=added_by
        )
    else:
        item = QueueItem.objects.create(
            room=room, track=track, position=_next_position(room), added_by=added_by
        )

    if mode == PLAY_NOW:
        _set_current(playback, item)
    return item


def _set_current(playback: PlaybackState, item: QueueItem | None) -> None:
    playback.current_item = item
    playback.position_ms = 0
    playback.is_playing = item is not None
    playback.save(update_fields=["current_item", "position_ms", "is_playing", "updated_at"])


@transaction.atomic
def clear_queue(room: Room) -> None:
    PlaybackState.objects.filter(room=room).update(
        current_item=None, is_playing=False, position_ms=0
    )
    room.items.all().delete()


@transaction.atomic
def play_tracks(room: Room, tracks, *, added_by=None, replace: bool = True) -> int:
    """Enqueue a batch of tracks (in order). If replace, reset the queue and
    start at the first track (Play); otherwise append (Add to queue)."""
    if replace:
        clear_queue(room)
    first = None
    count = 0
    for track in tracks:
        item = QueueItem.objects.create(
            room=room, track=track, position=_next_position(room), added_by=added_by
        )
        first = first or item
        count += 1
    if replace and first:
        playback, _ = PlaybackState.objects.get_or_create(room=room)
        _set_current(playback, first)
    return count


def play_playlist(room: Room, playlist, *, added_by=None, replace: bool = True) -> int:
    """Load a playlist's tracks into the queue (see `play_tracks`)."""
    tracks = [pt.track for pt in playlist.items.select_related("track").order_by("position")]
    return play_tracks(room, tracks, added_by=added_by, replace=replace)


@transaction.atomic
def advance(room: Room) -> QueueItem | None:
    """Move the now-playing head to the next item by position."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    after = playback.current_item.position if playback.current_item_id else -1
    nxt = room.items.filter(position__gt=after).order_by("position").first()
    _set_current(playback, nxt)
    return nxt


@transaction.atomic
def save_queue_as_playlist(room: Room, user, title: str):
    """Create an owned Playlist from the current queue (dedups repeats)."""
    from apps.catalog.models import Playlist, PlaylistTrack

    playlist = Playlist.objects.create(title=title or "Saved queue", created_by=user)
    position = 0
    for item in room.items.select_related("track").order_by("position"):
        _, created = PlaylistTrack.objects.get_or_create(
            playlist=playlist,
            track=item.track,
            defaults={"position": position, "added_by": user},
        )
        if created:
            position += 1
    return playlist
