"""Eventually-consistent synced start: a shared room parks a freshly-chosen track
(pending_start) until every PRESENT node reports its audio ready — or a bounded
deadline passes — then everyone starts together. A node that never reports (crashed
/ disconnected) can't stall the jam. Solo rooms start immediately.

See apps.rooms.coordination. State there is process-local, so we clear it between
tests; the flip itself is exercised through the public coordination entrypoints
(client_ready / recheck / start_overdue) the consumer calls.
"""

from datetime import timedelta

import pytest
from allauth.account.models import EmailAddress
from django.utils import timezone

from apps.catalog.tests.factories import PlaybackSourceFactory, TrackFactory
from apps.rooms import coordination, services
from apps.rooms.models import PlaybackState
from apps.users.tests.factories import UserFactory


def verified(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    return user


@pytest.fixture(autouse=True)
def _clear_coordination():
    """Presence/readiness are process-local — isolate each test."""
    coordination._present.clear()
    coordination._ready.clear()
    yield
    coordination._present.clear()
    coordination._ready.clear()


def _shared_room_with_track(locator):
    user = verified(UserFactory())
    room = services.get_active_room(user)
    services.share_room(room)
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator=locator)
    services.play_now(room, track, added_by=user)
    return user, room


@pytest.mark.django_db
def test_shared_room_parks_track_with_deadline():
    _user, room = _shared_room_with_track("VID00000001")
    pb = PlaybackState.objects.get(room=room)
    assert pb.pending_start is True
    assert pb.is_playing is False
    assert pb.playing_since is None  # no clock until everyone can start
    assert pb.start_deadline is not None  # bounded wait armed


@pytest.mark.django_db
def test_solo_room_starts_immediately():
    user = verified(UserFactory())
    room = services.get_active_room(user)  # not shared
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator="VID00000002")

    services.play_now(room, track, added_by=user)

    pb = PlaybackState.objects.get(room=room)
    assert pb.is_playing is True
    assert pb.pending_start is False
    assert pb.start_deadline is None


@pytest.mark.django_db
def test_starts_once_every_present_node_is_ready():
    user, room = _shared_room_with_track("VID00000003")
    gen = PlaybackState.objects.get(room=room).generation

    coordination.mark_present(room.id, user.id)
    coordination.client_ready(room.id, user.id, gen)

    pb = PlaybackState.objects.get(room=room)
    assert pb.is_playing is True
    assert pb.pending_start is False
    assert pb.playing_since is not None
    assert pb.generation == gen + 1  # the start bumped the generation


@pytest.mark.django_db
def test_waits_while_a_present_node_has_not_reported():
    a, room = _shared_room_with_track("VID00000004")
    b = UserFactory()
    gen = PlaybackState.objects.get(room=room).generation

    coordination.mark_present(room.id, a.id)
    coordination.mark_present(room.id, b.id)
    coordination.client_ready(room.id, a.id, gen)  # only A is ready

    assert PlaybackState.objects.get(room=room).pending_start is True  # still waiting on B


@pytest.mark.django_db
def test_node_leaving_starts_the_remaining_ready_nodes():
    a, room = _shared_room_with_track("VID00000005")
    b = UserFactory()
    gen = PlaybackState.objects.get(room=room).generation

    coordination.mark_present(room.id, a.id)
    coordination.mark_present(room.id, b.id)
    coordination.client_ready(room.id, a.id, gen)
    assert PlaybackState.objects.get(room=room).pending_start is True

    # B disconnects before reporting → the remaining present node (A) is all-ready.
    coordination.mark_absent(room.id, b.id)
    coordination.recheck(room.id)

    assert PlaybackState.objects.get(room=room).is_playing is True


@pytest.mark.django_db
def test_deadline_starts_even_if_a_node_never_reports():
    user, room = _shared_room_with_track("VID00000006")
    coordination.mark_present(room.id, user.id)  # present but never reports ready
    # Force the deadline into the past (the timer would otherwise fire after GRACE).
    PlaybackState.objects.filter(room=room).update(
        start_deadline=timezone.now() - timedelta(seconds=1)
    )

    coordination.start_overdue(room.id)

    pb = PlaybackState.objects.get(room=room)
    assert pb.is_playing is True
    assert pb.pending_start is False


@pytest.mark.django_db
def test_overdue_does_not_start_before_the_deadline():
    _user, room = _shared_room_with_track("VID00000007")
    # Deadline is in the future (just armed) → a stray timer must NOT start it.
    coordination.start_overdue(room.id)
    assert PlaybackState.objects.get(room=room).pending_start is True


@pytest.mark.django_db
def test_stale_generation_ready_is_ignored():
    user, room = _shared_room_with_track("VID00000008")
    coordination.mark_present(room.id, user.id)

    coordination.client_ready(room.id, user.id, 999)  # not the current generation

    assert PlaybackState.objects.get(room=room).pending_start is True
