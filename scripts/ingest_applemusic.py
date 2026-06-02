#!/usr/bin/env python3
"""
Apple Music playlist ingester (free, no developer account).

Pastes-in an Apple Music playlist URL and returns a normalized track list
[{title, artist, duration_ms}] by parsing the public page's embedded JSON.

Strategy:
  1. Fetch the public playlist page with a browser User-Agent.
  2. Parse the <script id="serialized-server-data"> JSON (has name + artistName
     + durationInMillis per song) — the reliable source.
  3. Fall back to the JSON-LD MusicPlaylist block (names only) if needed.

Usage: python3 scripts/ingest_applemusic.py "<apple music playlist url>"

NOTE: scraping is ToS-gray and fragile to Apple page changes; embedded data is
typically capped near ~100 tracks (the tail loads via amp-api pagination).
"""
import sys, re, json
import html as htmllib
import urllib.request
from urllib.parse import urlparse, parse_qs

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "ignore")


def _walk(obj, out, seen):
    """Recursively collect song objects. Apple's serialized data uses
    `title` + `artistName` (+ `duration`); some surfaces nest under
    `attributes` and use `name` — handle both."""
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
                out.append({"title": title, "artist": artist, "duration": dur,
                            "_id": str(sid) if sid is not None else None})
        for v in obj.values():
            _walk(v, out, seen)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, out, seen)


def from_serialized(html_text):
    m = re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>',
                  html_text, re.S)
    if not m:
        return []
    raw = m.group(1).strip()
    data = None
    for attempt in (raw, htmllib.unescape(raw)):
        try:
            data = json.loads(attempt); break
        except Exception:
            continue
    if data is None:
        return []
    out, seen = [], set()
    _walk(data, out, seen)
    return out


def from_ldjson(html_text):
    out = []
    for blk in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                          html_text, re.S):
        try:
            d = json.loads(blk)
        except Exception:
            continue
        for t in (d.get("track") or []):
            ba = t.get("byArtist")
            artist = ba.get("name") if isinstance(ba, dict) else (ba if isinstance(ba, str) else None)
            if t.get("name"):
                out.append({"title": t["name"], "artist": artist, "duration_ms": None})
    return out


def ingest(url: str):
    h = fetch(url)
    tracks = from_serialized(h) or from_ldjson(h)
    # If the URL targets a single song (album/...?i=<songId>), return just that one.
    song_id = (parse_qs(urlparse(url).query).get("i") or [None])[0]
    if song_id:
        one = [t for t in tracks if t.get("_id")
               and t["_id"].split(" - ")[-1].strip() == song_id]
        if one:
            tracks = one
    for t in tracks:
        t.pop("_id", None)
    return tracks


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: ingest_applemusic.py <apple music playlist url>"); sys.exit(1)
    tracks = ingest(sys.argv[1])
    print(f"# {len(tracks)} tracks")
    print(json.dumps(tracks[:12], indent=2, ensure_ascii=False))
