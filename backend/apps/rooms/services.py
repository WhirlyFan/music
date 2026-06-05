"""Queue / playback operations for a room (room-of-one, Phase A — no WebSockets).

Spotify's two-layer model (see docs/design/queue-rooms.md):

- **context** — the list you play *from*. A STABLE list (CONTEXT items) + a
  pointer `context_pos`. It is NOT consumed: Next/Previous and clicking just move
  the pointer, so skipped tracks remain in the list (Previous walks back) and are
  never shown as "played". `play()` replaces it; the user queue is preserved.
- **user queue** — explicit "Add to queue" (QUEUE items). Ephemeral: plays before
  the context resumes, deleted once consumed, survives a context change.

Play order: user queue first, then the context resumes after `context_pos`.
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


def _ctx(room: Room):
    return room.items.filter(kind=CONTEXT)


def _queue(room: Room):
    return room.items.filter(kind=QUEUE)


def _set_current(playback: PlaybackState, item: QueueItem | None, *, label=None) -> None:
    playback.current_item = item
    playback.position_ms = 0
    playback.is_playing = item is not None
    if item is not None and item.kind == CONTEXT:
        playback.context_pos = item.position  # advancing through the context moves the pointer
    if label is not None:
        playback.context_label = label
    playback.save(
        update_fields=[
            "current_item",
            "context_pos",
            "context_label",
            "position_ms",
            "is_playing",
            "updated_at",
        ]
    )


@transaction.atomic
def play(room: Room, tracks, *, start: int = 0, added_by=None, label: str = "") -> None:
    """Start a new context at `tracks[start]` (Play playlist / Play all). Replaces
    the context; the user queue is preserved. No-op on empty / out-of-range."""
    if not tracks or start >= len(tracks):
        return
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    _ctx(room).delete()
    rows = QueueItem.objects.bulk_create(
        [
            QueueItem(room=room, track=t, kind=CONTEXT, position=i, added_by=added_by)
            for i, t in enumerate(tracks)
        ]
    )
    _set_current(playback, rows[start], label=label)


@transaction.atomic
def play_now(room: Room, track, *, added_by=None) -> QueueItem:
    """Play one song now (clicking a single track): the context becomes just that
    song. The user queue is preserved.

    Idempotent on the current track — clicking Play on the song that's already
    playing just restarts it, never a duplicate (Spotify behaves the same). The
    `select_for_update` lock serializes rapid repeat clicks so concurrent requests
    can't race into duplicate context rows (each would otherwise delete the
    visible context and insert its own)."""
    PlaybackState.objects.get_or_create(room=room)
    playback = PlaybackState.objects.select_for_update().get(room=room)
    cur = playback.current_item
    if cur is not None and cur.track_id == track.id:
        playback.position_ms = 0
        playback.is_playing = True
        playback.save(update_fields=["position_ms", "is_playing", "updated_at"])
        return cur
    _ctx(room).delete()
    row = QueueItem.objects.create(
        room=room, track=track, kind=CONTEXT, position=0, added_by=added_by
    )
    _set_current(playback, row, label="")
    return row


@transaction.atomic
def enqueue(room: Room, track, *, added_by=None, play_next: bool = False) -> QueueItem:
    """Add a track to the user queue (appended, or `play_next` at the head). Starts
    playback if idle."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    q = _queue(room)
    if play_next:
        lo = q.aggregate(m=Min("position"))["m"]
        position = lo - 1 if lo is not None else 0
    else:
        hi = q.aggregate(m=Max("position"))["m"]
        position = hi + 1 if hi is not None else 0
    item = QueueItem.objects.create(
        room=room, track=track, kind=QUEUE, position=position, added_by=added_by
    )
    if playback.current_item_id is None:
        next_track(room)
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
    """Advance: user queue first, then resume the context after `context_pos`.
    A consumed queue item is deleted; the context is never deleted."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    if cur is not None and cur.kind == QUEUE:
        cur.delete()  # consume the queued track we were on

    nxt_queue = _queue(room).order_by("position").first()
    if nxt_queue is not None:
        _set_current(playback, nxt_queue)  # context_pos preserved
        return nxt_queue.track

    base = playback.context_pos if playback.context_pos is not None else -1
    nxt_ctx = _ctx(room).filter(position__gt=base).order_by("position").first()
    if nxt_ctx is not None:
        _set_current(playback, nxt_ctx)
        return nxt_ctx.track

    if playback.is_playing:
        playback.is_playing = False
        playback.save(update_fields=["is_playing", "updated_at"])
    return None


@transaction.atomic
def previous_track(room: Room):
    """Walk back through the context (the user queue is consumed, so Previous can't
    return to queued tracks — same as Spotify). At the start, restart current."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    cur = playback.current_item
    if cur is None:
        return None
    pos = playback.context_pos
    if cur.kind == QUEUE:
        # Back out of the queued track to the context track we were on.
        ctx_here = (
            _ctx(room).filter(position__lte=pos).order_by("-position").first()
            if pos is not None
            else None
        )
        if ctx_here is not None:
            _set_current(playback, ctx_here)
            return ctx_here.track
        return None
    prev_ctx = (
        _ctx(room).filter(position__lt=pos).order_by("-position").first()
        if pos is not None
        else None
    )
    if prev_ctx is not None:
        _set_current(playback, prev_ctx)
        return prev_ctx.track
    # at the start of the context — restart the current track
    playback.position_ms = 0
    playback.save(update_fields=["position_ms", "updated_at"])
    return cur.track


