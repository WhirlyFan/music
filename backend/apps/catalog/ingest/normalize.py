"""Normalization helpers for cross-reference dedupe of tracks."""

import re

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = _PUNCT.sub(" ", s)
    return _WS.sub(" ", s).strip()


def make_match_key(title: str, artist: str, duration_ms=None) -> str:
    """Stable-ish dedupe key when ISRC is unavailable (e.g. the Apple scrape).

    Normalizes title + artist and buckets duration to the nearest second so
    tiny metadata differences don't split the same recording. ISRC remains the
    preferred cross-platform key when present.
    """
    dur_bucket = round(duration_ms / 1000) if isinstance(duration_ms, (int, float)) else ""
    return f"{_norm(title)}|{_norm(artist)}|{dur_bucket}"
