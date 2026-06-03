import pytest

from apps.catalog.tests.factories import PlaylistFactory, PlaylistTrackFactory, TrackFactory
from apps.rooms import services
from apps.rooms.models import Room
from apps.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_active_room_is_singleton_per_user():
    user = UserFactory()
    assert services.get_active_room(user).id == services.get_active_room(user).id
    assert Room.objects.filter(host=user, is_active=True).count() == 1


def _order(room):
    return list(room.items.order_by("position").values_list("track_id", flat=True))


@pytest.mark.django_db
def test_play_now_is_a_single_song():
    user = UserFactory()
    room = services.get_active_room(user)
    track = TrackFactory()
    services.play_now(room, track, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == track.id
    assert room.items.count() == 1  # just that song


@pytest.mark.django_db
def test_enqueue_appends_and_starts_when_idle():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b = TrackFactory(), TrackFactory()
    services.enqueue(room, a, added_by=user)  # idle → becomes current
    services.enqueue(room, b, added_by=user)  # appended
    room.refresh_from_db()
    assert room.playback.current_item.track_id == a.id
    assert _order(room) == [a.id, b.id]


@pytest.mark.django_db
def test_play_replaces_queue():
    user = UserFactory()
    room = services.get_active_room(user)
    services.play_now(room, TrackFactory(), added_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    services.play(room, tracks, start=0, added_by=user)
    assert _order(room) == [t.id for t in tracks]  # old item gone


@pytest.mark.django_db
def test_next_then_previous_returns_without_loss():
    user = UserFactory()
    room = services.get_active_room(user)
    tracks = [TrackFactory() for _ in range(3)]
    services.play(room, tracks, start=0, added_by=user)

    assert services.next_track(room).track_id == tracks[1].id
    assert services.previous_track(room).track_id == tracks[0].id
    assert room.items.count() == 3  # nothing deleted walking back and forth


@pytest.mark.django_db
def test_next_at_end_stops_but_keeps_current():
    user = UserFactory()
    room = services.get_active_room(user)
    track = TrackFactory()
    services.play(room, [track], start=0, added_by=user)
    assert services.next_track(room) is None
    room.refresh_from_db()
    assert room.playback.current_item.track_id == track.id  # stays on last
    assert room.playback.is_playing is False


@pytest.mark.django_db
def test_play_playlist_replaces_and_starts_first():
    user = UserFactory()
    room = services.get_active_room(user)
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)

    services.play_playlist(room, playlist, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == tracks[0].id
    assert _order(room) == [t.id for t in tracks]


@pytest.mark.django_db
def test_save_as_playlist_captures_whole_queue():
    user = UserFactory()
    room = services.get_active_room(user)
    services.play(room, [TrackFactory() for _ in range(3)], start=0, added_by=user)
    playlist = services.save_as_playlist(room, user, "My Mix")
    assert playlist.created_by_id == user.id
    assert playlist.items.count() == 3
