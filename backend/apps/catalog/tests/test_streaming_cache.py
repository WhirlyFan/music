"""On-disk audio cache: range parsing, eviction, serving, and the view hit-path."""

import os

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.catalog import streaming
from apps.catalog.tests.factories import PlaybackSourceFactory, TrackFactory
from apps.users.tests.factories import UserFactory

# --- pure helpers ------------------------------------------------------------


@pytest.mark.parametrize(
    "header,size,expected",
    [
        (None, 100, None),
        ("bytes=0-", 100, (0, 99)),
        ("bytes=10-19", 100, (10, 19)),
        ("bytes=50-", 100, (50, 99)),
        ("bytes=-20", 100, (80, 99)),  # suffix
        ("bytes=90-500", 100, (90, 99)),  # clamp end
        ("bytes=200-300", 100, None),  # unsatisfiable
        ("bytes=abc", 100, None),  # malformed
    ],
)
def test_parse_range(header, size, expected):
    assert streaming._parse_range(header, size) == expected


def test_serve_cached_full(tmp_path):
    p = tmp_path / "vid"
    p.write_bytes(b"0123456789")
    resp = streaming.serve_cached(p, "audio/mp4", None)
    assert resp.status_code == 200
    assert resp["Content-Length"] == "10"
    assert resp["Accept-Ranges"] == "bytes"
    assert b"".join(resp.streaming_content) == b"0123456789"


def test_serve_cached_range(tmp_path):
    p = tmp_path / "vid"
    p.write_bytes(b"0123456789")
    resp = streaming.serve_cached(p, "audio/mp4", "bytes=2-5")
    assert resp.status_code == 206
    assert resp["Content-Range"] == "bytes 2-5/10"
    assert resp["Content-Length"] == "4"
    assert b"".join(resp.streaming_content) == b"2345"


def test_evict_drops_lru_first(tmp_path, settings):
    settings.AUDIO_CACHE_DIR = str(tmp_path)
    settings.AUDIO_CACHE_MAX_BYTES = 15
    # Three 10-byte entries; total 30 > 15 cap → evict oldest two.
    for i, name in enumerate(["old", "mid", "new"]):
        (tmp_path / name).write_bytes(b"x" * 10)
        (tmp_path / f"{name}.ct").write_text("audio/mp4")
        os.utime(tmp_path / name, (1000 + i, 1000 + i))  # ascending mtime
    streaming._evict(tmp_path)
    assert not (tmp_path / "old").exists()
    assert not (tmp_path / "old.ct").exists()  # sidecar removed too
    assert not (tmp_path / "mid").exists()
    assert (tmp_path / "new").exists()  # most-recent kept


def test_cached_path_touches_mtime(tmp_path, settings):
    settings.AUDIO_CACHE_DIR = str(tmp_path)
    p = tmp_path / "vid"
    p.write_bytes(b"data")
    os.utime(p, (1000, 1000))
    got = streaming.cached_path("vid")
    assert got == p
    assert p.stat().st_mtime > 1000  # touched
    assert streaming.cached_path("missing") is None


# --- view hit-path -----------------------------------------------------------


@pytest.fixture
def client(db):
    user = UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.mark.django_db
def test_stream_served_from_cache_without_youtube(client, tmp_path, settings, monkeypatch):
    settings.AUDIO_CACHE_DIR = str(tmp_path)
    track = TrackFactory()
    ps = PlaybackSourceFactory(track=track)
    # Pre-populate the cache for this video id.
    (tmp_path / ps.locator).write_bytes(b"AUDIOBYTES!")
    (tmp_path / f"{ps.locator}.ct").write_text("audio/mpeg")

    # If the cache works, we must NOT resolve from YouTube.
    def _boom(*a, **k):
        raise AssertionError("resolved_audio should not be called on a cache hit")

    monkeypatch.setattr(streaming, "resolved_audio", _boom)

    res = client.get(f"/api/v1/catalog/tracks/{track.id}/stream/", HTTP_RANGE="bytes=0-4")
    assert res.status_code == 206
    assert res["Content-Range"] == "bytes 0-4/11"
    assert res["Content-Type"] == "audio/mpeg"
    assert b"".join(res.streaming_content) == b"AUDIO"
