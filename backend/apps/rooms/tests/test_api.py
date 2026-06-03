"""Rooms/queue API tests (authed)."""

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


def test_requires_auth(db):
    assert APIClient().get("/api/v1/rooms/me/").status_code in (401, 403)


@pytest.mark.django_db
def test_me_returns_empty_room(client):
    api, _ = client
    r = api.get("/api/v1/rooms/me/")
    assert r.status_code == 200
    assert r.data["items"] == []
    assert r.data["current_item"] is None
    assert r.data["is_playing"] is False


@pytest.mark.django_db
def test_enqueue_play_now_sets_now_playing(client):
    api, _ = client
    track = TrackFactory()
    r = api.post(
        "/api/v1/rooms/enqueue/",
        {"track_id": str(track.id), "mode": "play_now"},
        format="json",
    )
    assert r.status_code == 200
    assert len(r.data["items"]) == 1
    assert r.data["current_item"] == str(r.data["items"][0]["id"])
    assert r.data["is_playing"] is True


@pytest.mark.django_db
def test_play_playlist_then_save_as_playlist(client):
    api, user = client
    playlist = PlaylistFactory(created_by=user)
    for i in range(3):
        PlaylistTrackFactory(playlist=playlist, track=TrackFactory(), position=i)

    r = api.post("/api/v1/rooms/play-playlist/", {"playlist_id": str(playlist.id)}, format="json")
    assert r.status_code == 200
    assert len(r.data["items"]) == 3

    saved = api.post("/api/v1/rooms/save-as-playlist/", {"title": "Saved"}, format="json")
    assert saved.status_code == 200
    assert saved.data["track_count"] == 3
