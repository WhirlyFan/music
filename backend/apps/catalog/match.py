"""Resolve a Track to a YouTube PlaybackSource (search + duration verification).

Writes the top candidates as PlaybackSource rows and promotes the best to
`active`. Pure metadata — no audio is downloaded here (that's Phase 3).
"""

from __future__ import annotations

import logging

from .ingest import applemusic, spotify
from .models import PlaybackSource, Source, Track

log = logging.getLogger(__name__)

# A duration this far off (ms) scores zero — filters covers / extended edits.
_DURATION_TOLERANCE_MS = 30_000


def _score(track: Track, cand: dict) -> tuple[float, int | None]:
    """(confidence 0..1, duration_delta_ms or None). Duration closeness is the
    primary signal; a title containing the track title is a soft bonus."""
    cand_dur = cand.get("duration_sec")
    if track.duration_ms and cand_dur:
        delta_ms = abs(cand_dur * 1000 - track.duration_ms)
        dur_score = max(0.0, 1 - delta_ms / _DURATION_TOLERANCE_MS)
    else:
        delta_ms = None
        dur_score = 0.5  # unknown duration — neutral
    title_hit = 1.0 if track.title.lower() in (cand.get("title") or "").lower() else 0.6
    return round(dur_score * title_hit, 4), delta_ms


def _origin_artwork(source_url: str) -> str:
    """The track's REAL cover from its origin (Spotify track API, or the Apple song
    page's og:image). Best-effort: '' on any failure so play is never blocked."""
    u = source_url or ""
    if "open.spotify.com/track/" in u:
        try:
            sid = u.split("/track/")[1].split("?")[0].strip("/")
            t = spotify._get(f"/tracks/{sid}", spotify._token())
            return spotify._pick_image((t.get("album") or {}).get("images"))
        except Exception:  # noqa: BLE001 — enrichment only, must never break playback
            return ""
    if "music.apple.com/" in u and "/song/" in u:
        try:
            return applemusic._extract_image(applemusic.fetch(u))
        except Exception:  # noqa: BLE001
            return ""
    return ""


def backfill_artwork(track: Track, video_id: str) -> None:
    """Fill a blank cover on play: prefer the track's own art from its origin
    (Spotify), then fall back to the YouTube thumbnail. Only fills a blank — never
    overwrites — and never raises (artwork is best-effort, playback comes first)."""
    if track.artwork_url:
        return
    art = _origin_artwork(track.source_url)
    if not art and video_id:
        art = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    if art:
        track.artwork_url = art
        track.save(update_fields=["artwork_url"])


def _best_spotify_row(track: Track, rows: list[dict]) -> dict | None:
    """Pick the Spotify result that's really the same recording: closest duration
    within tolerance when we know the track's length, else the top hit only if its
    title overlaps ours. Conservative — better no match than a wrong one."""
    if not rows:
        return None
    if track.duration_ms:
        scored = [(abs((r.get("duration") or 0) - track.duration_ms), r) for r in rows]
        delta, row = min(scored, key=lambda s: s[0])
        if delta <= _DURATION_TOLERANCE_MS:
            return row
    top = rows[0]
    needle = (track.title or "").lower()[:24]
    return top if needle and needle in (top.get("title") or "").lower() else None


def enrich_from_spotify(track: Track) -> bool:
    """Pull real metadata for a YouTube-sourced track from Spotify — album art +
    any *empty* details. Spotify is purely a metadata source here; YouTube stays
    the audio source and the track's provenance (`source_url`), so we never touch
    that. Searches by title + artist; on a confident match takes the album art (the
    point of a cover refresh) and fills only blank fields (album / isrc / preview).
    Returns True if anything was applied. Never raises — opportunistic enrichment,
    triggered by an explicit refresh (not on play)."""
    query = " ".join(p for p in (track.title, track.primary_artist) if p).strip()
    if not query:
        return False
    try:
        rows = spotify.search_tracks(query, limit=5)
    except Exception:  # noqa: BLE001 — Spotify down / not configured; leave the track as-is
        log.warning("spotify enrich search failed for %s", track.id, exc_info=True)
        return False
    best = _best_spotify_row(track, rows)
    if best is None:
        return False
    updates: dict = {}
    if best.get("artwork"):
        updates["artwork_url"] = best["artwork"]  # the point of the refresh — real cover
    for field, key in (("album_name", "album"), ("isrc", "isrc"), ("preview_url", "preview")):
        if best.get(key) and not getattr(track, field):
            updates[field] = best[key]
    if not updates:
        return False
    for field, value in updates.items():
        setattr(track, field, value)
    track.save(update_fields=[*updates, "updated_at"])
    return True


def match_track_to_youtube(track: Track, *, candidates: list[dict] | None = None):
    """Score YouTube `candidates` for `track`, persist them, promote the best to active.

    `candidates` is a list of {video_id, title, uploader, duration_sec} dicts, run by
    the desktop's yt-dlp search on the user's own IP. The cloud only scores +
    persists — it never calls YouTube. No candidates → no match.

    Idempotent: returns None (does nothing) if the track already has an active
    playback source. Returns the active PlaybackSource on success, else None.
    """
    if track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).exists():
        return None

    if not candidates:
        return None
    source = Source.objects.get(code=Source.YOUTUBE)

    scored = []
    for c in candidates:
        score, delta_ms = _score(track, c)
        scored.append(
            (
                score,
                PlaybackSource(
                    track=track,
                    source=source,
                    locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
                    locator=c["video_id"],
                    title=(c.get("title") or "")[:512],
                    uploader=(c.get("uploader") or "")[:512],
                    duration_ms=(c["duration_sec"] * 1000 if c.get("duration_sec") else None),
                    origin=PlaybackSource.Origin.MATCHED_AUTO,
                    confidence=score,
                    duration_delta_ms=delta_ms,
                    status=PlaybackSource.Status.CANDIDATE,
                ),
            )
        )

    scored.sort(key=lambda s: s[0], reverse=True)
    best = scored[0][1]
    best.status = PlaybackSource.Status.ACTIVE  # exactly one active (DB-enforced)
    PlaybackSource.objects.bulk_create([ps for _, ps in scored])
    backfill_artwork(track, best.locator)
    return best
