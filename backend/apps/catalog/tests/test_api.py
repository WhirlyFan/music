"""Catalog API tests — authed client; scraper + YouTube mocked (no network)."""

import pathlib

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.catalog import match, streaming
from apps.catalog.ingest import applemusic
from apps.catalog.models import PlaybackSource, Playlist, Track
from apps.catalog.tests.factories import (
    PlaybackSourceFactory,
    PlaylistFactory,
    TrackFactory,
)
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

    # Display metadata is normalized from the source: album tracks share the cover
    # + album name; songs carry their explicit badge and 30s preview clip.
    assert "mzstatic" in r.data["tracks"][0]["artwork_url"]
    assert r.data["tracks"][0]["album_name"] == "Let God Sort Em Out"
    assert any(t["preview_url"] for t in r.data["tracks"])
    assert any(t["is_explicit"] for t in r.data["tracks"])

    # No playlist materialized by the paste.
    rl = client.get("/api/v1/catalog/playlists/")
    assert rl.status_code == 200 and rl.data["results"] == []


@pytest.mark.django_db
def test_ingest_rejects_unsupported_source(client):
    r = client.post(INGEST, {"url": "https://example.com/playlist/abc"}, format="json")
    assert r.status_code == 400
    assert "apple music" in r.data["detail"].lower()


@pytest.mark.django_db
def test_ingest_spotify_unreadable(client, monkeypatch):
    # No creds (API skipped) + scrape can't read it → friendly 400, no real network.
    from apps.catalog.ingest import spotify

    monkeypatch.setattr(spotify, "_scrape", lambda kind, sid: None)
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/abc"}, format="json")
    assert r.status_code == 400
    assert "couldn't read" in r.data["detail"].lower()


@pytest.mark.django_db
def test_ingest_spotify_api_first_full_list(client, monkeypatch):
    # Creds set → API returns the full list (no cap, no note).
    from apps.catalog.ingest import spotify

    monkeypatch.setattr(spotify, "_configured", lambda: True)
    monkeypatch.setattr(
        spotify,
        "_api_with_meta",
        lambda kind, sid: {
            "title": "User PL",
            "external_id": sid,
            "kind": "playlist",
            "tracks": [{"title": "X", "artist": "Y", "duration": 1000, "isrc": "US000"}],
        },
    )
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/userpl"}, format="json")
    assert r.status_code == 201
    assert r.data["track_count"] == 1
    assert not r.data.get("note")  # full list → no advisory


@pytest.mark.django_db
def test_ingest_spotify_editorial_falls_back_to_capped_scrape(client, monkeypatch):
    # Editorial playlist (or no creds): API refused → keyless scrape returns 50 + a note.
    from apps.catalog.ingest import spotify

    fifty = [{"title": f"T{i}", "artist": "A", "duration": 200000, "isrc": ""} for i in range(50)]
    monkeypatch.setattr(spotify, "_configured", lambda: False)
    monkeypatch.setattr(
        spotify,
        "_scrape",
        lambda kind, sid: {
            "title": "Top 50",
            "external_id": sid,
            "kind": "playlist",
            "tracks": fifty,
        },
    )
    r = client.post(
        INGEST, {"url": "https://open.spotify.com/playlist/37i9editorial"}, format="json"
    )
    assert r.status_code == 201
    assert r.data["track_count"] == 50
    assert r.data["note"] and "50" in r.data["note"]


@pytest.mark.django_db
def test_ingest_spotify(client, monkeypatch):
    from apps.catalog.ingest import spotify

    meta = {
        "title": "Sp Mix",
        "external_id": "sp1",
        "kind": "playlist",
        "tracks": [
            {
                "title": "X",
                "artist": "Y",
                "duration": 210000,
                "isrc": "US1234567890",
                "artwork": "https://i.scdn.co/image/abc",
                "album": "Sp Album",
                "explicit": True,
                "preview": "https://p.scdn.co/mp3-preview/abc",
            }
        ],
    }
    monkeypatch.setattr(spotify, "ingest_with_meta", lambda url: meta)
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/sp1"}, format="json")
    assert r.status_code == 201
    assert r.data["track_count"] == 1
    assert r.data["tracks"][0]["active_source"] is None  # matched to YouTube lazily on play
    assert r.data["tracks"][0]["album_name"] == "Sp Album"
    assert r.data["tracks"][0]["is_explicit"] is True
    tr = Track.objects.get(title="X")
    assert tr.isrc == "US1234567890"  # ISRC stored
    assert tr.artwork_url and tr.preview_url  # display metadata stored


