"""Catalog ingestion services — turn a pasted source URL into persisted rows.

Ingest is **decoupled from playlists**: pasting a URL yields loose Tracks (plus
provenance), and the caller decides what to do with them — play, queue, or save
as a playlist. Currently Apple Music (metadata scrape, no audio); Spotify/
YouTube/upload will add their own `ingest_*` entry points funnelling into the
same Track model via the shared normalization (ISRC → match_key).
"""

from __future__ import annotations

from django.db import transaction

from .ingest import applemusic
from .ingest.normalize import make_match_key
from .models import Playlist, PlaylistImport, PlaylistTrack, Source, SourceLink, Track


@transaction.atomic
def create_playlist_from_tracks(*, user, title: str, track_ids) -> Playlist:
    """Create an owned, named playlist from a list of track ids (in order).
    Unknown ids are skipped; duplicates collapse to first position."""
    playlist = Playlist.objects.create(title=title, created_by=user)
    by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
    position = 0
    for tid in track_ids:
        track = by_id.get(str(tid))
        if track is None:
            continue
        _, created = PlaylistTrack.objects.get_or_create(
            playlist=playlist, track=track, defaults={"position": position, "added_by": user}
        )
        if created:
            position += 1
    return playlist


@transaction.atomic
def ingest_apple(url: str, *, user=None) -> dict:
    """Ingest an Apple Music playlist/album/song URL as loose catalog Tracks.

    - Upserts Tracks (dedupe by match_key; ISRC unavailable from the scrape).
    - Records a versioned external `SourceLink` + a `PlaylistImport` snapshot
      (no playlist — this is a loose paste). Idempotent on Tracks.

    Returns {"import": PlaylistImport, "title": str, "tracks": [Track, ...]}
    in source order.
    """
    source = Source.objects.get(code=Source.APPLE_MUSIC)
    parsed = applemusic.ingest_with_meta(url)
    rows = parsed["tracks"]

    # Versioned external reference (history, not overwrite).
    SourceLink.objects.update_or_create(
        source=source,
        external_id=parsed["external_id"],
        kind=parsed["kind"],
        defaults={"url": url, "is_active": True},
    )

    tracks = []
    for t in rows:
        track, _ = Track.objects.get_or_create(
            match_key=make_match_key(t["title"], t["artist"], t.get("duration")),
            defaults={
                "title": t["title"],
                "primary_artist": t["artist"] or "",
                "duration_ms": t.get("duration"),
            },
        )
        tracks.append(track)

    imp = PlaylistImport.objects.create(
        source=source,
        source_url=url,
        source_external_id=parsed["external_id"],
        imported_by=user,
        track_count=len(rows),
        status=PlaylistImport.Status.COMPLETED if rows else PlaylistImport.Status.FAILED,
    )
    return {"import": imp, "title": parsed["title"] or "Imported", "tracks": tracks}
