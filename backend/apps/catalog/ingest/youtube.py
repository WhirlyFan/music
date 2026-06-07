"""YouTube search via yt-dlp — metadata only, no audio download.

Used by the matcher to resolve a track to a candidate video. `extract_flat`
keeps it light (one search request, no per-video resolution) and the politeness
options keep us well under YouTube's ~20-50/IP soft limit when batching.

Audio download (Phase 3) is a separate concern and is the only part that needs
ffmpeg.
"""

import base64
import http.cookiejar
import logging
import tempfile
import urllib.parse
from functools import lru_cache

from django.conf import settings
from yt_dlp import YoutubeDL

log = logging.getLogger(__name__)


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

    Accepts either base64 (RECOMMENDED — a cookies.txt is tab-delimited, and
    pasting it raw into a dashboard env field mangles the tabs into spaces, which
    yt-dlp can't parse, so it silently runs unauthenticated and still bot-blocks)
    or a raw Netscape file. We then validate it parses and log the cookie count,
    so a bad paste shows up loud in the logs instead of looking like 'no cookies'.

    Written under /tmp (writable) with delete=False so it persists for the process
    and yt-dlp can refresh the jar in place."""
    raw = (getattr(settings, "YOUTUBE_COOKIES", "") or "").strip()
    if not raw:
        log.info("YOUTUBE_COOKIES not set — yt-dlp runs unauthenticated")
        return None

    # A raw Netscape file starts with a '# ... Cookie File' magic comment; anything
    # else we try to base64-decode (the tab-safe way to carry it in an env var).
    content = raw
    if not raw.startswith("#"):
        try:
            content = base64.b64decode(raw, validate=True).decode()
        except ValueError:  # binascii.Error & UnicodeDecodeError both subclass it
            content = raw  # not base64 — fall back to treating it as a raw file

    f = tempfile.NamedTemporaryFile("w", prefix="ytcookies-", suffix=".txt", delete=False)
    f.write(content if content.endswith("\n") else content + "\n")
    f.close()

    try:
        jar = http.cookiejar.MozillaCookieJar(f.name)
        jar.load()
        log.info("YouTube cookies loaded for yt-dlp auth (%d cookies)", len(jar))
    except Exception:  # noqa: BLE001 — diagnostic only; hand the file to yt-dlp regardless
        log.warning(
            "YOUTUBE_COOKIES is set but didn't parse as a Netscape cookies.txt — the "
            "tabs were likely mangled on paste. Store it base64-encoded instead "
            "(e.g. `base64 -i cookies.txt | tr -d '\\n'`).",
            exc_info=True,
        )
    return f.name


def _opts(**extra) -> dict:
    """Base yt-dlp options for the cloud's YouTube extraction — SEARCH + playlist/
    video metadata ingest only (audio is resolved on each desktop node now, off the
    user's own IP). These are light flat-extraction calls. YOUTUBE_COOKIES (a
    signed-in cookies.txt) clears the 'confirm you're not a bot' wall YouTube throws
    at datacenter IPs; curl_cffi impersonation is used where available. The bundled
    `yt-dlp-ejs` solver (via the `deno` runtime in the image) handles any JS
    signature / n challenge. No residential proxy and no PO-token sidecar — both were
    tried for the old cloud audio path and neither was the fix; web_embedded (desktop)
    was, and the cloud no longer touches audio."""
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
    cookiefile = _cookiefile()
    if cookiefile:
        opts["cookiefile"] = cookiefile
    return opts


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
