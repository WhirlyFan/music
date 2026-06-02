"""Deterministic, offline tests for the Apple Music parser (no network)."""

import pathlib

import pytest

from apps.catalog.ingest import applemusic

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "applemusic_album_clipse.html"
ALBUM_URL = "https://music.apple.com/us/album/p-o-v/1816313639"
SONG_URL = ALBUM_URL + "?i=1816313642"  # targets "P.O.V."


@pytest.fixture
def offline(monkeypatch):
    html = FIXTURE.read_text(encoding="utf-8")
    monkeypatch.setattr(applemusic, "fetch", lambda url: html)


def test_album_returns_all_tracks(offline):
    meta = applemusic.ingest_with_meta(ALBUM_URL)
    assert meta["kind"] == "album"
    assert len(meta["tracks"]) == 13
    assert meta["tracks"][0]["title"] == "The Birds Don't Sing"
    assert "Clipse" in meta["tracks"][0]["artist"]


def test_song_link_isolates_single_track(offline):
    meta = applemusic.ingest_with_meta(SONG_URL)
    assert meta["kind"] == "track"
    assert len(meta["tracks"]) == 1
    assert meta["tracks"][0]["title"] == "P.O.V."


def test_every_track_has_title_artist_duration(offline):
    for t in applemusic.ingest(ALBUM_URL):
        assert t["title"] and t["artist"]
        assert isinstance(t["duration"], int) and t["duration"] > 0