@transaction.atomic
def jump(room: Room, item_id):
    """Click a row to play it. CONTEXT row → move the pointer there (skipped
    tracks stay in the list). QUEUE row → play it, consuming the queued tracks
    above it."""
    item = room.items.filter(id=item_id).first()
    if item is None:
        return None
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    if item.kind == QUEUE:
        _queue(room).filter(position__lt=item.position).delete()
    _set_current(playback, item)
    return item


@transaction.atomic
def remove(room: Room, item_id) -> bool:
    """Remove one item (from either layer). If it was current, advance."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    item = room.items.filter(id=item_id).first()
    if item is None:
        return False
    was_current = playback.current_item_id == item.id
    item.delete()
    if was_current:
        next_track(room)
    return True


@transaction.atomic
@transaction.atomic
def shuffle(room: Room) -> None:
    """Shuffle the whole context (incl. the current track), Spotify-style, and play
    from the top of the newly-shuffled order. The user queue is untouched."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    items = list(_ctx(room))
    if not items:
        return
    positions = list(range(len(items)))
    random.shuffle(positions)
    for item, pos in zip(items, positions, strict=True):
        item.position = pos
    QueueItem.objects.bulk_update(items, ["position"])
    top = next(i for i in items if i.position == 0)
    _set_current(playback, top)  # play from the top of the shuffle


@transaction.atomic
def clear(room: Room) -> None:
    """Empty both layers and stop playback."""
    PlaybackState.objects.filter(room=room).update(
        current_item=None, is_playing=False, position_ms=0, context_pos=None, context_label=""
    )
    room.items.all().delete()


@transaction.atomic
def play_playlist(room: Room, playlist, *, start_track_id=None, added_by=None) -> None:
    """Play an owned playlist as the context. Starts at `start_track_id` if given
    (clicking a row plays from there), else from the top."""
    tracks = [pt.track for pt in playlist.items.select_related("track").order_by("position")]
    start = 0
    if start_track_id is not None:
        start = next((i for i, t in enumerate(tracks) if str(t.id) == str(start_track_id)), 0)
    play(room, tracks, start=start, added_by=added_by, label=playlist.title)


def upcoming(room: Room) -> dict:
    """The two up-next layers (for serialization): explicit queue, then the
    context remaining after `context_pos`. Excludes the now-playing item."""
    playback = getattr(room, "playback", None)
    cur_id = playback.current_item_id if playback else None
    pos = playback.context_pos if (playback and playback.context_pos is not None) else -1
    items = list(room.items.all())  # prefetched
    queue = sorted(
        (i for i in items if i.kind == QUEUE and i.id != cur_id), key=lambda i: i.position
    )
    context = sorted(
        (i for i in items if i.kind == CONTEXT and i.position > pos), key=lambda i: i.position
    )
    return {"queue": queue, "context": context}


@transaction.atomic
def save_as_playlist(room: Room, user, title: str):
    """Save what's lined up (now-playing + queue + remaining context) as an owned
    playlist, in play order, de-duplicated."""
    from apps.catalog.models import Playlist, PlaylistTrack

    playback = PlaybackState.objects.filter(room=room).first()
    up = upcoming(room)
    tracks = []
    if playback and playback.current_item_id and playback.current_item:
        tracks.append(playback.current_item.track)
    tracks += [i.track for i in up["queue"]] + [i.track for i in up["context"]]

    playlist = Playlist.objects.create(title=title or "Saved queue", created_by=user)
    position = 0
    for track in tracks:
        _, created = PlaylistTrack.objects.get_or_create(
            playlist=playlist, track=track, defaults={"position": position, "added_by": user}
        )
        if created:
            position += 1
    return playlist
