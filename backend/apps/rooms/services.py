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

import hashlib
import random
import secrets

from django.db import transaction
from django.db.models import F, Max, Min
from django.utils import timezone

from apps.catalog import streaming
from apps.catalog.models import PlaybackSource

from .models import PlaybackState, QueueItem, Room, RoomMember, _new_shuffle_seed

CONTEXT = QueueItem.Kind.CONTEXT
QUEUE = QueueItem.Kind.QUEUE

# Unambiguous code alphabet — no 0/O/1/I/L/U to keep spoken/typed codes clean.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


def get_active_room(user) -> Room:
    """The user's single active room (created on first use), with playback state."""
    room, _ = Room.objects.get_or_create(host=user, is_active=True)
    PlaybackState.objects.get_or_create(room=room)
    return room


@transaction.atomic
def set_position(room: Room, position_ms: int, is_playing: bool) -> None:
    """Re-anchor the server clock to the host's actual playhead (periodic host
    heartbeat, or after a seek/play/pause). `playing_since` resets to now so every
    guest recomputes the live position from the fresh anchor; None while paused so
    the position holds. This is the server staying honest about where the music
    really is, rather than trusting arithmetic from the last transition forever."""
    PlaybackState.objects.filter(room=room).update(
        position_ms=max(0, position_ms),
        is_playing=is_playing,
        playing_since=timezone.now() if is_playing else None,
        pending_start=False,
    )


def on_audio_ready(video_id: str) -> None:
    """A track's audio finished caching — start any shared room that was waiting
    on it (synced start). Called from the cache-warm worker thread; idempotent
    (only flips rooms still pending). Local imports avoid a snapshot→serializers→
    services import cycle."""
    from . import broadcast, snapshot

    room_ids = (
        PlaybackState.objects.filter(
            pending_start=True,
            room__is_shared=True,
            current_item__track__playback_sources__locator=video_id,
            current_item__track__playback_sources__locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
            current_item__track__playback_sources__status=PlaybackSource.Status.ACTIVE,
        )
        .values_list("room_id", flat=True)
        .distinct()
    )
    for room_id in room_ids:
        updated = PlaybackState.objects.filter(room_id=room_id, pending_start=True).update(
            is_playing=True,
            pending_start=False,
            playing_since=timezone.now(),
            generation=F("generation") + 1,
        )
        if updated:
            broadcast.publish(room_id, snapshot.serialize_room(room_id))


def prewarm_upcoming(room: Room, count: int = 2) -> None:
    """Warm upcoming tracks so advancing the jam starts instantly (no 'Starting…'
    wait). Covers two cases:
      • the next 2 tracks in line — what plays on a normal skip/auto-advance, and
      • the exact track a shuffle would land on — shuffle is server-side and
        seeded, so its result is deterministic; we warm precisely that one.
    Each warm is a background no-op if already cached or in flight."""
    up = upcoming(room)
    candidates = list((up["queue"] + up["context"])[:count])
    shuffle_top = next_shuffle_top(room)
    if shuffle_top is not None:
        candidates.append(shuffle_top)

    seen = set()
    for item in candidates:
        if item.id in seen:
            continue
        seen.add(item.id)
        vid = _video_id(item.track)
        if vid and not streaming.is_cached(vid):
            streaming.warm_video(vid)  # no gate — nothing is waiting on these yet


# --- Jam (sharing / membership) ---------------------------------------------


def _generate_code(length: int = 6) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


def _unique_code() -> str:
    for _ in range(10):
        code = _generate_code()
        if not Room.objects.filter(code=code, is_shared=True).exists():
            return code
    raise RuntimeError("could not allocate a unique jam code")


def is_member(room: Room, user) -> bool:
    """True if `user` may follow `room` — its host, or a recorded member."""
    if room.host_id == user.id:
        return True
    return RoomMember.objects.filter(room=room, user=user).exists()


def member_role(room: Room, user) -> str | None:
    m = RoomMember.objects.filter(room=room, user=user).first()
    return m.role if m else None


@transaction.atomic
def share_room(room: Room) -> Room:
    """Make `room` a Jam: assign a unique join code (if it has none) and record
    the host as a member. Idempotent — re-sharing keeps the existing code."""
    RoomMember.objects.get_or_create(
        room=room, user_id=room.host_id, defaults={"role": RoomMember.Role.HOST}
    )
    if not room.is_shared or not room.code:
        room.code = _unique_code()
        room.is_shared = True
        room.save(update_fields=["code", "is_shared", "updated_at"])
    return room


@transaction.atomic
def unshare_room(room: Room) -> Room:
    """End the Jam: drop all members and clear the code. The host keeps their own
    playback (the room just becomes private again, with no member rows — same as
    a room that was never shared)."""
    room.members.all().delete()
    if room.is_shared or room.code:
        room.is_shared = False
        room.code = ""
        room.save(update_fields=["is_shared", "code", "updated_at"])
    return room


