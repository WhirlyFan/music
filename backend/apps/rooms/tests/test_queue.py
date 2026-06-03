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


@pytest.mark.django_db
def test_enqueue_add_appends_in_order():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b = TrackFactory(), TrackFactory()
    services.enqueue(room, a, added_by=user)
    services.enqueue(room, b, added_by=user)
    assert list(room.items.order_by("position").values_list("track_id", flat=True)) == [a.id, b.id]


@pytest.mark.django_db
def test_play_now_sets_now_playing():
    user = UserFactory()
    room = services.get_active_room(user)
    item = services.enqueue(room, TrackFactory(), added_by=user, mode=services.PLAY_NOW)
    room.refresh_from_db()
    assert room.playback.current_item_id == item.id
    assert room.playback.is_playing is True


@pytest.mark.django_db
def test_play_next_inserts_after_current():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b, c = TrackFactory(), TrackFactory(), TrackFactory()
    services.enqueue(room, a, mode=services.PLAY_NOW)  # current, pos 0
    services.enqueue(room, b, mode=services.ADD)  # pos 1
    services.enqueue(room, c, mode=services.PLAY_NEXT)  # after current → pos 1, b → 2
    assert list(room.items.order_by("position").values_list("track_id", flat=True)) == [
        a.id,
        c.id,
        b.id,
    ]


@pytest.mark.django_db
def test_play_playlist_replaces_and_starts_first():
    user = UserFactory()
    room = services.get_active_room(user)
    services.enqueue(room, TrackFactory(), mode=services.ADD)  # pre-existing
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)

    assert services.play_playlist(room, playlist, added_by=user, replace=True) == 3
    assert room.items.count() == 3
    room.refresh_from_db()
    assert room.playback.current_item.track_id == tracks[0].id


@pytest.mark.django_db
def test_save_queue_as_playlist():
    user = UserFactory()
    room = services.get_active_room(user)
    for _ in range(3):
        services.enqueue(room, TrackFactory(), added_by=user)
    playlist = services.save_queue_as_playlist(room, user, "My Mix")
    assert playlist.created_by_id == user.id
    assert playlist.items.count() == 3
