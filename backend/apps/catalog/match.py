"""Resolve a Track to a YouTube PlaybackSource (search + duration verification).

Writes the top candidates as PlaybackSource rows and promotes the best to
`active`. Pure metadata — no audio is downloaded here (that's Phase 3).
"""

from __future__ import annotations

from .ingest import applemusic, spotify, youtube
from .models import PlaybackSource, Source, Track

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


def match_track_to_youtube(track: Track, *, n: int = 5, query: str | None = None):
    """Search YouTube for `track`, persist candidates, promote the best to active.

    Idempotent: returns None (does nothing) if the track already has an active
    playback source. Returns the active PlaybackSource on success, else None.
    """
    if track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).exists():
        return None

    source = Source.objects.get(code=Source.YOUTUBE)
    candidates = youtube.search(query or f"{track.title} {track.primary_artist}", n=n)
    if not candidates:
        return None

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
