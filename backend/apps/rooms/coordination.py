"""Eventually-consistent synced-start coordination for jams.

The server stays the clock authority, but audio now lives in each desktop node's
*local* cache — so the server can no longer tell from its own cache whether a node
is ready to play a freshly-chosen track. Instead:

  1. Choosing a track in a shared room parks it (``pending_start``) with a bounded
     ``start_deadline`` and schedules a deadline timer.
  2. Each node resolves/buffers the track locally and reports ``ready`` over its
     room socket (``RoomConsumer``).
  3. We start the track the moment every *present* node is ready — or when the
     deadline passes, whichever comes first.

That gives the property the jam needs: a slow node is *waited for*, but a crashed
or disconnected one can't stall the others (the deadline always fires, and a node
that vanishes stops counting toward "everyone is ready"). A node that wasn't ready
in time — or rejoins later — simply seeks to the server clock on its next frame, so
the jam converges without any node being authoritative. Eventually consistent.

State is process-local on purpose: the deploy runs a single ASGI process
(``WEB_CONCURRENCY=1``) with the in-memory channel layer, so a module-level dict
guarded by a lock is shared across every consumer and the deadline timers. Presence
is time-expiring (``PRESENCE_TTL``) so a node that dies without a clean disconnect
ages out on its own rather than blocking the early-start check forever.

The DB row (``PlaybackState``) remains the source of truth for *what* is pending and
*which* generation — this module only decides *when* to flip it to playing, and the
flip itself is a single atomic UPDATE (so concurrent triggers — a ready report, a
deadline timer, a disconnect re-check — can race harmlessly; exactly one wins).
"""

from __future__ import annotations

import threading
import time

from django.db.models import F
from django.utils import timezone

# How long the server will wait for every present node before starting anyway. The
# common case starts sooner (as soon as the slowest present node reports ready); this
# is purely the cap that keeps a stuck/dead node from holding the jam.
GRACE_SECONDS = 20.0
# A node stays "present" this long after we last heard from it (connect / ready /
# ping / heartbeat). Longer than GRACE so the deadline is the primary cap and
# presence-expiry is the backstop for a node that crashed without disconnecting.
PRESENCE_TTL = 45.0

_lock = threading.Lock()
# room_id -> {user_id: last_seen (monotonic seconds)}
_present: dict[str, dict[str, float]] = {}
# room_id -> {"gen": int, "users": set[user_id]}
_ready: dict[str, dict] = {}


def _mono() -> float:
    return time.monotonic()


# --- presence ----------------------------------------------------------------


def mark_present(room_id, user_id) -> None:
    """A node connected (or we just heard from it) — (re)start its presence clock."""
    room_id, user_id = str(room_id), str(user_id)
    with _lock:
        _present.setdefault(room_id, {})[user_id] = _mono()


# Heard-from = still present; same operation, named for intent at call sites.
touch = mark_present


def mark_absent(room_id, user_id) -> None:
    """A node disconnected cleanly — drop it from presence immediately."""
    room_id, user_id = str(room_id), str(user_id)
    with _lock:
        users = _present.get(room_id)
        if users is not None:
            users.pop(user_id, None)
            if not users:
                _present.pop(room_id, None)


def _present_users(room_id: str) -> set[str]:
    """Fresh (non-expired) present user ids, pruning anything past PRESENCE_TTL.
    Called under no lock by callers that already hold none — acquire here."""
    cutoff = _mono() - PRESENCE_TTL
    with _lock:
        users = _present.get(room_id)
        if not users:
            return set()
        stale = [u for u, seen in users.items() if seen < cutoff]
        for u in stale:
            del users[u]
        if not users:
            _present.pop(room_id, None)
        return set(users)


# --- readiness + the start flip ----------------------------------------------


def _flip_to_playing(room_id: str, *, generation: int | None = None, overdue: bool = False) -> bool:
    """Atomically start a pending shared room and broadcast it. Returns whether it
    flipped. The filter makes concurrent triggers safe — exactly one UPDATE matches:

    - ``generation`` set  → early start: only if still parked on that generation (a
      newer track change would have bumped it, so a stale all-ready check no-ops).
    - ``overdue`` set     → deadline path: only if start_deadline has passed (a newer
      track reset the deadline into the future, so a stale timer no-ops).
    """
    from . import broadcast, snapshot
    from .models import PlaybackState

    now = timezone.now()
    qs = PlaybackState.objects.filter(room_id=room_id, pending_start=True)
    if generation is not None:
        qs = qs.filter(generation=generation)
    if overdue:
        qs = qs.filter(start_deadline__lte=now)
    flipped = qs.update(
        is_playing=True,
        pending_start=False,
        playing_since=now,
        start_deadline=None,
        generation=F("generation") + 1,
    )
    if flipped:
        with _lock:
            _ready.pop(room_id, None)
        broadcast.publish(room_id, snapshot.serialize_room(room_id))
    return bool(flipped)


def _start_if_all_present_ready(room_id: str, generation: int) -> None:
    with _lock:
        slot = _ready.get(room_id)
        ready_users = set(slot["users"]) if slot and slot["gen"] == generation else set()
    present = _present_users(room_id)
    # Start once everyone we can currently see has the audio. `present` includes the
    # reporter, so it's non-empty in the normal path; guard for the empty edge.
    if present and present.issubset(ready_users):
        _flip_to_playing(room_id, generation=generation)


def client_ready(room_id, user_id, generation: int) -> None:
    """A node reported its audio ready for ``generation``. Record it and start the
    track if every present node is now ready. Runs in a worker thread (touches the DB
    + broadcasts), never the event loop. Ignores stale reports (wrong generation, or
    the room isn't waiting)."""
    from .models import PlaybackState

    room_id, user_id = str(room_id), str(user_id)
    pb = PlaybackState.objects.filter(room_id=room_id).values("generation", "pending_start").first()
    if not pb or not pb["pending_start"] or pb["generation"] != generation:
        return
    with _lock:
        slot = _ready.get(room_id)
        if slot is None or slot["gen"] != generation:
            slot = {"gen": generation, "users": set()}
            _ready[room_id] = slot
        slot["users"].add(user_id)
    _start_if_all_present_ready(room_id, generation)


def recheck(room_id) -> None:
    """Re-evaluate the early-start condition without a new ready report — used when a
    node disconnects, since the *remaining* present nodes may now all be ready. Runs
    in a worker thread."""
    from .models import PlaybackState

    room_id = str(room_id)
    pb = PlaybackState.objects.filter(room_id=room_id).values("generation", "pending_start").first()
    if pb and pb["pending_start"]:
        _start_if_all_present_ready(room_id, pb["generation"])


def start_overdue(room_id) -> None:
    """Deadline path: start the room if it's still pending and the deadline passed.
    Idempotent — safe to call from the deadline timer AND from the socket heartbeat
    (the recovery path if a process restart lost the in-memory timer)."""
    _flip_to_playing(str(room_id), overdue=True)


def schedule_deadline(room_id) -> None:
    """Arm the bounded-wait timer for a freshly-parked track. Fires once after
    GRACE_SECONDS; ``start_overdue`` no-ops if the room already started or a newer
    track moved the deadline. Daemon so it never blocks process shutdown."""
    timer = threading.Timer(GRACE_SECONDS, start_overdue, args=(str(room_id),))
    timer.daemon = True
    timer.start()
