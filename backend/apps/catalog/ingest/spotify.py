"""Spotify ingest. **API-first** (client-credentials, SPOTIFY_CLIENT_ID/SECRET):
it returns the *full* playlist + ISRC and is used whenever creds are configured.
The Web API blocks Spotify's own editorial/algorithmic playlists (Top 50,
Discover Weekly, …) for third-party apps, so for those — and when no creds are
set — we fall back to the public **embed scrape** (keyless, but capped at ~50
tracks). `partial=True` flags a result we could only return the capped 50 of.

Playback is resolved to YouTube lazily on play either way (Spotify doesn't hand
us a playable stream)."""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache


class SpotifyError(Exception):
    """A problem ingesting from Spotify (surfaced to the user as a 400)."""


class SpotifyNotConfigured(SpotifyError):
    """SPOTIFY_CLIENT_ID / SECRET aren't set."""


_TOKEN_URL = "https://accounts.spotify.com/api/token"
_API = "https://api.spotify.com/v1"


def _token() -> str:
    cid = settings.SPOTIFY_CLIENT_ID
    secret = settings.SPOTIFY_CLIENT_SECRET
    if not cid or not secret:
        raise SpotifyNotConfigured("Spotify isn't configured on this server yet.")
    cached = cache.get("spotify:app_token")
    if cached:
        return cached
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        _TOKEN_URL,
        data=data,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        body = json.loads(r.read())
    token = body["access_token"]
    cache.set("spotify:app_token", token, max(60, body.get("expires_in", 3600) - 60))
    return token


def _get(url_or_path: str, token: str) -> dict:
    url = url_or_path if url_or_path.startswith("http") else f"{_API}{url_or_path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # Since Nov 2024 Spotify 404s its own editorial/algorithmic playlists
            # (Top 50, Discover Weekly, Today's Top Hits, …) for third-party apps.
            raise SpotifyError(
                "Spotify blocks API access to its own editorial playlists (Top 50, "
                "Discover Weekly, etc.). Paste a user-made playlist, album, or track instead."
            ) from e
        if e.code in (401, 403):
            raise SpotifyError("Spotify rejected the request — check the Client ID/Secret.") from e
        raise SpotifyError(f"Spotify request failed ({e.code}).") from e


def _classify(url: str) -> tuple[str, str]:
    """(kind, id) from a Spotify URL or URI. Tolerates /intl-xx/ + ?si=… query."""
    if url.startswith("spotify:"):  # spotify:playlist:ID
        parts = url.split(":")
        if len(parts) >= 3 and parts[1] in ("playlist", "album", "track"):
            return parts[1], parts[2]
        raise SpotifyError("Unrecognized Spotify URI.")
    parts = [p for p in urllib.parse.urlparse(url).path.split("/") if p]
    if parts and parts[0].startswith("intl"):
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] in ("playlist", "album", "track"):
        return parts[0], parts[1]
    raise SpotifyError("That doesn't look like a Spotify playlist, album, or track link.")


def _pick_image(images: list, target: int = 300) -> str:
    """Pick the album image closest to `target` px wide (Spotify lists widest first)."""
    sized = [im for im in images or [] if im.get("url")]
    if not sized:
        return ""
    best = min(sized, key=lambda im: abs((im.get("width") or 0) - target))
    return best["url"]


def _normalize(track: dict) -> dict:
    album = track.get("album") or {}
    return {
        "title": track.get("name") or "",
        "artist": ", ".join(a.get("name", "") for a in track.get("artists") or []),
        "duration": track.get("duration_ms"),
        "isrc": (track.get("external_ids") or {}).get("isrc", ""),
        "artwork": _pick_image(album.get("images")),
        "album": album.get("name") or "",
        "explicit": bool(track.get("explicit")),
        "preview": track.get("preview_url") or "",  # null since Spotify's 2024 change
        "external_id": track.get("id") or "",
        "source_url": (track.get("external_urls") or {}).get("spotify", ""),
    }


def _paginate(first: dict, token: str):
    """Yield items across a paginated Spotify collection (follows `next`)."""
    page = first
    while page:
        yield from page.get("items") or []
        nxt = page.get("next")
        page = _get(nxt, token) if nxt else None


