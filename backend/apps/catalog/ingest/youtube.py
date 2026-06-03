"""YouTube search via yt-dlp — metadata only, no audio download.

Used by the matcher to resolve a track to a candidate video. `extract_flat`
keeps it light (one search request, no per-video resolution) and the politeness
options keep us well under YouTube's ~20-50/IP soft limit when batching.

Audio download (Phase 3) is a separate concern and is the only part that needs
ffmpeg.
"""

from yt_dlp import YoutubeDL

_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,  # don't resolve each result fully — lighter + fewer requests
    "skip_download": True,
    "noplaylist": True,
    # Politeness for batch matching (stay under YouTube's per-IP soft limit).
    "sleep_interval_requests": 1,
    "retries": 5,
}


_RESOLVE_OPTS = {
    "format": "bestaudio",
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    "retries": 3,
}


def resolve_audio(video_id: str) -> dict:
    """Resolve the direct audio stream for a YouTube video (no download).

    Returns {url, http_headers}. The URL is **IP-locked + time-limited** — only
    the server that resolved it can fetch it, and only for a few hours — so we
    proxy it from the same backend and cache it briefly (see streaming.py).
    """
    with YoutubeDL(_RESOLVE_OPTS) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return {"url": info["url"], "http_headers": dict(info.get("http_headers") or {})}


_INGEST_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": "in_playlist",  # flatten playlist entries; resolve a lone video
    "skip_download": True,
    "retries": 5,
    "sleep_interval_requests": 1,
}


def _entry(e: dict) -> dict:
    duration = e.get("duration")
    vid = e.get("id")
    return {
        "video_id": vid,
        "title": e.get("title") or "",
        "artist": e.get("channel") or e.get("uploader") or "",
        # yt-dlp reports seconds; our Track stores milliseconds.
        "duration": int(duration * 1000) if duration else None,
        # The thumbnail is derivable from the id — no extra request. YouTube has
        # no album/explicit metadata (it's the playback layer, not a catalog).
        "artwork": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else "",
        "source_url": f"https://www.youtube.com/watch?v={vid}" if vid else "",
    }


def ingest_with_meta(url: str) -> dict:
    """Ingest a YouTube playlist or video URL → {title, external_id, kind, tracks}.

    Each track carries its `video_id` (the playback source is the video itself —
    no search/match needed). Metadata only; no audio download.
    """
    with YoutubeDL(_INGEST_OPTS) as ydl:
        info = ydl.extract_info(url, download=False) or {}
    if info.get("entries") is not None:
        tracks = [_entry(e) for e in info["entries"] if e and e.get("id")]
        return {
            "title": info.get("title") or "YouTube playlist",
            "external_id": info.get("id") or "",
            "kind": "playlist",
            "tracks": tracks,
        }
    return {
        "title": info.get("title") or "YouTube video",
        "external_id": info.get("id") or "",
        "kind": "video",
        "tracks": [_entry(info)] if info.get("id") else [],
    }


def search(query: str, n: int = 5) -> list[dict]:
    """Return up to `n` YouTube candidates for `query`.

    Each: {video_id, title, uploader, duration_sec}. duration_sec may be None.
    """
    with YoutubeDL(_SEARCH_OPTS) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    out = []
    for entry in (info or {}).get("entries") or []:
        if not entry or not entry.get("id"):
            continue
        out.append(
            {
                "video_id": entry["id"],
                "title": entry.get("title") or "",
                "uploader": entry.get("channel") or entry.get("uploader") or "",
                "duration_sec": entry.get("duration"),
            }
        )
    return out
