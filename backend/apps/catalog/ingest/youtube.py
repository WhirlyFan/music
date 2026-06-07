"""YouTube search via yt-dlp — metadata only, no audio download.

Used by the matcher to resolve a track to a candidate video. `extract_flat`
keeps it light (one search request, no per-video resolution) and the politeness
options keep us well under YouTube's ~20-50/IP soft limit when batching.

Audio download (Phase 3) is a separate concern and is the only part that needs
ffmpeg.
"""

import tempfile
import urllib.parse
from functools import lru_cache

from django.conf import settings
from yt_dlp import YoutubeDL


@lru_cache(maxsize=1)
def _impersonate_target():
    """Browser-TLS impersonation via curl_cffi (helps dodge YouTube's bot
    detection). Auto-detected: use the first target the runtime actually offers,
    else None — curl_cffi's profiles aren't available on every arch, and forcing an
    unavailable target errors. (None just means no impersonation, not broken.)

    NOTE: curl_cffi is currently NOT installed — we dropped the yt-dlp[curl-cffi]
    extra to clear CVE-2026-33752 (SSRF, fixed only in curl-cffi 0.15.0, which no
    stable yt-dlp admits yet). So this returns None today and impersonation is inert;
    playback relies on the ejs solver + PO tokens + the web_embedded client instead.
    Re-add the extra (and this lights up automatically) once yt-dlp ships the fix."""
    try:
        with YoutubeDL({"quiet": True}) as ydl:
            targets = ydl._get_available_impersonate_targets()
        return targets[0][0] if targets else None
    except Exception:  # noqa: BLE001
        return None


@lru_cache(maxsize=1)
def _cookiefile() -> str | None:
    """Write the YouTube cookies (a Netscape cookies.txt exported from a signed-in
    account, supplied via the YOUTUBE_COOKIES secret) to a tmp file for yt-dlp.
    Signed-in requests get past the 'confirm you're not a bot' wall that YouTube
    throws at datacenter IPs — the PO-token sidecar + ejs solver alone don't clear
    it from Render. None if unset (local/dev), then we rely on those instead.

    Written under /tmp (writable) with delete=False so it persists for the process
    and yt-dlp can refresh the jar in place."""
    content = (getattr(settings, "YOUTUBE_COOKIES", "") or "").strip()
    if not content:
        return None
    f = tempfile.NamedTemporaryFile("w", prefix="ytcookies-", suffix=".txt", delete=False)
    f.write(content + "\n")
    f.close()
    return f.name


def _opts(**extra) -> dict:
    """Base yt-dlp options for current YouTube extraction. YouTube requires solving
    a JS signature / n challenge to expose playable formats; that's handled by the
    bundled `yt-dlp-ejs` solver scripts run through the `deno` runtime (both baked
    into the image) — no runtime download. The bgutil PO-token provider sidecar
    (see settings.YOUTUBE_POT_BASE_URL) supplies proof-of-origin tokens to dodge
    throttling under load; YOUTUBE_COOKIES (signed-in cookies.txt) clears the
    'confirm you're not a bot' wall on datacenter IPs; curl_cffi impersonation is
    used where available."""
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
    cookiefile = _cookiefile()
    if cookiefile:
        opts["cookiefile"] = cookiefile
    return opts


# Prefer a *progressive* m4a/AAC stream (itag 140) over anything else. YouTube's
# SABR rollout now makes the default clients hand back an HLS manifest for
# "bestaudio", which a plain <audio> element can't play in Chrome and which Web
# Audio can't tap in Safari (playback goes silent while the timeline advances).
# AAC-in-m4a is the one progressive format every browser plays; the fallbacks
# only kick in if 140 is ever missing.
_AUDIO_FORMAT = "140/bestaudio[ext=m4a][protocol^=https]/bestaudio[protocol^=https]/bestaudio"
# The `web_embedded` client is the one that still serves a progressive itag-140
# stream whose URL we can actually fetch (200). The default clients return only
# HLS/SABR; `mweb`/`web` hand back a 403-locked URL (they need a GVS PO token
# bound to visitor_data we don't have). web_embedded needs neither and works for
# any embeddable video — the rare embedding-disabled track will 404 here, which
# surfaces as the transient "couldn't load audio" message rather than silence.
_AUDIO_CLIENTS = ("web_embedded",)


def resolve_audio(video_id: str) -> dict:
    """Resolve the direct audio stream for a YouTube video (no download).

    Returns {url, http_headers}. The URL is **IP-locked + time-limited** — only
    the server that resolved it can fetch it, and only for a few hours — so we
    proxy it from the same backend and cache it briefly (see streaming.py).
    """
    opts = _opts(format=_AUDIO_FORMAT, retries=3)
    opts.setdefault("extractor_args", {}).setdefault("youtube", {})["player_client"] = list(
        _AUDIO_CLIENTS
    )
    with YoutubeDL(opts) as ydl:
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

    A `watch?v=…&list=…` URL names both a video and the playlist it's playing
    from; we import the whole playlist (the base opts force `noplaylist`, so we
    must opt back in). Auto-generated radio/mixes (`RD…`) and the private Watch
    Later (`WL`) aren't real playlists — those fall back to the single video.
    """
    list_id = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("list", [""])[0]
    want_playlist = bool(list_id) and not list_id.startswith(("RD", "WL"))
    opts = _opts(
        extract_flat="in_playlist",
        retries=5,
        sleep_interval_requests=1,
        noplaylist=not want_playlist,
    )
    with YoutubeDL(opts) as ydl:
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
