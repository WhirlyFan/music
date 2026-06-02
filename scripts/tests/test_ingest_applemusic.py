"""
Deterministic unit tests for the Apple Music ingester.

These run against a SAVED fixture (no network), so they're stable in CI and
test the part we own — the parser. A separate scheduled "canary" workflow
hits Apple live to detect upstream page changes.
"""
import pathlib

import pytest

import ingest_applemusic as ing

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "applemusic_album_clipse.html"
ALBUM_URL = "https://music.apple.com/us/album/p-o-v/1816313639"
SONG_URL = ALBUM_URL + "?i=1816313642"  # targets "P.O.V."


@pytest.fixture
def offline(monkeypatch):
    """Serve the saved fixture instead of hitting the network."""
    html = FIXTURE.read_text(encoding="utf-8")
    monkeypatch.setattr(ing, "fetch", lambda url: html)


def test_album_returns_all_tracks(offline):
    tracks = ing.ingest(ALBUM_URL)
    assert len(tracks) == 13
    assert tracks[0]["title"] == "The Birds Don't Sing"
    assert "Clipse" in tracks[0]["artist"]


def test_every_track_has_title_artist_duration(offline):
    for t in ing.ingest(ALBUM_URL):
        assert t["title"], "missing title"
        assert t["artist"], "missing artist"
        assert isinstance(t["duration"], int) and t["duration"] > 0


def test_song_link_isolates_single_track(offline):
    tracks = ing.ingest(SONG_URL)
    assert len(tracks) == 1
    assert tracks[0]["title"] == "P.O.V."


def test_internal_id_is_stripped_from_output(offline):
    assert all("_id" not in t for t in ing.ingest(ALBUM_URL))
