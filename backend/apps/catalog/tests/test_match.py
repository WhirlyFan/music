"""Matcher tests — yt-dlp mocked so CI never hits YouTube."""

import pytest

from apps.catalog import match
from apps.catalog.models import PlaybackSource, Track

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
def test_promotes_best_candidate(monkeypatch, track):
    monkeypatch.setattr(match.youtube, "search", lambda q, n=5: FAKE_CANDIDATES)

    ps = match.match_track_to_youtube(track)

    assert ps is not None
    assert ps.locator == "BEST"  # best duration + title match
    assert ps.status == PlaybackSource.Status.ACTIVE
    # all candidates persisted, exactly one active
    assert track.playback_sources.count() == 3
    assert track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).count() == 1
    assert ps.duration_delta_ms == abs(258 * 1000 - 258_030)


@pytest.mark.django_db
def test_idempotent_when_already_active(monkeypatch, track):
    monkeypatch.setattr(match.youtube, "search", lambda q, n=5: FAKE_CANDIDATES)
    match.match_track_to_youtube(track)
    # second call is a no-op (active source already exists)
    assert match.match_track_to_youtube(track) is None
    assert track.playback_sources.count() == 3


@pytest.mark.django_db
def test_no_candidates_returns_none(monkeypatch, track):
    monkeypatch.setattr(match.youtube, "search", lambda q, n=5: [])
    assert match.match_track_to_youtube(track) is None
    assert track.playback_sources.count() == 0
