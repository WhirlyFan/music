"""DB-backed tests for the catalog ingest service (offline via fixture)."""

import pathlib

import pytest

from apps.catalog import services
from apps.catalog.ingest import applemusic
from apps.catalog.models import PlaylistImport, SourceLink, Track

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "applemusic_album_clipse.html"
ALBUM_URL = "https://music.apple.com/us/album/p-o-v/1816313639"


@pytest.fixture
def offline(monkeypatch):
    html = FIXTURE.read_text(encoding="utf-8")
    monkeypatch.setattr(applemusic, "fetch", lambda url: html)


@pytest.mark.django_db
def test_ingest_persists_loose_tracks_and_provenance(offline):
    result = services.ingest_apple(ALBUM_URL)

    assert len(result["tracks"]) == 13
    assert Track.objects.count() == 13
    # ingest is decoupled from playlists: no playlist, just an import snapshot.
    assert result["import"].playlist_id is None
    assert SourceLink.objects.filter(kind="album", playlist__isnull=True).count() == 1
    assert PlaylistImport.objects.filter(track_count=13, playlist__isnull=True).exists()


@pytest.mark.django_db
def test_reingest_is_idempotent(offline):
    services.ingest_apple(ALBUM_URL)
    services.ingest_apple(ALBUM_URL)

    assert Track.objects.count() == 13  # no duplicate tracks (match_key dedupe)
    assert PlaylistImport.objects.count() == 2  # but 2 import records (provenance)
