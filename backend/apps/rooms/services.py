"""Queue / playback operations for a room (room-of-one, Phase A — no WebSockets).

Two layers, mirroring Spotify (see docs/design/queue-rooms.md):

- **context** — the list you're playing *from*. `play()` replaces it; it shrinks
  as you listen (consumed items are deleted) and is preserved when you only add
  to the queue.
- **user queue** — explicit "Add to queue" / "Play next" tracks. They play before
  the context resumes and survive a context change.

Play order (and therefore `advance`) is: user queue first, then context.
"""

from __future__ import annotations

import random

from django.db import transaction
from django.db.models import Max, Min

from .models import PlaybackState, QueueItem, Room

CONTEXT = QueueItem.Kind.CONTEXT
QUEUE = QueueItem.Kind.QUEUE


def get_active_room(user) -> Room:
    """The user's single active room (created on first use), with playback state."""
    room, _ = Room.objects.get_or_create(host=user, is_active=True)
    PlaybackState.objects.get_or_create(room=room)
    return room


def _set_current(playback: PlaybackState, track, *, label: str | None = None) -> None:
    playback.current_track = track
    playback.position_ms = 0
    playback.is_playing = track is not None
    if label is not None:
        playback.context_label = label
    playback.save(
        update_fields=["current_track", "position_ms", "is_playing", "context_label", "updated_at"]
    )


@transaction.atomic
def play(room: Room, tracks, *, start: int = 0, added_by=None, label: str = "") -> None:
    """Start a new context at `tracks[start]`, with the rest as up-next context.

    Replaces the current context (the user queue is preserved, Spotify-style).
    No-op if `tracks` is empty or `start` is out of range.
    """
    if not tracks or start >= len(tracks):
        return
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    room.items.filter(kind=CONTEXT).delete()
    QueueItem.objects.bulk_create(
        [
            QueueItem(room=room, track=t, kind=CONTEXT, position=i, added_by=added_by)
            for i, t in enumerate(tracks[start + 1 :])
        ]
    )
    _set_current(playback, tracks[start], label=label)


@transaction.atomic
def enqueue(room: Room, track, *, added_by=None, play_next: bool = False) -> QueueItem:
    """Add a track to the user queue. `play_next` puts it at the head (plays
    before everything else queued); otherwise it appends. If nothing is playing,
    playback kicks off from the queue."""
    qs = room.items.filter(kind=QUEUE)
    if play_next:
        position = (qs.aggregate(m=Min("position"))["m"] or 0) - 1
    else:
        position = (qs.aggregate(m=Max("position"))["m"] or -1) + 1
    item = QueueItem.objects.create(
        room=room, track=track, kind=QUEUE, position=position, added_by=added_by
    )
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    if playback.current_track_id is None:
        advance(room)
    return item


@transaction.atomic
def enqueue_many(room: Room, tracks, *, added_by=None) -> int:
    """Append several tracks to the user queue (Add all)."""
    count = 0
    for track in tracks:
        enqueue(room, track, added_by=added_by)
        count += 1
    return count


@transaction.atomic
def advance(room: Room):
    """Move the now-playing head to the next track: user queue first, then
    context. The consumed item is removed (it leaves 'up next')."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    nxt = (
        room.items.filter(kind=QUEUE).order_by("position").first()
        or room.items.filter(kind=CONTEXT).order_by("position").first()
    )
    if nxt is None:
        _set_current(playback, None)
        return None
    track = nxt.track
    nxt.delete()
    _set_current(playback, track)
    return track


@transaction.atomic
def jump(room: Room, item_id):
    """Play an up-next item now (clicking it in the queue). Everything ordered
    before it — queue first, then context — is skipped (removed)."""
    target = room.items.filter(id=item_id).first()
    if target is None:
        return None
    if target.kind == QUEUE:
        room.items.filter(kind=QUEUE, position__lt=target.position).delete()
    else:
        # Jumping into the context skips the rest of the user queue + earlier context.
        room.items.filter(kind=QUEUE).delete()
        room.items.filter(kind=CONTEXT, position__lt=target.position).delete()
    track = target.track
    target.delete()
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    _set_current(playback, track)
    return track


@transaction.atomic
def remove(room: Room, item_id) -> bool:
    """Remove a single up-next item (does not touch now-playing)."""
    return bool(room.items.filter(id=item_id).delete()[0])


@transaction.atomic
def shuffle(room: Room) -> None:
    """Randomize the order of the remaining context (the user queue keeps its
    explicit order). Re-call to reshuffle."""
    ctx = list(room.items.filter(kind=CONTEXT))
    positions = [c.position for c in ctx]
    random.shuffle(positions)
    for item, pos in zip(ctx, positions, strict=True):
        item.position = pos
    QueueItem.objects.bulk_update(ctx, ["position"])


@transaction.atomic
def clear(room: Room) -> None:
    """Empty both layers and stop playback."""
    PlaybackState.objects.filter(room=room).update(
        current_track=None, is_playing=False, position_ms=0, context_label=""
    )
    room.items.all().delete()


@transaction.atomic
def play_playlist(room: Room, playlist, *, added_by=None) -> None:
    """Play an owned playlist as the context, from the top."""
    tracks = [pt.track for pt in playlist.items.select_related("track").order_by("position")]
    play(room, tracks, start=0, added_by=added_by, label=playlist.title)


def upcoming(room: Room) -> dict:
    """Ordered up-next, split by layer (for serialization)."""
    items = list(room.items.select_related("track").all())
    queue = sorted((i for i in items if i.kind == QUEUE), key=lambda i: i.position)
    context = sorted((i for i in items if i.kind == CONTEXT), key=lambda i: i.position)
    return {"queue": queue, "context": context}


@transaction.atomic
def save_as_playlist(room: Room, user, title: str):
    """Save what's lined up (now-playing + queue + remaining context) as an owned
    playlist, in play order, de-duplicated."""
    from apps.catalog.models import Playlist, PlaylistTrack

    playback = PlaybackState.objects.filter(room=room).first()
    up = upcoming(room)
    ordered_tracks = []
    if playback and playback.current_track_id:
        ordered_tracks.append(playback.current_track)
    ordered_tracks += [i.track for i in up["queue"]] + [i.track for i in up["context"]]

    playlist = Playlist.objects.create(title=title or "Saved queue", created_by=user)
    position = 0
    for track in ordered_tracks:
        _, created = PlaylistTrack.objects.get_or_create(
            playlist=playlist, track=track, defaults={"position": position, "added_by": user}
        )
        if created:
            position += 1
    return playlist