@transaction.atomic
def set_guest_control(room: Room, enabled: bool) -> Room:
    """Host toggle: let guests drive playback (play/pause/seek/skip) in this jam."""
    if room.allow_guest_control != enabled:
        room.allow_guest_control = enabled
        room.save(update_fields=["allow_guest_control", "updated_at"])
    return room


def find_open_jam(code: str) -> Room | None:
    """The active shared room for a join code (case-insensitive), or None."""
    return Room.objects.filter(
        code=code.strip().upper(), is_shared=True, is_active=True
    ).first()


@transaction.atomic
def join_guest(room: Room, user) -> list[Room]:
    """Add `user` to `room` as a guest (no-op for the host). A user is a guest in
    at most one jam at a time — joining leaves any previous guest membership.
    Returns the rooms the user was removed from, so callers can refresh those
    jams' counts (otherwise they'd only catch up on the next heartbeat)."""
    if room.host_id == user.id:
        return []  # the host trivially "joins" their own jam
    left = list(
        Room.objects.filter(members__user=user, members__role=RoomMember.Role.GUEST)
        .exclude(pk=room.pk)
        .distinct()
    )
    RoomMember.objects.filter(user=user, role=RoomMember.Role.GUEST).exclude(room=room).delete()
    _, created = RoomMember.objects.get_or_create(
        room=room, user=user, defaults={"role": RoomMember.Role.GUEST}
    )
    if created:
        # Tell the host someone joined their jam (durable + live). Local import to
        # avoid a rooms↔notifications import cycle.
        from apps.notifications.events import emit
        from apps.notifications.models import Notification

        emit(Notification.Kind.JAM_JOIN, recipient=room.host, actor=user, room_id=str(room.id))
    return left


@transaction.atomic
def leave_room(user) -> Room | None:
    """A guest leaves the jam they're in. Returns the room they left (so the view
    can tell its remaining members), or None if they weren't a guest anywhere.
    A host doesn't "leave" — they end the jam via unshare_room."""
    membership = (
        RoomMember.objects.filter(user=user, role=RoomMember.Role.GUEST)
        .select_related("room")
        .first()
    )
    if membership is None:
        return None
    room = membership.room
    RoomMember.objects.filter(user=user, role=RoomMember.Role.GUEST).delete()
    return room


@transaction.atomic
def kick_member(room: Room, user_id) -> bool:
    """Host removes a guest from the jam. Returns whether anyone was removed.
    The host can't be kicked (no-op)."""
    if str(user_id) == str(room.host_id):
        return False
    deleted, _ = RoomMember.objects.filter(
        room=room, user_id=user_id, role=RoomMember.Role.GUEST
    ).delete()
    return bool(deleted)


def current_room(user) -> Room:
    """The room the user is actively in: the Jam they've joined as a guest (most
    recent, if somehow more than one), else their own active room."""
    guest = (
        RoomMember.objects.filter(
            user=user,
            role=RoomMember.Role.GUEST,
            room__is_active=True,
            room__is_shared=True,
        )
        .select_related("room")
        .order_by("-joined_at")
        .first()
    )
    return guest.room if guest is not None else get_active_room(user)


def _ctx(room: Room):
    return room.items.filter(kind=CONTEXT)


def _queue(room: Room):
    return room.items.filter(kind=QUEUE)


def _video_id(track) -> str | None:
    """The active YouTube video id for a track, or None if it isn't matched yet."""
    src = track.playback_sources.filter(
        status=PlaybackSource.Status.ACTIVE,
        locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
    ).first()
    return src.locator if src else None


def _set_current(playback: PlaybackState, item: QueueItem | None, *, label=None) -> None:
    playback.current_item = item
    playback.position_ms = 0

    # Synced start: in a SHARED room, a freshly-chosen track that isn't cached yet
    # waits (pending_start) while its audio warms the server cache, then everyone
    # starts together from disk. Solo rooms (and already-cached tracks) start now.
    pending = False
    if item is not None and playback.room.is_shared:
        vid = _video_id(item.track)
        if vid and not streaming.is_cached(vid):
            pending = True
            # Spawn the warm AFTER commit, so the cache-ready signal sees the
            # committed pending_start row (no race with this transaction).
            transaction.on_commit(lambda v=vid: streaming.warm_video(v, gate=True))

    playback.is_playing = item is not None and not pending
    playback.pending_start = pending
    # Anchor the server clock at the track's start (None when stopped/pending) so
    # every client computes the live position as position_ms + (now - playing_since).
    playback.playing_since = timezone.now() if playback.is_playing else None
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
            "playing_since",
            "pending_start",
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
        playback.playing_since = timezone.now()
        playback.pending_start = False
        playback.save(
            update_fields=["position_ms", "is_playing", "playing_since", "pending_start", "updated_at"]
        )
        return cur
    _ctx(room).delete()
    row = QueueItem.objects.create(
        room=room, track=track, kind=CONTEXT, position=0, added_by=added_by
    )
    _set_current(playback, row, label="")
    return row


