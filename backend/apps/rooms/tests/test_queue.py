import pytest

from apps.catalog.tests.factories import PlaylistFactory, PlaylistTrackFactory, TrackFactory
from apps.rooms import services
from apps.rooms.models import QueueItem, Room
from apps.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_active_room_is_singleton_per_user():
    user = UserFactory()
    assert services.get_active_room(user).id == services.get_active_room(user).id
    assert Room.objects.filter(host=user, is_active=True).count() == 1


def _queue_track_ids(room):
    items = [i for i in room.items.all() if i.kind == QueueItem.Kind.QUEUE]
    return [i.track_id for i in sorted(items, key=lambda i: i.position)]


@pytest.mark.django_db
def test_enqueue_add_appends_in_order():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b, c = TrackFactory(), TrackFactory(), TrackFactory()
    services.play(room, [a], added_by=user)  # something playing so adds stay queued
    services.enqueue(room, b, added_by=user)
    services.enqueue(room, c, added_by=user)
    assert _queue_track_ids(room) == [b.id, c.id]


@pytest.mark.django_db
def test_play_sets_current_track():
    user = UserFactory()
    room = services.get_active_room(user)
    track = TrackFactory()
    services.play(room, [track], added_by=user)
    room.refresh_from_db()
    assert room.playback.current_track_id == track.id
    assert room.playback.is_playing is True


@pytest.mark.django_db
def test_play_next_jumps_the_head_of_the_queue():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b, c = TrackFactory(), TrackFactory(), TrackFactory()
    services.play(room, [a], added_by=user)  # a is current
    services.enqueue(room, b, added_by=user)  # queue: [b]
    services.enqueue(room, c, added_by=user, play_next=True)  # queue: [c, b]
    assert _queue_track_ids(room) == [c.id, b.id]


@pytest.mark.django_db
def test_play_playlist_starts_first_and_lines_up_rest():
    user = UserFactory()
    room = services.get_active_room(user)
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)

    services.play_playlist(room, playlist, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_track_id == tracks[0].id
    context = [i for i in room.items.all() if i.kind == QueueItem.Kind.CONTEXT]
    assert len(context) == 2  # the two tracks after the first


@pytest.mark.django_db
def test_advance_drains_queue_then_context():
    user = UserFactory()
    room = services.get_active_room(user)
    ctx = [TrackFactory() for _ in range(2)]
    queued = TrackFactory()
    services.play(room, ctx, added_by=user)  # current=ctx0, context=[ctx1]
    services.enqueue(room, queued, added_by=user)  # queue=[queued]

    assert services.advance(room).id == queued.id  # queue first
    assert services.advance(room).id == ctx[1].id  # then context
    assert services.advance(room) is None  # exhausted
    room.refresh_from_db()
    assert room.playback.current_track is None
    assert room.playback.is_playing is False


@pytest.mark.django_db
def test_save_as_playlist_captures_current_queue_and_context():
    user = UserFactory()
    room = services.get_active_room(user)
    ctx = [TrackFactory() for _ in range(2)]
    services.play(room, ctx, added_by=user)  # current + 1 context
    services.enqueue(room, TrackFactory(), added_by=user)  # +1 queue
    playlist = services.save_as_playlist(room, user, "My Mix")
    assert playlist.created_by_id == user.id
    assert playlist.items.count() == 3  # current + queue + context
