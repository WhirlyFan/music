"""Tests for youtube._cookiefile() — the YOUTUBE_COOKIES → cookies.txt path.

No DB needed. Covers the three input shapes: unset, raw Netscape file, and
base64 (the tab-safe env-var form). The base64 branch is the important one:
pasting a tab-delimited cookies.txt into a dashboard env field mangles the tabs,
so we let it be carried base64-encoded instead.
"""

from __future__ import annotations

import base64
import http.cookiejar
from pathlib import Path

from django.test import override_settings

from apps.catalog.ingest import youtube

# A minimal valid Netscape cookies.txt (real TAB separators, magic header).
_COOKIES = (
    "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tTESTKEY\ttestvalue\n"
)


def _read(path: str) -> str:
    return Path(path).read_text()


def test_unset_returns_none():
    youtube._cookiefile.cache_clear()
    with override_settings(YOUTUBE_COOKIES=""):
        assert youtube._cookiefile() is None


def test_raw_netscape_file_written_and_parses():
    youtube._cookiefile.cache_clear()
    with override_settings(YOUTUBE_COOKIES=_COOKIES):
        path = youtube._cookiefile()
    assert path and "TESTKEY\ttestvalue" in _read(path)
    jar = http.cookiejar.MozillaCookieJar(path)
    jar.load()
    assert len(jar) == 1


def test_base64_is_decoded_to_the_real_file():
    youtube._cookiefile.cache_clear()
    encoded = base64.b64encode(_COOKIES.encode()).decode()
    with override_settings(YOUTUBE_COOKIES=encoded):
        path = youtube._cookiefile()
    # Decoded back to the tab-delimited original, so yt-dlp can parse it.
    assert path and "TESTKEY\ttestvalue" in _read(path)
    jar = http.cookiejar.MozillaCookieJar(path)
    jar.load()
    assert len(jar) == 1


def teardown_function(_):
    # Don't leak the memoized path across tests / suites.
    youtube._cookiefile.cache_clear()
