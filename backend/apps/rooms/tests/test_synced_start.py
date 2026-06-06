"""Synced start: a shared room waits for the server cache (pending_start) before
everyone plays together; solo rooms start immediately."""

import pytest
from allauth.account.models import EmailAddress

from apps.catalog import streaming
from apps.catalog.tests.factories import PlaybackSourceFactory, TrackFactory
from apps.rooms import services
from apps.rooms.models import PlaybackState
from apps.users.tests.factories import UserFactory


def verified(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    return user


@pytest.fixture(autouse=True)
def no_real_warming(monkeypatch):
    # Never hit the network in these tests.
    monkeypatch.setattr(streaming, "is_cached", lambda vid: False)
    monkeypatch.setattr(streaming, "warm_video", lambda vid: None)


@pytest.mark.django_db
def test_shared_room_gates_uncached_track():
    user = verified(UserFactory())
    room = services.get_active_room(user)
    services.share_room(room)
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator="VID00000001")

    services.play_now(room, track, added_by=user)

    pb = PlaybackState.objects.get(room=room)
    assert pb.pending_start is True
    assert pb.is_playing is False
    assert pb.playing_since is None  # no clock until everyone can start


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


@pytest.mark.django_db
def test_on_audio_ready_starts_pending_room():
    user = verified(UserFactory())
    room = services.get_active_room(user)
    services.share_room(room)
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator="VID00000003")
    services.play_now(room, track, added_by=user)
    assert PlaybackState.objects.get(room=room).pending_start is True

    services.on_audio_ready("VID00000003")

    pb = PlaybackState.objects.get(room=room)
    assert pb.is_playing is True
    assert pb.pending_start is False
    assert pb.playing_since is not None


@pytest.mark.django_db
def test_on_audio_ready_ignores_unrelated_video():
    user = verified(UserFactory())
    room = services.get_active_room(user)
    services.share_room(room)
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator="VID00000004")
    services.play_now(room, track, added_by=user)

    services.on_audio_ready("SOMETHINGELSE")  # different video

    assert PlaybackState.objects.get(room=room).pending_start is True  # still waiting