@pytest.mark.django_db
def test_metadata_enriched_across_sources():
    # A track first seen sparse (YouTube-like: no album/art) is backfilled when the
    # same song is re-imported from a richer source — never overwriting what exists.
    from apps.catalog.services import _upsert_track

    row = {"title": "E", "artist": "A", "duration": 1000}
    t1 = _upsert_track(row)
    assert t1.album_name == "" and t1.artwork_url == ""

    t2 = _upsert_track(
        {
            **row,
            "album": "Real Album",
            "artwork": "https://img/x",
            "explicit": True,
            "preview": "https://p/x",
        }
    )
    assert t2.pk == t1.pk  # same canonical track (match_key)
    t1.refresh_from_db()
    assert t1.album_name == "Real Album"
    assert t1.artwork_url == "https://img/x"
    assert t1.is_explicit is True

    # A later source does NOT clobber metadata we already have.
    _upsert_track({**row, "album": "Wrong Album"})
    t1.refresh_from_db()
    assert t1.album_name == "Real Album"


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
def test_match_backfills_artwork_from_youtube_thumbnail(monkeypatch):
    # Tracks with no cover (old imports / sources that gave none) get the video
    # thumbnail once matched — so the player shows art, not a placeholder.
    track = TrackFactory(artwork_url="")
    monkeypatch.setattr(
        match.youtube,
        "search",
        lambda q, n=5: [{"video_id": "VID123", "title": "t", "uploader": "u", "duration_sec": 200}],
    )
    match.match_track_to_youtube(track)
    track.refresh_from_db()
    assert track.artwork_url == "https://i.ytimg.com/vi/VID123/hqdefault.jpg"


@pytest.mark.django_db
def test_play_prefers_origin_art_then_youtube(monkeypatch):
    from apps.catalog.ingest import spotify

    # A Spotify-origin track resolves its REAL album art on play (single /tracks).
    sp = TrackFactory(artwork_url="", source_url="https://open.spotify.com/track/abc123")
    monkeypatch.setattr(spotify, "_token", lambda: "tok")
    monkeypatch.setattr(
        spotify,
        "_get",
        lambda path, tok: {"album": {"images": [{"url": "https://i.scdn.co/REAL", "width": 300}]}},
    )
    match.backfill_artwork(sp, "VID123")
    sp.refresh_from_db()
    assert sp.artwork_url == "https://i.scdn.co/REAL"  # Spotify, not the YouTube thumb

    # No origin art available → falls back to the YouTube thumbnail.
    yt = TrackFactory(artwork_url="", source_url="")
    match.backfill_artwork(yt, "VID123")
    yt.refresh_from_db()
    assert yt.artwork_url == "https://i.ytimg.com/vi/VID123/hqdefault.jpg"


@pytest.mark.django_db
def test_ingest_records_per_track_source_link(client, monkeypatch):
    # Each song's own per-source link is stored (so we can re-resolve/refer later).
    from apps.catalog.ingest import spotify
    from apps.catalog.models import SourceLink

    meta = {
        "title": "M",
        "external_id": "pl",
        "kind": "playlist",
        "partial": False,
        "tracks": [
            {
                "title": "Z",
                "artist": "A",
                "duration": 1000,
                "external_id": "sp123",
                "source_url": "https://open.spotify.com/track/sp123",
            }
        ],
    }
    monkeypatch.setattr(spotify, "ingest_with_meta", lambda url: meta)
    r = client.post(INGEST, {"url": "https://open.spotify.com/playlist/pl"}, format="json")
    assert r.status_code == 201
    link = SourceLink.objects.get(external_id="sp123", track__isnull=False)
    assert link.url == "https://open.spotify.com/track/sp123"
    assert link.kind == "track"
    assert str(link.track_id) == r.data["tracks"][0]["id"]