# Cap on the explicit user queue. The context (a played-from playlist) is NOT
# capped — playlists can be arbitrarily long; this only bounds "Add to queue".
QUEUE_CAP = 500


def queue_count(room: Room) -> int:
    return _queue(room).count()


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

    if playback.is_playing or playback.pending_start:
        playback.is_playing = False
        playback.pending_start = False
        playback.playing_since = None
        playback.save(update_fields=["is_playing", "pending_start", "playing_since", "updated_at"])
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
    playback.playing_since = timezone.now() if playback.is_playing else None
    playback.pending_start = False
    playback.save(update_fields=["position_ms", "playing_since", "pending_start", "updated_at"])
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


def _seeded_shuffle(items: list[QueueItem], seed: int):
    """Assign new positions for a Spotify-style shuffle, deterministically from
    `seed`. Items are taken in a stable order (current position) first, so the
    same (seed, context) always yields the same permutation — letting prewarm
    predict exactly what a shuffle will land on. Returns (ordered_items, positions)
    aligned by index; positions[i] is the new position of ordered_items[i]."""
    ordered = sorted(items, key=lambda i: i.position)
    positions = list(range(len(ordered)))
    random.Random(seed).shuffle(positions)
    return ordered, positions


def next_shuffle_top(room: Room) -> QueueItem | None:
    """The context item a shuffle would play next under the room's current seed
    (the track that lands at position 0), or None. Pure — no writes — so prewarm
    can warm exactly that track."""
    playback = getattr(room, "playback", None)
    items = list(_ctx(room))
    if playback is None or not items:
        return None
    ordered, positions = _seeded_shuffle(items, playback.next_shuffle_seed)
    return next(it for it, p in zip(ordered, positions, strict=True) if p == 0)


def shuffle(room: Room) -> None:
    """Shuffle the whole context (incl. the current track), Spotify-style, and play
    from the top of the newly-shuffled order. The user queue is untouched. Uses the
    room's seeded permutation (the one prewarm already warmed), then rotates the
    seed so the next shuffle differs."""
    playback, _ = PlaybackState.objects.get_or_create(room=room)
    items = list(_ctx(room))
    if not items:
        return
    ordered, positions = _seeded_shuffle(items, playback.next_shuffle_seed)
    for item, pos in zip(ordered, positions, strict=True):
        item.position = pos
    QueueItem.objects.bulk_update(ordered, ["position"])
    top = next(it for it, p in zip(ordered, positions, strict=True) if p == 0)
    playback.next_shuffle_seed = _new_shuffle_seed()
    playback.save(update_fields=["next_shuffle_seed"])
    _set_current(playback, top)  # play from the top of the shuffle


@transaction.atomic
def clear(room: Room) -> None:
    """Empty both layers and stop playback."""
    PlaybackState.objects.filter(room=room).update(
        current_item=None,
        is_playing=False,
        position_ms=0,
        context_pos=None,
        context_label="",
        playing_since=None,
        pending_start=False,
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


def context_count(room: Room) -> int:
    """Total CONTEXT rows (the whole playing-from list), from prefetched items."""
    return sum(1 for i in room.items.all() if i.kind == CONTEXT)


def context_ahead(room: Room) -> int:
    """How many CONTEXT items are still ahead of the pointer (drives the client's
    Next-button enable + upcoming count). Exact even when positions have gaps
    (e.g. after a remove), unlike deriving it from count − pos."""
    playback = getattr(room, "playback", None)
    pos = playback.context_pos if (playback and playback.context_pos is not None) else -1
    return sum(1 for i in room.items.all() if i.kind == CONTEXT and i.position > pos)


def context_version(room: Room) -> str:
    """A short token that changes iff the CONTEXT list's membership/order changes
    (play, play_now, play_playlist, shuffle, remove, clear) — but NOT on
    play/pause/seek/skip (those touch only PlaybackState). Lets a jam guest refetch
    the full context list only when it actually changed."""
    pairs = sorted((str(i.id), i.position) for i in room.items.all() if i.kind == CONTEXT)
    return hashlib.md5(repr(pairs).encode()).hexdigest()[:12]  # noqa: S324 — not a security digest


@transaction.atomic
def save_as_playlist(room: Room, user, title: str, track_ids: list | None = None):
    """Save what's lined up (now-playing + queue + remaining context) as an owned
    playlist, in play order, de-duplicated.

    `track_ids` is a client snapshot of the lined-up tracks, captured when the Save
    dialog opened — used verbatim (in order) so a track ending/advancing while the
    dialog is open doesn't change what gets saved. Without it, we read live state."""
    from apps.catalog.models import Playlist, PlaylistTrack, Track

    if track_ids:
        by_id = Track.objects.in_bulk(track_ids)
        tracks = [by_id[tid] for tid in track_ids if tid in by_id]  # keep order, drop unknown
    else:
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
