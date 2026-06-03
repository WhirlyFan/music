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
INGEST = "/api/v1/catalog/ingest/"


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
def test_ingest_returns_loose_tracks(client, offline):
    # Pasting a URL yields loose tracks — no playlist is created (decoupled).
    r = client.post(INGEST, {"url": ALBUM_URL}, format="json")
    assert r.status_code == 201, r.content
    assert r.data["track_count"] == 13
    assert len(r.data["tracks"]) == 13
    assert r.data["tracks"][0]["title"] == "The Birds Don't Sing"
    assert r.data["tracks"][0]["active_source"] is None  # not matched yet (lazy on play)
    assert r.data["id"]  # the import id

    # No playlist materialized by the paste.
    rl = client.get("/api/v1/catalog/playlists/")
    assert rl.status_code == 200 and rl.data["results"] == []


@pytest.mark.django_db
def test_ingest_rejects_unsupported_source(client):
    r = client.post(INGEST, {"url": "https://example.com/playlist/abc"}, format="json")
    assert r.status_code == 400
    assert "apple music" in r.data["detail"].lower()


@pytest.mark.django_db
def test_ingest_spotify_not_configured(client):
    # No SPOTIFY_CLIENT_ID/SECRET in tests → clear error, no network call.
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/abc"}, format="json")
    assert r.status_code == 400
    assert "configured" in r.data["detail"].lower()


@pytest.mark.django_db
def test_ingest_spotify(client, monkeypatch):
    from apps.catalog.ingest import spotify

    meta = {
        "title": "Sp Mix",
        "external_id": "sp1",
        "kind": "playlist",
        "tracks": [{"title": "X", "artist": "Y", "duration": 210000, "isrc": "US1234567890"}],
    }
    monkeypatch.setattr(spotify, "ingest_with_meta", lambda url: meta)
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/sp1"}, format="json")
    assert r.status_code == 201
    assert r.data["track_count"] == 1
    assert r.data["tracks"][0]["active_source"] is None  # matched to YouTube lazily on play
    assert Track.objects.get(title="X").isrc == "US1234567890"  # ISRC stored


@pytest.mark.django_db
def test_ingest_youtube_sets_direct_playback_source(client, monkeypatch):
    from apps.catalog.ingest import youtube

    meta = {
        "title": "YT Playlist",
        "external_id": "PL1",
        "kind": "playlist",
        "tracks": [
            {"video_id": "abc11111111", "title": "Song A", "artist": "Chan", "duration": 200000},
            {"video_id": "def22222222", "title": "Song B", "artist": "Chan", "duration": 180000},
        ],
    }
    monkeypatch.setattr(youtube, "ingest_with_meta", lambda url: meta)
    r = client.post(INGEST, {"url": "https://www.youtube.com/playlist?list=PL1"}, format="json")
    assert r.status_code == 201
    assert r.data["track_count"] == 2
    # YouTube tracks are immediately playable — active source already set, no lazy match.
    src = r.data["tracks"][0]["active_source"]
    assert src["locator"] == "abc11111111" and src["locator_kind"] == "video_id"


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


@pytest.mark.django_db
def test_create_playlist_from_tracks(client):
    tracks = [TrackFactory() for _ in range(3)]
    r = client.post(
        "/api/v1/catalog/playlists/",
        {"title": "My Mix", "track_ids": [str(t.id) for t in tracks]},
        format="json",
    )
    assert r.status_code == 201
    assert r.data["title"] == "My Mix"
    assert r.data["track_count"] == 3
