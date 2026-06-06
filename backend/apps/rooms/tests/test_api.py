"""Rooms/queue API tests (authed) — Spotify-style context + user queue."""

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.catalog.tests.factories import PlaylistFactory, PlaylistTrackFactory, TrackFactory
from apps.users.tests.factories import UserFactory


@pytest.fixture
def client(db):
    user = UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def ids(tracks):
    return [str(t.id) for t in tracks]


def ctx_ids(api):
    """Full context (the played-from list) as track ids, in order — now fetched
    from the paginated /rooms/context/ endpoint rather than inlined in the snapshot.
    Follows pagination so it works past one page."""
    out = []
    url = "/api/v1/rooms/context/"
    while url:
        r = api.get(url)
        out += [c["track"]["id"] for c in r.data["results"]]
        nxt = r.data["next"]
        url = nxt[nxt.index("/api/") :] if nxt else None
    return out


def queue_ids(data):
    return [q["track"]["id"] for q in data["queue"]]


def test_requires_auth(db):
    assert APIClient().get("/api/v1/rooms/me/").status_code in (401, 403)


@pytest.mark.django_db
def test_me_returns_empty_room(client):
    api, _ = client
    r = api.get("/api/v1/rooms/me/")
    assert r.status_code == 200
    assert r.data["current"] is None
    assert r.data["queue"] == [] and r.data["context_count"] == 0


@pytest.mark.django_db
def test_play_now_is_one_song_not_the_list(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(4)]
    r = api.post("/api/v1/rooms/play-now/", {"track_id": str(tracks[2].id)}, format="json")
    assert r.data["current"]["id"] == str(tracks[2].id)
    # Context is just that one song (not the 4-track list it came from); no queue.
    assert ctx_ids(api) == [str(tracks[2].id)]
    assert r.data["queue"] == []


@pytest.mark.django_db
def test_play_loads_context_with_label(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(4)]
    r = api.post(
        "/api/v1/rooms/play/",
        {"track_ids": ids(tracks), "start_index": 0, "label": "My Album"},
        format="json",
    )
    assert r.data["current"]["id"] == str(tracks[0].id)
    assert r.data["context_label"] == "My Album"
    # context is the FULL playlist (stable list); current is the first track.
    assert ctx_ids(api) == ids(tracks)
    assert r.data["current_item_id"] == r.data["context_window"][0]["id"]


@pytest.mark.django_db
def test_clicking_context_song_moves_position_without_losing_skipped(client):
    api, _ = client
    c = [TrackFactory() for _ in range(5)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(c), "start_index": 0}, format="json")
    target = api.get("/api/v1/rooms/context/").data["results"][3]  # c[3] (full list)
    assert target["track"]["id"] == str(c[3].id)

    r = api.post("/api/v1/rooms/jump/", {"item_id": target["id"]}, format="json")
    assert r.data["current"]["id"] == str(c[3].id)
    # The full playlist stays visible; only the position (highlight) moved.
    assert ctx_ids(api) == ids(c)
    assert r.data["current_item_id"] == target["id"]

    # The skipped tracks aren't lost — Previous walks back through them.
    r = api.post("/api/v1/rooms/previous/", format="json")
    assert r.data["current"]["id"] == str(c[2].id)
    r = api.post("/api/v1/rooms/previous/", format="json")
    assert r.data["current"]["id"] == str(c[1].id)


@pytest.mark.django_db
def test_queue_plays_before_context_then_resumes(client):
    api, _ = client
    c = [TrackFactory() for _ in range(3)]
    extra = TrackFactory()
    api.post("/api/v1/rooms/play/", {"track_ids": ids(c), "start_index": 0}, format="json")
    r = api.post("/api/v1/rooms/queue/", {"track_ids": [str(extra.id)]}, format="json")
    assert queue_ids(r.data) == [str(extra.id)]
    assert ctx_ids(api) == ids(c)  # full playlist stays visible

    r = api.post("/api/v1/rooms/next/", format="json")  # queue first
    assert r.data["current"]["id"] == str(extra.id)
    assert r.data["queue"] == []
    r = api.post("/api/v1/rooms/next/", format="json")  # then resume context
    assert r.data["current"]["id"] == str(c[1].id)


@pytest.mark.django_db
def test_queue_survives_context_change(client):
    api, _ = client
    first = [TrackFactory() for _ in range(2)]
    queued = TrackFactory()
    second = [TrackFactory() for _ in range(2)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(first), "start_index": 0}, format="json")
    api.post("/api/v1/rooms/queue/", {"track_ids": [str(queued.id)]}, format="json")

    r = api.post("/api/v1/rooms/play/", {"track_ids": ids(second), "start_index": 0}, format="json")
    assert r.data["current"]["id"] == str(second[0].id)
    assert queue_ids(r.data) == [str(queued.id)]  # preserved


@pytest.mark.django_db
def test_jump_into_queue_consumes_those_above(client):
    api, _ = client
    api.post("/api/v1/rooms/play-now/", {"track_id": str(TrackFactory().id)}, format="json")
    q = [TrackFactory() for _ in range(3)]
    api.post("/api/v1/rooms/queue/", {"track_ids": ids(q)}, format="json")
    second = api.get("/api/v1/rooms/me/").data["queue"][1]  # q[1]

    r = api.post("/api/v1/rooms/jump/", {"item_id": second["id"]}, format="json")
    assert r.data["current"]["id"] == str(q[1].id)
    assert queue_ids(r.data) == [str(q[2].id)]  # q[0] consumed, q[2] remains


@pytest.mark.django_db
def test_play_playlist_then_save_as_playlist(client):
    api, user = client
    playlist = PlaylistFactory(created_by=user)
    for i in range(3):
        PlaylistTrackFactory(playlist=playlist, track=TrackFactory(), position=i)

    r = api.post("/api/v1/rooms/play-playlist/", {"playlist_id": str(playlist.id)}, format="json")
    assert r.data["current"] is not None
    assert r.data["context_count"] == 3  # full playlist visible

    saved = api.post("/api/v1/rooms/save-as-playlist/", {"title": "Saved"}, format="json")
    assert saved.data["track_count"] == 3


@pytest.mark.django_db
def test_snapshot_windows_context_not_full_list(client):
    # A big context must NOT inline all its tracks in the snapshot — only a small
    # window + count. The full list comes from the paginated /rooms/context/ endpoint.
    api, _ = client
    tracks = [TrackFactory() for _ in range(60)]
    r = api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    assert "context" not in r.data  # the full array is gone
    assert r.data["context_count"] == 60
    assert len(r.data["context_window"]) == 20  # current + lookahead only
    assert r.data["context_window"][0]["track"]["id"] == str(tracks[0].id)


@pytest.mark.django_db
def test_context_endpoint_paginates(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(60)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    p1 = api.get("/api/v1/rooms/context/")
    assert p1.data["count"] == 60
    assert len(p1.data["results"]) == 50 and p1.data["next"]
    assert ctx_ids(api) == ids(tracks)  # following pagination reassembles the full list, in order


@pytest.mark.django_db
def test_context_version_changes_only_when_list_changes(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(5)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    v0 = api.get("/api/v1/rooms/me/").data["context_version"]

    # Playback-only ops (skip) don't change the context list → version stable.
    api.post("/api/v1/rooms/next/", format="json")
    assert api.get("/api/v1/rooms/me/").data["context_version"] == v0

    # Shuffle rewrites positions → version changes.
    api.post("/api/v1/rooms/shuffle/", format="json")
    assert api.get("/api/v1/rooms/me/").data["context_version"] != v0
