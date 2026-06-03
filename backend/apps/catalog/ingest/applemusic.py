"""
Apple Music ingester (free, no developer account).

Parses a public Apple Music playlist/album/song URL into a normalized track
list by reading the page's embedded JSON. `ingest_with_meta` also returns the
collection title + external id + kind for persistence.

Strategy: fetch the public page with a browser UA → parse the
`<script id="serialized-server-data">` JSON (title + artistName + duration per
song) → fall back to JSON-LD MusicPlaylist (names only).

NOTE: scraping is ToS-gray and fragile to Apple page changes; embedded data is
typically capped near ~100 tracks (the tail loads via amp-api pagination).
"""

import html as htmllib
import json
import re
import urllib.request
from urllib.parse import parse_qs, urlparse

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "ignore")


def _walk(obj, out, seen):
    """Collect song objects. Apple uses `title` + `artistName` (+ `duration`);
    some surfaces nest under `attributes` and use `name`."""
    if isinstance(obj, dict):
        node = obj.get("attributes") if isinstance(obj.get("attributes"), dict) else obj
        title = node.get("title") or node.get("name")
        artist = node.get("artistName")
        dur = node.get("duration") or node.get("durationInMillis")
        if title and artist:
            key = (title.strip().lower(), artist.strip().lower())
            if key not in seen:
                seen.add(key)
                sid = obj.get("id") or node.get("id")
                out.append(
                    {
                        "title": title,
                        "artist": artist,
                        "duration": dur,
                        "preview": node.get("previewUrl") or "",  # 30s m4a clip
                        "explicit": bool(node.get("showExplicitBadge")),
                        "_id": str(sid) if sid is not None else None,
                    }
                )
        for v in obj.values():
            _walk(v, out, seen)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, out, seen)


def _from_serialized(html_text):
    m = re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>', html_text, re.S)
    if not m:
        return []
    raw = m.group(1).strip()
    data = None
    for attempt in (raw, htmllib.unescape(raw)):
        try:
            data = json.loads(attempt)
            break
        except Exception:
            continue
    if data is None:
        return []
    out, seen = [], set()
    _walk(data, out, seen)
    return out


def _from_ldjson(html_text):
    out = []
    for blk in re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html_text, re.S
    ):
        try:
            d = json.loads(blk)
        except Exception:
            continue
        for t in d.get("track") or []:
            ba = t.get("byArtist")
            artist = (
                ba.get("name") if isinstance(ba, dict) else (ba if isinstance(ba, str) else None)
            )
            if t.get("name"):
                out.append({"title": t["name"], "artist": artist, "duration": None, "_id": None})
    return out


def _extract_title(html_text):
    m = re.search(r'<meta property="og:title" content="([^"]+)"', html_text)
    return htmllib.unescape(m.group(1)).strip() if m else ""


def _extract_album_name(html_text):
    """Clean album name from JSON-LD's MusicAlbum (structured + locale-independent,
    unlike the og:title '<Album> by <Artists>' display string). Empty for playlists."""
    for blk in re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html_text, re.S
    ):
        try:
            d = json.loads(blk)
        except Exception:
            continue
        if d.get("@type") == "MusicAlbum" and d.get("name"):
            return d["name"]
    return ""


def _extract_image(html_text):
    """The collection cover (og:image is a wide social card — rebuild the same
    mzstatic asset as a square 300px cover). Apple album songs share this cover;
    playlist songs fall back to the playlist cover."""
    m = re.search(r'<meta property="og:image" content="([^"]+)"', html_text)
    if not m:
        return ""
    url = htmllib.unescape(m.group(1))
    if "mzstatic.com/image/thumb/" in url:
        return url.rsplit("/", 1)[0] + "/300x300bb.jpg"
    return url


def _classify(url: str):
    """Return (kind, external_id) from an Apple Music URL.

    /playlist/<slug>/<pl.id>           -> ("playlist", pl.id)
    /album/<slug>/<albumId>            -> ("album", albumId)
    /album/<slug>/<albumId>?i=<songId> -> ("track",  songId)
    """
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    song_id = (parse_qs(parsed.query).get("i") or [None])[0]
    last = parts[-1] if parts else ""
    if "playlist" in parts:
        return "playlist", last
    if "album" in parts:
        return ("track", song_id) if song_id else ("album", last)
    return "playlist", last


def _tracks(url: str):
    html_text = fetch(url)
    tracks = _from_serialized(html_text) or _from_ldjson(html_text)
    song_id = (parse_qs(urlparse(url).query).get("i") or [None])[0]
    if song_id:
        one = [t for t in tracks if t.get("_id") and t["_id"].split(" - ")[-1].strip() == song_id]
        if one:
            tracks = one
    title = _extract_title(html_text)
    image = _extract_image(html_text)
    album = _extract_album_name(html_text)
    return title, image, album, tracks


def ingest(url: str):
    """Back-compat: return just the normalized track list (drops internal id)."""
    _, _, _, tracks = _tracks(url)
    for t in tracks:
        t.pop("_id", None)
    return tracks


def ingest_with_meta(url: str) -> dict:
    """Return {title, external_id, kind, tracks} for persistence. Tracks inherit
    the collection cover as artwork; album/track imports inherit the album name."""
    kind, external_id = _classify(url)
    title, image, album, tracks = _tracks(url)
    for t in tracks:
        t.pop("_id", None)
        if image:
            t["artwork"] = image
        if album:
            t["album"] = album
    return {"title": title, "external_id": external_id, "kind": kind, "tracks": tracks}