def _configured() -> bool:
    return bool(settings.SPOTIFY_CLIENT_ID and settings.SPOTIFY_CLIENT_SECRET)


def _api_with_meta(kind: str, sid: str) -> dict:
    """Full fetch via the Web API (paginated, with ISRC). Requires credentials."""
    token = _token()
    if kind == "track":
        t = _get(f"/tracks/{sid}", token)
        return {"title": t.get("name") or "", "external_id": sid, "kind": "track",
                "tracks": [_normalize(t)], "cover": _pick_image((t.get("album") or {}).get("images"))}
    if kind == "album":
        album = _get(f"/albums/{sid}", token)
        items = _paginate(album.get("tracks") or {}, token)
        # Album-track items omit the nested album object — inject it so each track
        # inherits the cover art + album name.
        return {"title": album.get("name") or "", "external_id": sid, "kind": "album",
                "tracks": [_normalize({**it, "album": album}) for it in items],
                "cover": _pick_image(album.get("images"))}
    playlist = _get(f"/playlists/{sid}", token)
    items = _paginate(playlist.get("tracks") or {}, token)
    tracks = [_normalize(it["track"]) for it in items if it.get("track")]
    return {"title": playlist.get("name") or "", "external_id": sid, "kind": "playlist",
            "tracks": tracks, "cover": _pick_image(playlist.get("images"))}


# ── Keyless embed scrape ──────────────────────────────────────────────────────
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_EMBED = "https://open.spotify.com/embed/{kind}/{sid}"
_EMBED_CAP = 50  # the public embed widget exposes only the first ~50 tracks
_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _find(obj, key):
    """First value for `key` anywhere in a nested dict/list (else None)."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            found = _find(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find(v, key)
            if found is not None:
                return found
    return None


def _scrape(kind: str, sid: str) -> dict | None:
    """Keyless: parse the public embed page's `__NEXT_DATA__` trackList. Returns
    {title, external_id, kind, tracks} (no ISRC, ~50-track cap) or None if the
    page can't be read/parsed."""
    req = urllib.request.Request(
        _EMBED.format(kind=kind, sid=sid),
        headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", "ignore")
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None
    m = _NEXT_DATA.search(html)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    track_list = _find(data, "trackList") or []
    # The embed has no per-track art — leave tracks' artwork empty so each gets its
    # OWN cover from the YouTube match on play (never the playlist's). The collection
    # cover is returned separately, for the playlist itself. Per-track the embed does
    # give a 30s `audioPreview` and an `isExplicit` flag.
    cover = ((_find(data, "coverArt") or {}).get("sources") or [{}])[-1].get("url", "")
    tracks = [
        {"title": t.get("title") or "", "artist": t.get("subtitle") or "",
         "duration": t.get("duration"), "isrc": "",
         "artwork": "", "album": "", "explicit": bool(t.get("isExplicit")),
         "preview": (t.get("audioPreview") or {}).get("url") or "",
         # uri is "spotify:track:<id>" → id + a public track link.
         "external_id": t["uri"].split(":")[-1] if t.get("uri", "").startswith("spotify:track:") else "",
         "source_url": f"https://open.spotify.com/track/{t['uri'].split(':')[-1]}"
         if t.get("uri", "").startswith("spotify:track:") else ""}
        for t in track_list
        if t.get("title")
    ]
    if not tracks:
        return None
    return {"title": _find(data, "name") or "Spotify import",
            "external_id": sid, "kind": kind, "tracks": tracks, "cover": cover}


def ingest_with_meta(url: str) -> dict:
    """API-first. Returns {title, external_id, kind, tracks, partial}.

    With creds, fetch the *full* list via the Web API (no 50 cap, includes ISRC).
    If the API refuses (editorial playlists 404 for apps) or no creds are set,
    fall back to the keyless embed scrape. `partial` is True only when we end up
    on the embed's capped ~50."""
    kind, sid = _classify(url)
    if _configured():
        try:
            return {**_api_with_meta(kind, sid), "partial": False}
        except SpotifyError:
            pass  # API refused (e.g. editorial 404) → try the keyless scrape
    scraped = _scrape(kind, sid)
    if scraped:
        return {**scraped, "partial": len(scraped["tracks"]) >= _EMBED_CAP}
    raise SpotifyError("Couldn't read that Spotify link — make sure it's public.")
