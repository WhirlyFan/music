"""Spotify ingest via the Web API (client-credentials flow — public playlists,
albums, tracks). Needs SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (Doppler).

Unlike the Apple Music scrape, Spotify gives us **ISRC** per track, which we
store for better cross-source identity. Playback is still resolved to YouTube
lazily on play (Spotify doesn't hand us a playable stream).
"""

from __future__ import annotations

import base64
import json
import urllib.parse
import urllib.request

from django.conf import settings


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
        return json.loads(r.read())["access_token"]


def _get(url_or_path: str, token: str) -> dict:
    url = url_or_path if url_or_path.startswith("http") else f"{_API}{url_or_path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


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


def _normalize(track: dict) -> dict:
    return {
        "title": track.get("name") or "",
        "artist": ", ".join(a.get("name", "") for a in track.get("artists") or []),
        "duration": track.get("duration_ms"),
        "isrc": (track.get("external_ids") or {}).get("isrc", ""),
    }


def _paginate(first: dict, token: str):
    """Yield items across a paginated Spotify collection (follows `next`)."""
    page = first
    while page:
        yield from page.get("items") or []
        nxt = page.get("next")
        page = _get(nxt, token) if nxt else None


def ingest_with_meta(url: str) -> dict:
    """Return {title, external_id, kind, tracks} for persistence."""
    kind, sid = _classify(url)
    token = _token()

    if kind == "track":
        t = _get(f"/tracks/{sid}", token)
        return {"title": t.get("name") or "", "external_id": sid, "kind": "track",
                "tracks": [_normalize(t)]}

    if kind == "album":
        album = _get(f"/albums/{sid}", token)
        # Album-track items omit external_ids; stamp the album's ISRC-less rows
        # with the album artists as a fallback.
        items = _paginate(album.get("tracks") or {}, token)
        return {"title": album.get("name") or "", "external_id": sid, "kind": "album",
                "tracks": [_normalize(it) for it in items]}

    playlist = _get(f"/playlists/{sid}", token)
    items = _paginate(playlist.get("tracks") or {}, token)
    tracks = [_normalize(it["track"]) for it in items if it.get("track")]
    return {"title": playlist.get("name") or "", "external_id": sid, "kind": "playlist",
            "tracks": tracks}
