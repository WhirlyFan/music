"""Catalog API tests — authed client; scraper + YouTube mocked (no network)."""

import pathlib

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.catalog import match, streaming
from apps.catalog.ingest import applemusic
from apps.catalog.models import Track
from apps.catalog.tests.factories import PlaybackSourceFactory, TrackFactory
from apps.users.tests.factories import UserFactory

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "applemusic_album_clipse.html"
ALBUM_URL = "https://music.apple.com/us/album/p-o-v/1816313639"
INGEST = "/api/v1/catalog/playlists/ingest/"


@pytest.fixture
def client(db):
    user = UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def offline(monkeypatch):
    html = FIXTURE.read_text(encoding="utf-8")
    monkeypatch.setattr(applemusic, "fetch", lambda url: html)


def test_requires_auth(db):
    assert APIClient().get("/api/v1/catalog/playlists/").status_code in (401, 403)


@pytest.mark.django_db
def test_ingest_then_list_and_detail(client, offline):
    r = client.post(INGEST, {"url": ALBUM_URL}, format="json")
    assert r.status_code == 201, r.content
    assert r.data["track_count"] == 13
    assert len(r.data["items"]) == 13
    assert r.data["items"][0]["track"]["title"] == "The Birds Don't Sing"
    assert r.data["items"][0]["track"]["active_source"] is None  # not matched yet

    pid = r.data["id"]
    rl = client.get("/api/v1/catalog/playlists/")
    assert rl.status_code == 200
    assert any(p["id"] == pid for p in rl.data["results"])

    rd = client.get(f"/api/v1/catalog/playlists/{pid}/")
    assert rd.status_code == 200 and rd.data["track_count"] == 13


@pytest.mark.django_db
def test_ingest_rejects_non_apple(client):
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/abc"}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_match_populates_active_source(client, offline, monkeypatch):
    pid = client.post(INGEST, {"url": ALBUM_URL}, format="json").data["id"]
    monkeypatch.setattr(
        match.youtube,
        "search",
        lambda q, n=5: [{"video_id": "VID1", "title": q, "uploader": "y", "duration_sec": 240}],
    )
    rm = client.post(f"/api/v1/catalog/playlists/{pid}/match/")
    assert rm.status_code == 200 and rm.data["matched"] == 13

    rd = client.get(f"/api/v1/catalog/playlists/{pid}/")
    assert rd.data["items"][0]["track"]["active_source"]["locator"] == "VID1"


@pytest.mark.django_db
def test_lazy_match_single_track(client, offline, monkeypatch):
    client.post(INGEST, {"url": ALBUM_URL}, format="json")
    track = Track.objects.first()
    monkeypatch.setattr(
        match.youtube,
        "search",
        lambda q, n=5: [{"video_id": "LAZY1", "title": q, "uploader": "y", "duration_sec": 240}],
    )
    r = client.post(f"/api/v1/catalog/tracks/{track.id}/match/")
    assert r.status_code == 200
    assert r.data["locator"] == "LAZY1"
    # idempotent: second call returns the existing active source, no re-search
    assert client.post(f"/api/v1/catalog/tracks/{track.id}/match/").data["locator"] == "LAZY1"


@pytest.mark.django_db
def test_set_source_correction(client, offline):
    client.post(INGEST, {"url": ALBUM_URL}, format="json")
    track = Track.objects.first()
    r = client.post(
        f"/api/v1/catalog/tracks/{track.id}/set-source/", {"video_id": "MANUAL1"}, format="json"
    )
    assert r.status_code == 200
    assert r.data["locator"] == "MANUAL1"
    assert r.data["origin"] == "matched_manual"
    assert track.playback_sources.filter(status="active").count() == 1


class _FakeUpstream:
    """Stand-in for the googlevideo HTTP response (no network in tests)."""

    status = 206

    def __init__(self):
        self._chunks = [b"AUDIO", b"DATA", b""]
        self.headers = {"Content-Type": "audio/mp4", "Content-Range": "bytes 0-8/9"}

    def read(self, _n):
        return self._chunks.pop(0) if self._chunks else b""

    def close(self):
        pass


@pytest.mark.django_db
def test_stream_404_until_matched(client):
    track = TrackFactory()  # no active source yet
    assert client.get(f"/api/v1/catalog/tracks/{track.id}/stream/").status_code == 404


@pytest.mark.django_db
def test_stream_proxies_audio_with_range(client, monkeypatch):
    track = TrackFactory()
    PlaybackSourceFactory(track=track, locator="dQw4w9WgXcQ")

    monkeypatch.setattr(
        streaming, "resolved_audio", lambda vid: {"url": "https://fake/v", "http_headers": {}}
    )
    monkeypatch.setattr(streaming, "open_upstream", lambda url, headers: _FakeUpstream())

    r = client.get(f"/api/v1/catalog/tracks/{track.id}/stream/", HTTP_RANGE="bytes=0-")
    assert r.status_code == 206
    assert b"".join(r.streaming_content) == b"AUDIODATA"
    assert r["Accept-Ranges"] == "bytes"
    assert r["Content-Range"] == "bytes 0-8/9"
    assert r["Content-Type"] == "audio/mp4"
