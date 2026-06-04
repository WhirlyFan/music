"""Keyless full-playlist reads via Apple Music's internal **amp-api**.

The public Apple Music page embeds only ~100 tracks (`serialized-server-data`); the
web player loads the rest from `amp-api.music.apple.com` using a bearer JWT baked
into the web app's JS bundle. We reuse that token — no Apple developer account — to
read *any* public catalog playlist in full, paginated, **with ISRC**.

Self-heals where it can: the token is cached and re-extracted on a 401/403. The two
things that can break it are Apple rotating the embedded token format or the amp-api
shape — when that happens `applemusic.py` falls back to the embed scrape (≤100). No
account, no key, no human step in the normal path."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from django.core.cache import cache

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_AMP = "https://amp-api.music.apple.com"
# The web app's JS bundles live under music.apple.com; the bearer JWT is embedded in
# one of them. `/browse` is a stable, lightweight page that references the bundles.
_BOOTSTRAP = "https://music.apple.com/us/browse"
_JWT_RE = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+")  # an ES256 JWT (header.payload.sig)
_PAGE = 100  # amp-api's max items per playlist-tracks page


class AppleMusicWebError(Exception):
    """amp-api/token failure → caller falls back to the embed scrape."""


def _get(url: str, token: str | None = None, timeout: int = 20) -> str:
    headers = {"User-Agent": _UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["Origin"] = "https://music.apple.com"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def _extract_token() -> str:
    """Pull the web player's bearer JWT out of the music.apple.com JS bundle."""
    html = _get(_BOOTSTRAP)
    m = _JWT_RE.search(html)
    if m:
        return m.group(0)
    for src in re.findall(r'<script[^>]+src="([^"]+\.js)"', html):
        bundle = src if src.startswith("http") else f"https://music.apple.com{src}"
        try:
            js = _get(bundle)
        except urllib.error.HTTPError, urllib.error.URLError:
            continue
        m = _JWT_RE.search(js)
        if m:
            return m.group(0)
    raise AppleMusicWebError("could not extract the Apple Music web token")


def _token(force: bool = False) -> str:
    if not force:
        cached = cache.get("applemusic:web:token")
        if cached:
            return cached
    token = _extract_token()
    cache.set("applemusic:web:token", token, 12 * 3600)  # JWT is long-lived; refresh daily
    return token


def _amp_json(path: str) -> dict:
    """GET an amp-api path with the web token; re-extract once on 401/403."""
    try:
        return json.loads(_get(f"{_AMP}{path}", _token()))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            try:
                return json.loads(_get(f"{_AMP}{path}", _token(force=True)))
            except urllib.error.HTTPError as e2:
                raise AppleMusicWebError(f"amp-api failed ({e2.code})") from e2
        raise AppleMusicWebError(f"amp-api failed ({e.code})") from e
    except urllib.error.URLError as e:
        raise AppleMusicWebError(f"amp-api unreachable ({e.reason})") from e


def _art(artwork: dict | None, size: int = 300) -> str:
    """Apple artwork is a {w}x{h} template URL — render it at `size`px square."""
    url = (artwork or {}).get("url")
    return url.replace("{w}", str(size)).replace("{h}", str(size)) if url else ""


def _normalize(item: dict, storefront: str) -> dict | None:
    a = item.get("attributes") or {}
    if not a.get("name"):
        return None  # unavailable/region-locked entry
    sid = item.get("id") or ""
    return {
        "title": a.get("name") or "",
        "artist": a.get("artistName") or "",
        "duration": a.get("durationInMillis"),
        "isrc": a.get("isrc") or "",
        "artwork": _art(a.get("artwork")),
        "album": a.get("albumName") or "",
        "explicit": a.get("contentRating") == "explicit",
        "preview": ((a.get("previews") or [{}])[0]).get("url") or "",
        "external_id": sid,
        "source_url": a.get("url")
        or (f"https://music.apple.com/{storefront}/song/{sid}" if sid else ""),
    }


def fetch_playlist(storefront: str, pid: str) -> dict:
    """Full playlist via amp-api (paginated, any length, with ISRC). Returns
    {title, external_id, kind, tracks, cover}. Raises AppleMusicWebError on any
    token/api failure (→ caller falls back to the scrape)."""
    meta = _amp_json(f"/v1/catalog/{storefront}/playlists/{pid}?l=en-US")
    data = meta.get("data") or []
    if not data:
        raise AppleMusicWebError("playlist not found")
    attr = data[0].get("attributes") or {}

    items: list[dict] = []
    path: str | None = f"/v1/catalog/{storefront}/playlists/{pid}/tracks?limit={_PAGE}&offset=0"
    while path:
        page = _amp_json(path)
        items.extend(page.get("data") or [])
        path = page.get("next")  # amp-api returns a relative path or None

    tracks = [row for row in (_normalize(it, storefront) for it in items) if row]
    return {
        "title": attr.get("name") or "Apple Music import",
        "external_id": pid,
        "kind": "playlist",
        "tracks": tracks,
        "cover": _art(attr.get("artwork")),
    }