@pytest.mark.django_db
def test_refresh_artwork_self_heals(client, monkeypatch):
    # A broken cover is re-resolved from the origin on demand.
    track = TrackFactory(
        artwork_url="https://dead/x", source_url="https://open.spotify.com/track/abc"
    )
    PlaybackSourceFactory(track=track, locator="vid123")
    monkeypatch.setattr(match, "_origin_artwork", lambda u: "https://i.scdn.co/NEW")
    r = client.post(f"/api/v1/catalog/tracks/{track.id}/refresh-artwork/")
    assert r.status_code == 200
    assert r.data["artwork_url"] == "https://i.scdn.co/NEW"


@pytest.mark.django_db
def test_playlist_detail_is_metadata_only(client):
    tracks = [TrackFactory() for _ in range(3)]
    pl = client.post(
        "/api/v1/catalog/playlists/",
        {"title": "Mix", "track_ids": [str(t.id) for t in tracks]},
        format="json",
    ).data
    detail = client.get(f"/api/v1/catalog/playlists/{pl['id']}/")
    assert detail.status_code == 200
    assert detail.data["track_count"] == 3
    assert "items" not in detail.data  # tracks no longer inlined; paginated separately


@pytest.mark.django_db
def test_playlist_tracks_paginated_in_order(client):
    # PAGE_SIZE is 25 — 30 tracks spans two pages, in playlist position order.
    tracks = [TrackFactory() for _ in range(30)]
    pl = client.post(
        "/api/v1/catalog/playlists/",
        {"title": "Big", "track_ids": [str(t.id) for t in tracks]},
        format="json",
    ).data
    p1 = client.get(f"/api/v1/catalog/playlists/{pl['id']}/tracks/")
    assert p1.status_code == 200
    assert p1.data["count"] == 30
    assert len(p1.data["results"]) == 25
    assert p1.data["next"] and p1.data["results"][0]["position"] == 0

    p2 = client.get(f"/api/v1/catalog/playlists/{pl['id']}/tracks/?page=2")
    assert len(p2.data["results"]) == 5
    assert p2.data["results"][0]["position"] == 25


def test_playlist_tracks_server_side_search(client):
    # ?search= narrows a playlist's tracks by title or artist (case-insensitive).
    hit = TrackFactory(title="Midnight City", primary_artist="M83")
    other = TrackFactory(title="Strobe", primary_artist="Deadmau5")
    pl = client.post(
        "/api/v1/catalog/playlists/",
        {"title": "Mix", "track_ids": [str(hit.id), str(other.id)]},
        format="json",
    ).data
    by_title = client.get(f"/api/v1/catalog/playlists/{pl['id']}/tracks/?search=midnight")
    assert [r["track"]["id"] for r in by_title.data["results"]] == [str(hit.id)]

    by_artist = client.get(f"/api/v1/catalog/playlists/{pl['id']}/tracks/?search=deadmau5")
    assert [r["track"]["id"] for r in by_artist.data["results"]] == [str(other.id)]


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


PLAYLISTS = "/api/v1/catalog/playlists/"


def _make_playlist(client, title, tracks):
    """Create a playlist owned by the client's user from given Track objects."""
    r = client.post(
        PLAYLISTS, {"title": title, "track_ids": [str(t.id) for t in tracks]}, format="json"
    )
    assert r.status_code == 201, r.content
    return r.data["id"]


@pytest.mark.django_db
def test_playlists_scoped_to_owner(client):
    _make_playlist(client, "Mine", [TrackFactory()])
    PlaylistFactory(created_by=UserFactory(), title="Theirs")  # another user's
    titles = [p["title"] for p in client.get(PLAYLISTS).data["results"]]
    assert "Mine" in titles and "Theirs" not in titles


@pytest.mark.django_db
def test_playlist_search_by_title_only(client):
    # The playlists list searches playlist titles only; searching within a
    # playlist's songs is the detail page's job (test_playlist_tracks_server_side_search).
    _make_playlist(
        client, "Jazz Vibes", [TrackFactory(title="Blue Train", primary_artist="John Coltrane")]
    )
    _make_playlist(client, "Rock", [TrackFactory(title="Smoke", primary_artist="Deep Purple")])
    by_title = client.get(PLAYLISTS, {"search": "jazz"}).data["results"]
    assert [p["title"] for p in by_title] == ["Jazz Vibes"]
    # A contained song's artist does NOT surface the playlist here.
    assert client.get(PLAYLISTS, {"search": "coltrane"}).data["results"] == []
    assert client.get(PLAYLISTS, {"search": "zzzznope"}).data["results"] == []


