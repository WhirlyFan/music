"""Keyless full-playlist reads via the Spotify *web-player* internal API.

The official Web API won't return another user's playlist tracks to a
client-credentials app (HTTP 403 since Spotify's 2024 dev-mode lockdown), and the
public embed caps at ~100 tracks. So for playlists we read the same private GraphQL
("pathfinder") endpoint the open.spotify.com web player uses — it reads *any* public
playlist, any length, with **no account**: an anonymous bearer token is minted from
the web player's rotating TOTP scheme, then `fetchPlaylist` is paginated (343/page).

This is unofficial and self-heals where it can (the TOTP secret is fetched live with
a baked-in fallback; the access token auto-mints and caches to expiry). The two things
that can still break it are a Spotify rotation of the **TOTP secret scheme** or the
**persisted-query hash** below — when that happens pathfinder errors and `spotify.py`
falls back to the keyless embed scrape (≤100 tracks) while the constant is bumped.
No credentials, no cookie, no human step in the normal path."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from django.core.cache import cache


class SpotifyWebError(Exception):
    """Pathfinder/token failure → caller falls back to the embed scrape."""


class PlaylistNotFound(SpotifyWebError):
    """Playlist is private or deleted — unreadable without the owner's session."""


_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_TOKEN_URL = "https://open.spotify.com/api/token"
_PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query"
_SECRETS_URL = (
    "https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json"
)
# Persisted-query hash for the web player's `fetchPlaylist` operation. If Spotify
# bumps it, pathfinder 400s and ingest falls back to the embed scrape — refresh this
# constant from the web-player JS bundle to restore full reads.
_FETCH_PLAYLIST_HASH = "a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4"
# Fallback TOTP secret (web-player version) used only if the live secret list is
# unreachable; the live list is preferred so rotations self-heal.
_FALLBACK_SECRET = (
    61,
    bytes([44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111,
           120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78]),
)  # fmt: skip
_PAGE = 343  # Spotify's max items per pathfinder playlist page


def _http_json(req: urllib.request.Request, timeout: int = 15) -> dict:
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _totp_secret() -> tuple[int, bytes]:
    """Latest web-player TOTP secret (version, bytes), live with a baked-in fallback."""
    cached = cache.get("spotify:web:totp_secret")
    if cached:
        return cached
    try:
        req = urllib.request.Request(_SECRETS_URL, headers={"User-Agent": _UA})
        secrets = _http_json(req, timeout=8)
        version = max(secrets, key=int)
        secret = (int(version), bytes(secrets[version]))
    except Exception:
        secret = _FALLBACK_SECRET
    cache.set("spotify:web:totp_secret", secret, 15 * 60)
    return secret


def _totp() -> tuple[str, int]:
    """The web player's TOTP code + secret version (RFC 6238, SHA-1, 6 digits/30s)."""
    version, secret_bytes = _totp_secret()
    transformed = [b ^ ((i % 33) + 9) for i, b in enumerate(secret_bytes)]
    joined = "".join(str(n) for n in transformed)
    b32 = base64.b32encode(bytes.fromhex(joined.encode().hex())).decode().rstrip("=")
    key = base64.b32decode(b32 + "=" * (-len(b32) % 8))
    counter = struct.pack(">Q", int(time.time()) // 30)
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}", version


def _token() -> str:
    """Anonymous web-player access token, cached to its expiry."""
    cached = cache.get("spotify:web:token")
    if cached:
        return cached
    totp, version = _totp()
    params = urllib.parse.urlencode(
        {
            "reason": "init",
            "productType": "web-player",
            "totp": totp,
            "totpVer": version,
            "totpServer": totp,
        }
    )
    req = urllib.request.Request(f"{_TOKEN_URL}?{params}", headers={"User-Agent": _UA})
    try:
        body = _http_json(req)
    except urllib.error.HTTPError as e:
        raise SpotifyWebError(f"web-player token mint failed ({e.code})") from e
    token = body.get("accessToken")
    if not token:
        raise SpotifyWebError("web-player token response had no accessToken")
    exp = float(body.get("accessTokenExpirationTimestampMs") or 0) / 1000
    ttl = max(60, int(exp - time.time()) - 30) if exp else 600
    cache.set("spotify:web:token", token, ttl)
    return token


