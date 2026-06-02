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
def test_ingest_persists_playlist_tracks_and_provenance(offline):
    playlist = services.ingest_apple_playlist(ALBUM_URL)

    assert playlist.items.count() == 13
    assert Track.objects.count() == 13
    # ordered membership 0..12
    positions = list(playlist.items.order_by("position").values_list("position", flat=True))
    assert positions == list(range(13))
    # versioned external ref + import provenance
    assert SourceLink.objects.filter(playlist=playlist, kind="album").count() == 1
    assert PlaylistImport.objects.filter(playlist=playlist, track_count=13).exists()


@pytest.mark.django_db
def test_reingest_is_idempotent(offline):
    playlist = services.ingest_apple_playlist(ALBUM_URL)
    services.ingest_apple_playlist(ALBUM_URL, playlist=playlist)

    assert playlist.items.count() == 13  # no duplicate membership
    assert Track.objects.count() == 13  # no duplicate tracks (match_key dedupe)
    assert PlaylistImport.objects.filter(playlist=playlist).count() == 2  # but 2 import records