@pytest.mark.django_db
def test_song_search_upserts_spotify_results(client, monkeypatch):
    # Global song search: Spotify supplies metadata, which we upsert as catalog
    # Tracks (YouTube audio resolves on play). Spotify is mocked (no network).
    from apps.catalog.ingest import spotify

    monkeypatch.setattr(
        spotify,
        "search_tracks",
        lambda query, limit=20: [
            {
                "title": "Bohemian Rhapsody",
                "artist": "Queen",
                "duration": 354000,
                "isrc": "GBUM71029604",
                "artwork": "https://img/x",
                "album": "A Night at the Opera",
                "explicit": False,
                "preview": "",
                "external_id": "sp1",
                "source_url": "https://open.spotify.com/track/sp1",
            }
        ],
    )
    r = client.get("/api/v1/catalog/tracks/search/?q=bohemian")
    assert r.status_code == 200
    assert [t["title"] for t in r.data] == ["Bohemian Rhapsody"]
    assert Track.objects.filter(title="Bohemian Rhapsody").exists()  # upserted globally

    # Empty query short-circuits — no results, no Spotify call.
    assert client.get("/api/v1/catalog/tracks/search/?q=").data == []


@pytest.mark.django_db
def test_update_playlist_rename_and_visibility(client):
    pid = _make_playlist(client, "Old", [TrackFactory()])
    r = client.patch(f"{PLAYLISTS}{pid}/", {"title": "New", "is_public": True}, format="json")
    assert r.status_code == 200
    pl = Playlist.objects.get(pk=pid)
    assert pl.title == "New" and pl.is_public is True


@pytest.mark.django_db
def test_cannot_edit_or_delete_others_playlist(client):
    foreign = PlaylistFactory(created_by=UserFactory())
    assert (
        client.patch(f"{PLAYLISTS}{foreign.id}/", {"title": "Hijack"}, format="json").status_code
        == 404
    )
    assert client.delete(f"{PLAYLISTS}{foreign.id}/").status_code == 404


@pytest.mark.django_db
def test_delete_playlist_preserves_global_tracks(client):
    t = TrackFactory()
    PlaybackSourceFactory(track=t, locator="vid123")
    pid = _make_playlist(client, "Temp", [t])
    tracks_before, sources_before = Track.objects.count(), PlaybackSource.objects.count()
    assert client.delete(f"{PLAYLISTS}{pid}/").status_code == 204
    assert not Playlist.objects.filter(pk=pid).exists()
    # The global catalog (Track + its matched PlaybackSource) survives the delete.
    assert Track.objects.count() == tracks_before
    assert PlaybackSource.objects.count() == sources_before


@pytest.mark.django_db
def test_remove_track_repacks_positions(client):
    tracks = [TrackFactory() for _ in range(3)]
    pid = _make_playlist(client, "Mix", tracks)
    assert (
        client.post(
            f"{PLAYLISTS}{pid}/remove-track/", {"track_id": str(tracks[0].id)}, format="json"
        ).status_code
        == 204
    )
    items = client.get(f"{PLAYLISTS}{pid}/tracks/").data["results"]
    assert [i["track"]["id"] for i in items] == [str(tracks[1].id), str(tracks[2].id)]
    assert [i["position"] for i in items] == [0, 1]  # re-packed contiguous
    assert Track.objects.filter(pk=tracks[0].id).exists()  # the track itself survives


@pytest.mark.django_db
def test_reorder_moves_track_to_front(client):
    tracks = [TrackFactory() for _ in range(3)]
    pid = _make_playlist(client, "Mix", tracks)
    assert (
        client.post(
            f"{PLAYLISTS}{pid}/reorder/",
            {"track_id": str(tracks[2].id), "position": 0},
            format="json",
        ).status_code
        == 204
    )
    items = client.get(f"{PLAYLISTS}{pid}/tracks/").data["results"]
    assert [i["track"]["id"] for i in items] == [
        str(t.id) for t in (tracks[2], tracks[0], tracks[1])
    ]
    assert [i["position"] for i in items] == [0, 1, 2]


def test_spotify_404_explains_editorial(monkeypatch):
    import urllib.error
    import urllib.request

    from apps.catalog.ingest import spotify

    def raise_404(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", raise_404)
    with pytest.raises(spotify.SpotifyError, match="editorial"):
        spotify._get("/playlists/x", "tok")