def _query(operation: str, variables: dict, sha256: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "operationName": operation,
            "variables": json.dumps(variables),
            "extensions": json.dumps({"persistedQuery": {"version": 1, "sha256Hash": sha256}}),
        }
    )
    req = urllib.request.Request(
        f"{_PATHFINDER}?{params}",
        data=b"",  # POST with query-string params (how the web player calls it)
        method="POST",
        headers={
            "User-Agent": _UA,
            "Authorization": f"Bearer {_token()}",
            "Content-Type": "application/json;charset=UTF-8",
            "Accept-Language": "en",
        },
    )
    try:
        return _http_json(req)
    except urllib.error.HTTPError as e:
        raise SpotifyWebError(f"pathfinder {operation} failed ({e.code})") from e


def _pick_image(sources: list, target: int = 300) -> str:
    """URL of the cover source closest to `target` px (sources may have null sizes)."""
    sized = [s for s in sources or [] if s.get("url")]
    if not sized:
        return ""
    return min(sized, key=lambda s: abs((s.get("width") or 0) - target))["url"]


def _normalize(item: dict) -> dict | None:
    """One pathfinder playlist item → our normalized track row (no ISRC: the bulk
    payload omits it; matching dedupes on title+artist+duration anyway)."""
    td = (item.get("itemV2") or {}).get("data") or {}
    if not td.get("name"):
        return None  # unavailable/removed track (local file, region-locked, …)
    uri = td.get("uri") or ""
    sid = uri.split(":")[-1] if uri.startswith("spotify:track:") else ""
    album = td.get("albumOfTrack") or {}
    return {
        "title": td.get("name") or "",
        "artist": ", ".join(
            a.get("profile", {}).get("name", "")
            for a in (td.get("artists") or {}).get("items") or []
        ),
        "duration": (td.get("trackDuration") or {}).get("totalMilliseconds"),
        "isrc": "",
        "artwork": _pick_image((album.get("coverArt") or {}).get("sources")),
        "album": album.get("name") or "",
        "explicit": (td.get("contentRating") or {}).get("label") == "EXPLICIT",
        "preview": "",
        "external_id": sid,
        "source_url": f"https://open.spotify.com/track/{sid}" if sid else "",
    }


def fetch_playlist(sid: str) -> dict:
    """Full playlist via the web-player pathfinder API (paginated, any length).

    Returns {title, external_id, kind, tracks, cover}. Raises PlaylistNotFound for a
    private/deleted playlist, SpotifyWebError on any token/protocol failure."""

    def page(offset: int) -> dict:
        return _query(
            "fetchPlaylist",
            {
                "uri": f"spotify:playlist:{sid}",
                "offset": offset,
                "limit": _PAGE,
                "enableWatchFeedEntrypoint": False,
            },
            _FETCH_PLAYLIST_HASH,
        )

    pl = (page(0).get("data") or {}).get("playlistV2") or {}
    if pl.get("__typename") == "NotFound" or "content" not in pl:
        raise PlaylistNotFound(sid)
    content = pl.get("content") or {}
    total = content.get("totalCount") or 0
    items = list(content.get("items") or [])
    offset = _PAGE
    while offset < total:
        more = ((page(offset).get("data") or {}).get("playlistV2") or {}).get("content") or {}
        items.extend(more.get("items") or [])
        offset += _PAGE
    tracks = [row for row in (_normalize(it) for it in items) if row]
    images = (pl.get("images") or {}).get("items") or [{}]
    return {
        "title": (pl.get("name") or "").strip() or "Spotify import",
        "external_id": sid,
        "kind": "playlist",
        "tracks": tracks,
        "cover": _pick_image(images[0].get("sources")),
    }
