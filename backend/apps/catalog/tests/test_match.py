"""Matcher tests — the cloud scores client-supplied candidates and never calls YouTube."""

import pytest

from apps.catalog import match
from apps.catalog.models import PlaybackSource, Track

# Candidates as the desktop's /yt/search returns them.
FAKE_CANDIDATES = [
    # closest duration AND title match → should win
    {
        "video_id": "BEST",
        "title": "P.O.V. (Official Audio)",
        "uploader": "ClipseVEVO",
        "duration_sec": 258,
    },
    {"video_id": "LIVE", "title": "P.O.V. (Live)", "uploader": "fan", "duration_sec": 305},
    {
        "video_id": "WRONG",
        "title": "completely different song",
        "uploader": "x",
        "duration_sec": 258,
    },
]


@pytest.fixture
def track(db):
    return Track.objects.create(
        match_key="pov|clipse|258", title="P.O.V.", primary_artist="Clipse", duration_ms=258_030
    )


@pytest.mark.django_db
def test_promotes_best_candidate(track):
    ps = match.match_track_to_youtube(track, candidates=FAKE_CANDIDATES)

    assert ps is not None
    assert ps.locator == "BEST"  # best duration + title match
    assert ps.status == PlaybackSource.Status.ACTIVE
    # all candidates persisted, exactly one active
    assert track.playback_sources.count() == 3
    assert track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).count() == 1
    assert ps.duration_delta_ms == abs(258 * 1000 - 258_030)


@pytest.mark.django_db
def test_idempotent_when_already_active(track):
    match.match_track_to_youtube(track, candidates=FAKE_CANDIDATES)
    # second call is a no-op (active source already exists)
    assert match.match_track_to_youtube(track, candidates=FAKE_CANDIDATES) is None
    assert track.playback_sources.count() == 3


@pytest.mark.django_db
def test_no_candidates_returns_none(track):
    # The desktop search found nothing (or wasn't supplied) → no match, no YouTube call.
    assert match.match_track_to_youtube(track, candidates=[]) is None
    assert match.match_track_to_youtube(track, candidates=None) is None
    assert track.playback_sources.count() == 0


_SPOTIFY_HIT = {
    "title": "P.O.V.",
    "artist": "Clipse",
    "duration": 258_000,  # within tolerance of the track's 258_030
    "isrc": "USXXX0000001",
    "artwork": "https://i.scdn.co/image/REAL",
    "album": "Lord Willin'",
    "preview": "",
    "source_url": "https://open.spotify.com/track/abc123",
}


@pytest.mark.django_db
def test_enrich_from_spotify_adopts_real_metadata(track, monkeypatch):
    # A YouTube-sourced track with only a thumbnail cover and no real origin.
    track.artwork_url = "https://i.ytimg.com/vi/VID/hqdefault.jpg"
    track.source_url = "https://www.youtube.com/watch?v=VID"
    track.save()
    monkeypatch.setattr(match.spotify, "search_tracks", lambda q, limit=5: [_SPOTIFY_HIT])

    assert match.enrich_from_spotify(track) is True
    track.refresh_from_db()
    assert track.artwork_url == "https://i.scdn.co/image/REAL"  # real cover, not the thumb
    assert track.album_name == "Lord Willin'"
    assert track.isrc == "USXXX0000001"
    # Spotify is metadata-only; YouTube stays the source/provenance — source_url is untouched.
    assert track.source_url == "https://www.youtube.com/watch?v=VID"


@pytest.mark.django_db
def test_enrich_from_spotify_rejects_wrong_song(track, monkeypatch):
    # Far-off duration AND no title overlap → not the same recording, adopt nothing.
    monkeypatch.setattr(
        match.spotify,
        "search_tracks",
        lambda q, limit=5: [{"title": "unrelated", "duration": 90_000, "artwork": "https://x"}],
    )
    assert match.enrich_from_spotify(track) is False
    track.refresh_from_db()
    assert track.album_name == ""
