"""Queue / playback operations for a room (room-of-one, Phase A — no WebSockets).

A **single ordered queue + a current pointer** (the model most players use, e.g.
Feishin). Items aren't deleted as they play: those behind `current_item` are the
history (Previous walks back), those ahead are up-next. `position` orders the
whole list.

Verbs: play (replace), play_now (one song at the cursor), enqueue (add / play
next), next/previous, jump, remove, shuffle, clear, save-as-playlist.
"""

from __future__ import annotations

import random

from django.db import transaction
from django.db.models import F, Max

from .models import PlaybackState, QueueItem, Room


def get_active_room(user) -> Room:
    """The user's single active room (created on first use), with playback state."""
    room, _ = Room.objects.get_or_create(host=user, is_active=True)
    PlaybackState.objects.get_or_create(room=room)
    return room


def _set_current(playback: PlaybackState, item: QueueItem | None) -> None:
    playback.current_item = item
    playback.position_ms = 0
    playback.is_playing = item is not None
    playback.save(update_fields=["current_item", "position_ms", "is_playing", "updated_at"])


def _max_position(room: Room) -> int:
    return room.items.aggregate(m=Max("position"))["m"] or 0


@transaction.atomic
def play(room: Room, tracks, *, start: int = 0, added_by=None) -> None:
    """Replace the queue with `tracks` and play from `start` (Play playlist /
    Play all). No-op on empty input or out-of-range start."""
    if not tracks or start >= len(tracks):
        return
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    room.items.all().delete()
    items = QueueItem.objects.bulk_create(
        [QueueItem(room=room, track=t, position=i, added_by=added_by) for i, t in enumerate(tracks)]
    )
    _set_current(playback, items[start])


@transaction.atomic
def play_now(room: Room, track, *, added_by=None) -> QueueItem:
    """Play a single track now (clicking a song): insert it right after the
    current item and make it current. Existing up-next is preserved after it."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    if cur is None:
        position = _max_position(room) + 1 if room.items.exists() else 0
    else:
        position = cur.position + 1
        room.items.filter(position__gte=position).update(position=F("position") + 1)
    item = QueueItem.objects.create(room=room, track=track, position=position, added_by=added_by)
    _set_current(playback, item)
    return item


@transaction.atomic
def enqueue(room: Room, track, *, added_by=None, play_next: bool = False) -> QueueItem:
    """Add a track to the queue: appended, or (play_next) right after current.
    Starts playback if the queue was idle."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    if play_next and cur is not None:
        position = cur.position + 1
        room.items.filter(position__gte=position).update(position=F("position") + 1)
    else:
        position = _max_position(room) + 1 if room.items.exists() else 0
    item = QueueItem.objects.create(room=room, track=track, position=position, added_by=added_by)
    if playback.current_item_id is None:
        _set_current(playback, item)
    return item


@transaction.atomic
def enqueue_many(room: Room, tracks, *, added_by=None) -> int:
    count = 0
    for track in tracks:
        enqueue(room, track, added_by=added_by)
        count += 1
    return count


@transaction.atomic
def next_track(room: Room):
    """Advance the cursor to the next item. At the end, stop (keep current)."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    qs = room.items.order_by("position")
    nxt = qs.filter(position__gt=cur.position).first() if cur else qs.first()
    if nxt is not None:
        _set_current(playback, nxt)
    elif playback.is_playing:
        playback.is_playing = False
        playback.save(update_fields=["is_playing", "updated_at"])
    return nxt


@transaction.atomic
def previous_track(room: Room):
    """Move the cursor back to the previously played item (history)."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    if cur is None:
        return None
    prv = room.items.filter(position__lt=cur.position).order_by("-position").first()
    if prv is not None:
        _set_current(playback, prv)
    return prv


@transaction.atomic
def jump(room: Room, item_id):
    """Play a specific queue item now (click any row, history or up-next)."""
    item = room.items.filter(id=item_id).first()
    if item is not None:
        playback, _ = PlaybackState.objects.get_or_create(room=room)
        _set_current(playback, item)
    return item


@transaction.atomic
def remove(room: Room, item_id) -> bool:
    """Remove one queue item. If it was current, move to the next (else prev)."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    item = room.items.filter(id=item_id).first()
    if item is None:
        return False
    if playback.current_item_id == item.id:
        nxt = (
            room.items.filter(position__gt=item.position).order_by("position").first()
            or room.items.filter(position__lt=item.position).order_by("-position").first()
        )
        item.delete()
        _set_current(playback, nxt)
    else:
        item.delete()
    return True


@transaction.atomic
def shuffle(room: Room) -> None:
    """Randomize the order of the up-next items (everything after current).
    History + now-playing are untouched. Re-call to reshuffle."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    base = playback.current_item.position if playback.current_item_id else -1
    upcoming = list(room.items.filter(position__gt=base))
    positions = [i.position for i in upcoming]
    random.shuffle(positions)
    for item, pos in zip(upcoming, positions, strict=True):
        item.position = pos
    QueueItem.objects.bulk_update(upcoming, ["position"])


@transaction.atomic
def clear(room: Room) -> None:
    """Empty the queue and stop playback."""
    PlaybackState.objects.filter(room=room).update(
        current_item=None, is_playing=False, position_ms=0
    )
    room.items.all().delete()


@transaction.atomic
def play_playlist(room: Room, playlist, *, added_by=None) -> None:
    """Replace the queue with an owned playlist and play from the top."""
    tracks = [pt.track for pt in playlist.items.select_related("track").order_by("position")]
    play(room, tracks, start=0, added_by=added_by)


@transaction.atomic
def save_as_playlist(room: Room, user, title: str):
    """Save the whole queue (in order, de-duplicated) as an owned playlist."""
    from apps.catalog.models import Playlist, PlaylistTrack

    playlist = Playlist.objects.create(title=title or "Saved queue", created_by=user)
    position = 0
    for item in room.items.select_related("track").order_by("position"):
        _, created = PlaylistTrack.objects.get_or_create(
            playlist=playlist, track=item.track, defaults={"position": position, "added_by": user}
        )
        if created:
            position += 1
    return playlist
