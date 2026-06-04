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


def _ctx(room):
    return room.items.filter(kind=QueueItem.Kind.CONTEXT).order_by("position")


@pytest.mark.django_db
def test_play_now_is_a_single_song_context():
    user = UserFactory()
    room = services.get_active_room(user)
    track = TrackFactory()
    services.play_now(room, track, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == track.id
    assert _ctx(room).count() == 1


@pytest.mark.django_db
def test_context_is_not_consumed_on_advance():
    user = UserFactory()
    room = services.get_active_room(user)
    c = [TrackFactory() for _ in range(3)]
    services.play(room, c, start=0, added_by=user)
    services.next_track(room)  # c0 -> c1
    services.next_track(room)  # c1 -> c2
    # All three context rows still exist (stable list, pointer moved).
    assert _ctx(room).count() == 3
    room.refresh_from_db()
    assert room.playback.current_item.track_id == c[2].id


@pytest.mark.django_db
def test_previous_walks_context_back():
    user = UserFactory()
    room = services.get_active_room(user)
    c = [TrackFactory() for _ in range(3)]
    services.play(room, c, start=0, added_by=user)
    services.next_track(room)
    services.next_track(room)  # at c2
    assert services.previous_track(room).id == c[1].id
    assert services.previous_track(room).id == c[0].id


@pytest.mark.django_db
def test_queue_before_context_then_resumes_and_survives_change():
    user = UserFactory()
    room = services.get_active_room(user)
    c = [TrackFactory() for _ in range(2)]
    queued = TrackFactory()
    services.play(room, c, start=0, added_by=user)  # current c0
    services.enqueue(room, queued, added_by=user)

    assert services.next_track(room).id == queued.id  # queue first
    assert services.next_track(room).id == c[1].id  # then context resumes

    # New context preserves any remaining user queue.
    services.enqueue(room, TrackFactory(), added_by=user)
    services.play(room, [TrackFactory(), TrackFactory()], start=0, added_by=user)
    assert room.items.filter(kind=QueueItem.Kind.QUEUE).count() == 1


@pytest.mark.django_db
def test_jump_to_context_moves_pointer_keeps_list():
    user = UserFactory()
    room = services.get_active_room(user)
    c = [TrackFactory() for _ in range(5)]
    services.play(room, c, start=0, added_by=user)
    target = _ctx(room).get(position=3)
    services.jump(room, target.id)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == c[3].id
    assert _ctx(room).count() == 5  # nothing deleted
    assert services.previous_track(room).id == c[2].id  # skipped tracks reachable


@pytest.mark.django_db
def test_play_playlist_and_save():
    user = UserFactory()
    room = services.get_active_room(user)
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)

    services.play_playlist(room, playlist, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == tracks[0].id
    assert room.playback.context_label == playlist.title

    saved = services.save_as_playlist(room, user, "Mix")
    assert saved.items.count() == 3


@pytest.mark.django_db
def test_play_playlist_starts_at_given_track():
    # Clicking a row plays the whole playlist but starts at that track.
    user = UserFactory()
    room = services.get_active_room(user)
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(3)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)

    services.play_playlist(room, playlist, start_track_id=tracks[2].id, added_by=user)
    room.refresh_from_db()
    assert room.playback.current_item.track_id == tracks[2].id
    assert room.items.count() == 3  # full playlist is the context


@pytest.mark.django_db
def test_play_now_is_idempotent_on_current_track():
    # Spam-playing the same song must not pile up duplicate context rows.
    user = UserFactory()
    room = services.get_active_room(user)
    track = TrackFactory()
    first = services.play_now(room, track, added_by=user)
    again = services.play_now(room, track, added_by=user)
    services.play_now(room, track, added_by=user)

    assert again.id == first.id  # same row, not a new one
    assert room.items.filter(kind=QueueItem.Kind.CONTEXT).count() == 1
    room.refresh_from_db()
    assert room.playback.current_item.track_id == track.id


@pytest.mark.django_db
def test_play_now_different_track_replaces_context():
    user = UserFactory()
    room = services.get_active_room(user)
    a, b = TrackFactory(), TrackFactory()
    services.play_now(room, a, added_by=user)
    services.play_now(room, b, added_by=user)
    ctx = room.items.filter(kind=QueueItem.Kind.CONTEXT)
    assert ctx.count() == 1 and ctx.first().track_id == b.id


@pytest.mark.django_db
def test_shuffle_includes_current_and_keeps_it_playing():
    user = UserFactory()
    room = services.get_active_room(user)
    playlist = PlaylistFactory(created_by=user)
    tracks = [TrackFactory() for _ in range(6)]
    for i, t in enumerate(tracks):
        PlaylistTrackFactory(playlist=playlist, track=t, position=i)
    services.play_playlist(room, playlist, start_track_id=tracks[2].id, added_by=user)

    room.refresh_from_db()
    cur_item = room.playback.current_item_id
    cur_track = room.playback.current_item.track_id

    services.shuffle(room)
    room.refresh_from_db()

    # Same row still current + same song still playing.
    assert room.playback.current_item_id == cur_item
    assert room.playback.current_item.track_id == cur_track
    # The pointer follows the current track to its new position.
    assert room.playback.context_pos == room.playback.current_item.position
    # All 6 context tracks remain, positions stay a contiguous 0..5 permutation.
    assert sorted(i.position for i in _ctx(room)) == [0, 1, 2, 3, 4, 5]
