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
