"""Audio proxy + on-disk LRU cache.

We resolve a YouTube video's audio via yt-dlp and stream the bytes through the
backend (the resolved `googlevideo` URL is IP-locked to us, so clients can't
fetch it directly — everything goes through /stream/).

The first request for a track warms a local-disk cache in the background; every
subsequent request — other jam listeners, replays, and Range seeks — is served
from disk. That collapses N listeners into a single YouTube fetch (less
bot-detection exposure, less egress) and makes a follower's cold-start/seek
near-instant.

Cache layout (one dir, settings.AUDIO_CACHE_DIR):
  <video_id>        the complete audio bytes (atomically renamed into place)
  <video_id>.ct     its Content-Type
A `<video_id>` file exists only once fully downloaded, so its presence means
"complete". LRU is by mtime (touched on each hit); eviction keeps the dir under
settings.AUDIO_CACHE_MAX_BYTES. The resolved URL itself is also cached (below),
so a warm/replay never re-runs yt-dlp.
"""

import logging
import os
import secrets
import threading
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, StreamingHttpResponse

from .ingest import youtube

log = logging.getLogger(__name__)

_CHUNK = 64 * 1024
_URL_TTL = 60 * 60  # 1h — comfortably inside the googlevideo URL lifetime

# Guards against two concurrent misses both downloading the same video.
_warming: set[str] = set()
_warming_lock = threading.Lock()


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


# --- on-disk LRU cache -------------------------------------------------------


def _cache_dir() -> Path:
    d = Path(settings.AUDIO_CACHE_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def cached_path(video_id: str) -> Path | None:
    """The complete cached audio file for a video, or None. Touches mtime (LRU)."""
    p = _cache_dir() / video_id
    if p.exists():
        try:
            os.utime(p, None)  # mark recently used
        except OSError:
            pass
        return p
    return None


def cached_content_type(video_id: str) -> str:
    try:
        ct = (_cache_dir() / f"{video_id}.ct").read_text().strip()
        return ct or "audio/mp4"
    except OSError:
        return "audio/mp4"


def is_cached(video_id: str) -> bool:
    return (_cache_dir() / video_id).exists()


def warm_cache(video_id: str, url: str, headers: dict) -> None:
    """Populate the disk cache for a video in the background — one full fetch from
    YouTube; everyone else then reads disk. No-op if already cached or warming.
    Use when the resolved URL is already in hand (the /stream/ live-proxy path)."""
    _spawn_fill(video_id, url, dict(headers))


def warm_video(video_id: str) -> None:
    """Like warm_cache, but resolves the URL inside the worker thread (so the
    caller — e.g. a request thread gating a jam start — never blocks on yt-dlp).
    If the video is already cached, fire the ready signal immediately so a room
    that's waiting on it can start."""
    if is_cached(video_id):
        _notify_ready(video_id)
        return
    _spawn_fill(video_id, None, None)


def _spawn_fill(video_id: str, url: str | None, headers: dict | None) -> None:
    with _warming_lock:
        if video_id in _warming or is_cached(video_id):
            return
        _warming.add(video_id)
    threading.Thread(target=_fill, args=(video_id, url, headers), daemon=True).start()


def _fill(video_id: str, url: str | None, headers: dict | None) -> None:
    d = _cache_dir()
    tmp = d / f"{video_id}.{secrets.token_hex(4)}.tmp"
    try:
        if url is None:  # resolve here (warm_video path) — keep yt-dlp off the request thread
            audio = resolved_audio(video_id)
            url = audio["url"]
            headers = dict(audio.get("http_headers") or {})
        # Full file (drop any Range) so we can serve arbitrary ranges from disk.
        h = {k: v for k, v in (headers or {}).items() if k.lower() != "range"}
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as up:
            ct = up.headers.get("Content-Type", "audio/mp4")
            with open(tmp, "wb") as f:
                while True:
                    chunk = up.read(_CHUNK)
                    if not chunk:
                        break
                    f.write(chunk)
        (d / f"{video_id}.ct").write_text(ct)
        os.replace(tmp, d / video_id)  # atomic — the file appears only when complete
        _evict(d)
    except Exception:  # noqa: BLE001 — best-effort cache fill; live proxy already served
        log.warning("audio cache fill failed for %s", video_id, exc_info=True)
        tmp.unlink(missing_ok=True)
    finally:
        with _warming_lock:
            _warming.discard(video_id)
        # Always signal — on success a waiting jam starts from disk; on failure it
        # starts anyway and falls back to the live proxy (never stuck on "Starting…").
        _notify_ready(video_id)


def _notify_ready(video_id: str) -> None:
    """Tell the rooms layer this video's audio is ready, so any jam waiting on it
    can start together. Local import avoids a catalog↔rooms import cycle."""
    try:
        from apps.rooms.services import on_audio_ready

        on_audio_ready(video_id)
    except Exception:  # noqa: BLE001 — notification is best-effort
        log.warning("audio-ready notify failed for %s", video_id, exc_info=True)


def _evict(d: Path) -> None:
    """Drop least-recently-used entries until the dir is under the byte cap."""
    cap = settings.AUDIO_CACHE_MAX_BYTES
    files = [p for p in d.iterdir() if p.is_file() and not p.name.endswith((".tmp", ".ct"))]
    total = sum(p.stat().st_size for p in files)
    if total <= cap:
        return
    for p in sorted(files, key=lambda f: f.stat().st_mtime):  # oldest first
        total -= p.stat().st_size
        p.unlink(missing_ok=True)
        (d / f"{p.name}.ct").unlink(missing_ok=True)
        if total <= cap:
            break


def _parse_range(header: str, size: int):
    """Parse a single `bytes=` range against `size` → (start, end) inclusive, or
    None when absent/unsatisfiable/multipart (caller then serves the full file)."""
    if not header or not header.startswith("bytes="):
        return None
    spec = header[len("bytes=") :].split(",")[0].strip()
    try:
        if spec.startswith("-"):  # suffix: the last N bytes
            n = int(spec[1:])
            if n <= 0:
                return None
            return max(0, size - n), size - 1
        start_s, _, end_s = spec.partition("-")
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return None
    end = min(end, size - 1)
    if start > end or start < 0:
        return None
    return start, end


def _file_iter(path: Path, start: int, length: int):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            chunk = f.read(min(_CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def serve_cached(path: Path, content_type: str, range_header: str | None) -> HttpResponse:
    """Serve a complete cached file, honoring a Range request (206) or full (200)."""
    size = path.stat().st_size
    rng = _parse_range(range_header, size) if range_header else None
    if rng is None:
        resp = StreamingHttpResponse(_file_iter(path, 0, size), content_type=content_type)
        resp["Content-Length"] = str(size)
        resp["Accept-Ranges"] = "bytes"
        return resp
    start, end = rng
    length = end - start + 1
    resp = StreamingHttpResponse(
        _file_iter(path, start, length), status=206, content_type=content_type
    )
    resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    resp["Content-Length"] = str(length)
    resp["Accept-Ranges"] = "bytes"
    return resp
