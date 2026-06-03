"""Rooms/queue API tests (authed) — two-layer context + user queue."""

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
    assert r.data["context"] == []
    assert r.data["is_playing"] is False


@pytest.mark.django_db
def test_play_sets_current_and_context_tail(client):
    api, _ = client
    tracks = [TrackFactory() for _ in range(4)]
    # Click Play on the 3rd track of the list: it plays, the rest is up-next.
    r = api.post(
        "/api/v1/rooms/play/",
        {"track_ids": ids(tracks), "start_index": 2, "label": "My Album"},
        format="json",
    )
    assert r.status_code == 200
    assert r.data["current"]["id"] == str(tracks[2].id)
    assert r.data["is_playing"] is True
    assert r.data["context_label"] == "My Album"
    # Up-next context is only what follows the clicked track (not 0/1).
    assert [c["track"]["id"] for c in r.data["context"]] == [str(tracks[3].id)]
    assert r.data["queue"] == []


@pytest.mark.django_db
def test_queue_plays_before_context_and_survives(client):
    api, _ = client
    ctx = [TrackFactory() for _ in range(3)]
    extra = TrackFactory()
    api.post("/api/v1/rooms/play/", {"track_ids": ids(ctx), "start_index": 0}, format="json")

    # Add to queue — it lines up before the context resumes.
    r = api.post("/api/v1/rooms/queue/", {"track_ids": [str(extra.id)]}, format="json")
    assert [q["track"]["id"] for q in r.data["queue"]] == [str(extra.id)]
    assert [c["track"]["id"] for c in r.data["context"]] == [str(ctx[1].id), str(ctx[2].id)]

    # Advance: the queued track plays next (before the context), then is gone.
    r = api.post("/api/v1/rooms/advance/", format="json")
    assert r.data["current"]["id"] == str(extra.id)
    assert r.data["queue"] == []
    # Advance again: now we resume the context.
    r = api.post("/api/v1/rooms/advance/", format="json")
    assert r.data["current"]["id"] == str(ctx[1].id)


@pytest.mark.django_db
def test_queue_when_idle_starts_playback(client):
    api, _ = client
    track = TrackFactory()
    r = api.post("/api/v1/rooms/queue/", {"track_ids": [str(track.id)]}, format="json")
    # Nothing was playing → the queued track becomes current.
    assert r.data["current"]["id"] == str(track.id)
    assert r.data["is_playing"] is True


@pytest.mark.django_db
def test_play_preserves_user_queue(client):
    api, _ = client
    first = [TrackFactory() for _ in range(2)]
    queued = TrackFactory()
    second = [TrackFactory() for _ in range(2)]
    api.post("/api/v1/rooms/play/", {"track_ids": ids(first), "start_index": 0}, format="json")
    api.post("/api/v1/rooms/queue/", {"track_ids": [str(queued.id)]}, format="json")

    # Switching context keeps the explicitly-queued track (Spotify behavior).
    r = api.post("/api/v1/rooms/play/", {"track_ids": ids(second), "start_index": 0}, format="json")
    assert r.data["current"]["id"] == str(second[0].id)
    assert [q["track"]["id"] for q in r.data["queue"]] == [str(queued.id)]


@pytest.mark.django_db
def test_play_playlist_then_save_as_playlist(client):
    api, user = client
    playlist = PlaylistFactory(created_by=user)
    for i in range(3):
        PlaylistTrackFactory(playlist=playlist, track=TrackFactory(), position=i)

    r = api.post("/api/v1/rooms/play-playlist/", {"playlist_id": str(playlist.id)}, format="json")
    assert r.status_code == 200
    # current (track 0) + 2 remaining context tracks.
    assert r.data["current"] is not None
    assert len(r.data["context"]) == 2

    saved = api.post("/api/v1/rooms/save-as-playlist/", {"title": "Saved"}, format="json")
    assert saved.status_code == 200
    assert saved.data["track_count"] == 3  # current + 2 context
