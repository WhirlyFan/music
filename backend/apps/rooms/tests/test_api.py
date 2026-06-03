"""Rooms/queue API tests (authed) — single ordered queue + cursor."""

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


def test_requires_auth(db):
    assert APIClient().get("/api/v1/rooms/me/").status_code in (401, 403)


@pytest.mark.django_db
def test_me_returns_empty_room(client):
    api, _ = client
    r = api.get("/api/v1/rooms/me/")
    assert r.status_code == 200
    assert r.data["current"] is None
    assert r.data["queue"] == []
    assert r.data["history"] == []
    assert r.data["is_playing"] is False


@pytest.mark.django_db
def test_play_now_plays_just_that_song(client):
    api, _ = client
    # A track that lives in a list — clicking it must NOT enqueue the rest.
    tracks = [TrackFactory() for _ in range(4)]
    r = api.post("/api/v1/rooms/play-now/", {"track_id": str(tracks[2].id)}, format="json")
    assert r.status_code == 200
    assert r.data["current"]["id"] == str(tracks[2].id)
    assert r.data["queue"] == []  # nothing else queued
    assert r.data["is_playing"] is True


@pytest.mark.django_db
def test_play_now_inserts_after_current_keeping_upnext(client):
    api, _ = client
    a, b, c = TrackFactory(), TrackFactory(), TrackFactory()
    api.post("/api/v1/rooms/play-now/", {"track_id": str(a.id)}, format="json")
    api.post("/api/v1/rooms/queue/", {"track_ids": [str(b.id)]}, format="json")  # up next: b
    # Click c: plays now, b stays up-next.
    r = api.post("/api/v1/rooms/play-now/", {"track_id": str(c.id)}, format="json")
    assert r.data["current"]["id"] == str(c.id)
    assert [q["track"]["id"] for q in r.data["queue"]] == [str(b.id)]
    assert [h["track"]["id"] for h in r.data["history"]] == [str(a.id)]


@pytest.mark.django_db
def test_play_replaces_queue(client):
    api, _ = client
    old = TrackFactory()
    api.post("/api/v1/rooms/play-now/", {"track_id": str(old.id)}, format="json")
    tracks = [TrackFactory() for _ in range(3)]
    r = api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    assert r.data["current"]["id"] == str(tracks[0].id)
    assert [q["track"]["id"] for q in r.data["queue"]] == [str(tracks[1].id), str(tracks[2].id)]
    assert r.data["history"] == []  # old queue gone


@pytest.mark.django_db
def test_next_and_previous_walk_the_cursor(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(3)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")

    r = api.post("/api/v1/rooms/next/", format="json")
    assert r.data["current"]["id"] == str(tracks[1].id)
    assert [h["track"]["id"] for h in r.data["history"]] == [str(tracks[0].id)]

    r = api.post("/api/v1/rooms/previous/", format="json")
    assert r.data["current"]["id"] == str(tracks[0].id)
    assert r.data["history"] == []
    assert len(r.data["queue"]) == 2  # nothing lost going back


@pytest.mark.django_db
def test_jump_and_remove(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(3)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    up = api.get("/api/v1/rooms/me/").data["queue"]

    r = api.post("/api/v1/rooms/jump/", {"item_id": up[1]["id"]}, format="json")
    assert r.data["current"]["id"] == str(tracks[2].id)

    item_id = api.get("/api/v1/rooms/me/").data["history"][0]["id"]
    r = api.post("/api/v1/rooms/remove/", {"item_id": item_id}, format="json")
    assert item_id not in [h["id"] for h in r.data["history"]]


@pytest.mark.django_db
def test_shuffle_keeps_upnext_set(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(5)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(tracks), "start_index": 0}, format="json")
    before = {q["track"]["id"] for q in api.get("/api/v1/rooms/me/").data["queue"]}
    r = api.post("/api/v1/rooms/shuffle/", format="json")
    assert {q["track"]["id"] for q in r.data["queue"]} == before
    assert len(r.data["queue"]) == 4


@pytest.mark.django_db
def test_play_playlist_then_save_as_playlist(client):
    api, user = client
    playlist = PlaylistFactory(created_by=user)
    for i in range(3):
        PlaylistTrackFactory(playlist=playlist, track=TrackFactory(), position=i)

    r = api.post("/api/v1/rooms/play-playlist/", {"playlist_id": str(playlist.id)}, format="json")
    assert r.status_code == 200
    assert r.data["current"] is not None
    assert len(r.data["queue"]) == 2  # first plays, two up-next

    saved = api.post("/api/v1/rooms/save-as-playlist/", {"title": "Saved"}, format="json")
    assert saved.status_code == 200
    assert saved.data["track_count"] == 3  # whole queue saved
