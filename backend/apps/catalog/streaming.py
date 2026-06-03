"""Transient audio proxy: resolve a YouTube video's audio via yt-dlp and stream
the bytes through our backend. Nothing is stored — we only ever hold the
`video_id` reference; the audio is proxied live and never written to disk.

The resolved `googlevideo` URL is IP-locked + ~hours-lived, so we (a) resolve
from the same backend that proxies, and (b) cache the resolved URL per video to
keep YouTube hits (and bot-detection exposure) low.
"""

import urllib.request

from django.core.cache import cache

from .ingest import youtube

_CHUNK = 64 * 1024
_URL_TTL = 60 * 60  # 1h — comfortably inside the googlevideo URL lifetime


def resolved_audio(video_id: str) -> dict:
    """Cached {url, http_headers} for a video's audio stream."""
    key = f"ytaudio:{video_id}"
    data = cache.get(key)
    if data is None:
        data = youtube.resolve_audio(video_id)
        cache.set(key, data, _URL_TTL)
    return data


def open_upstream(url: str, headers: dict):
    """Open the upstream audio stream (forwarding Range etc.)."""
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20)


def stream_chunks(upstream):
    try:
        while True:
            chunk = upstream.read(_CHUNK)
            if not chunk:
                break
            yield chunk
    finally:
        upstream.close()
