"""Resolve a Track to a YouTube PlaybackSource (search + duration verification).

Writes the top candidates as PlaybackSource rows and promotes the best to
`active`. Pure metadata — no audio is downloaded here (that's Phase 3).
"""

from __future__ import annotations

from django.db import transaction

from .ingest import youtube
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


@transaction.atomic
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
    return best


@transaction.atomic
def set_manual_youtube_source(track: Track, video_id: str, *, user=None) -> PlaybackSource:
    """Correction: make `video_id` the track's active source (manual, sticky)."""
    track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).update(
        status=PlaybackSource.Status.REPLACED
    )
    return PlaybackSource.objects.create(
        track=track,
        source=Source.objects.get(code=Source.YOUTUBE),
        locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
        locator=video_id,
        origin=PlaybackSource.Origin.MATCHED_MANUAL,
        status=PlaybackSource.Status.ACTIVE,
        selected_by=user,
    )


@transaction.atomic
def promote_candidate(playback_source: PlaybackSource, *, user=None) -> PlaybackSource:
    """Correction: promote an existing candidate row to active (manual)."""
    track = playback_source.track
    track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).exclude(
        pk=playback_source.pk
    ).update(status=PlaybackSource.Status.REPLACED)
    playback_source.status = PlaybackSource.Status.ACTIVE
    playback_source.origin = PlaybackSource.Origin.MATCHED_MANUAL
    playback_source.selected_by = user
    playback_source.save(update_fields=["status", "origin", "selected_by", "updated_at"])
    return playback_source
