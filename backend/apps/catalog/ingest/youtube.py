"""YouTube search via yt-dlp — metadata only, no audio download.

Used by the matcher to resolve a track to a candidate video. `extract_flat`
keeps it light (one search request, no per-video resolution) and the politeness
options keep us well under YouTube's ~20-50/IP soft limit when batching.

Audio download (Phase 3) is a separate concern and is the only part that needs
ffmpeg.
"""

from functools import lru_cache

from django.conf import settings
from yt_dlp import YoutubeDL


@lru_cache(maxsize=1)
def _impersonate_target():
    """Browser-TLS impersonation via curl_cffi (helps dodge YouTube's bot
    detection). Auto-detected: use the first target the runtime actually offers,
    else None — curl_cffi's profiles aren't available on every arch, and forcing an
    unavailable target errors. (None just means no impersonation, not broken.)"""
    try:
        with YoutubeDL({"quiet": True}) as ydl:
            targets = ydl._get_available_impersonate_targets()
        return targets[0][0] if targets else None
    except Exception:  # noqa: BLE001
        return None


def _opts(**extra) -> dict:
    """Base yt-dlp options for current YouTube extraction. YouTube requires solving
    a JS signature / n challenge to expose playable formats; that's handled by the
    bundled `yt-dlp-ejs` solver scripts run through the `deno` runtime (both baked
    into the image) — no runtime download. The bgutil PO-token provider sidecar
    (see settings.YOUTUBE_POT_BASE_URL) supplies proof-of-origin tokens to dodge
    throttling under load; curl_cffi impersonation is used where available."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        **extra,
    }
    target = _impersonate_target()
    if target is not None:
        opts["impersonate"] = target
    pot_base = (getattr(settings, "YOUTUBE_POT_BASE_URL", "") or "").strip()
    if pot_base:
        # Point the bgutil-ytdlp-pot-provider plugin at the sidecar's HTTP server.
        opts.setdefault("extractor_args", {})["youtubepot-bgutilhttp"] = {"base_url": [pot_base]}
    return opts


def resolve_audio(video_id: str) -> dict:
    """Resolve the direct audio stream for a YouTube video (no download).

    Returns {url, http_headers}. The URL is **IP-locked + time-limited** — only
    the server that resolved it can fetch it, and only for a few hours — so we
    proxy it from the same backend and cache it briefly (see streaming.py).
    """
    with YoutubeDL(_opts(format="bestaudio/best", retries=3)) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return {"url": info["url"], "http_headers": dict(info.get("http_headers") or {})}


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
        "external_id": vid or "",
        "source_url": f"https://www.youtube.com/watch?v={vid}" if vid else "",
    }


def ingest_with_meta(url: str) -> dict:
    """Ingest a YouTube playlist or video URL → {title, external_id, kind, tracks}.

    Each track carries its `video_id` (the playback source is the video itself —
    no search/match needed). Metadata only; no audio download.
    """
    with YoutubeDL(_opts(extract_flat="in_playlist", retries=5, sleep_interval_requests=1)) as ydl:
        info = ydl.extract_info(url, download=False) or {}
    if info.get("entries") is not None:
        tracks = [_entry(e) for e in info["entries"] if e and e.get("id")]
        return {
            "title": info.get("title") or "YouTube playlist",
            "external_id": info.get("id") or "",
            "kind": "playlist",
            "tracks": tracks,
            "cover": tracks[0]["artwork"] if tracks else "",  # first video thumb as the cover
        }
    one = [_entry(info)] if info.get("id") else []
    return {
        "title": info.get("title") or "YouTube video",
        "external_id": info.get("id") or "",
        "kind": "video",
        "tracks": one,
        "cover": one[0]["artwork"] if one else "",
    }


def search(query: str, n: int = 5) -> list[dict]:
    """Return up to `n` YouTube candidates for `query`.

    Each: {video_id, title, uploader, duration_sec}. duration_sec may be None.
    """
    with YoutubeDL(_opts(extract_flat=True, sleep_interval_requests=1, retries=5)) as ydl:
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
