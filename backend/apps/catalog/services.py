"""Catalog ingestion services — turn a pasted source URL into persisted rows.

Currently: Apple Music (metadata scrape, no audio). Spotify/YouTube/upload will
add their own `ingest_*` entry points that funnel into the same Track/Playlist
model via the shared normalization (ISRC → match_key).
"""

from __future__ import annotations

from django.db import transaction

from .ingest import applemusic
from .ingest.normalize import make_match_key
from .models import (
    Playlist,
    PlaylistImport,
    PlaylistTrack,
    Source,
    SourceLink,
    Track,
)


@transaction.atomic
def ingest_apple_playlist(url: str, *, user=None, playlist: Playlist | None = None) -> Playlist:
    """Ingest an Apple Music playlist/album/song URL into the catalog.

    - Upserts Tracks (dedupe by match_key; ISRC unavailable from the scrape).
    - Appends them to a Playlist (created if not given) as ordered PlaylistTracks.
    - Records a playlist-level SourceLink (versioned external ref) + a
      PlaylistImport snapshot. Idempotent: re-ingesting the same URL won't
      duplicate Tracks or membership.
    """
    source = Source.objects.get(code=Source.APPLE_MUSIC)
    parsed = applemusic.ingest_with_meta(url)
    tracks = parsed["tracks"]

    if playlist is None:
        playlist = Playlist.objects.create(
            title=parsed["title"] or "Imported playlist",
            created_by=user,
        )

    # Versioned external reference (history, not overwrite).
    SourceLink.objects.update_or_create(
        source=source,
        external_id=parsed["external_id"],
        kind=parsed["kind"],
        defaults={"playlist": playlist, "url": url, "is_active": True},
    )

    start_pos = playlist.items.count()
    for offset, t in enumerate(tracks):
        track, _ = Track.objects.get_or_create(
            match_key=make_match_key(t["title"], t["artist"], t.get("duration")),
            defaults={
                "title": t["title"],
                "primary_artist": t["artist"] or "",
                "duration_ms": t.get("duration"),
            },
        )
        PlaylistTrack.objects.get_or_create(
            playlist=playlist,
            track=track,
            defaults={"position": start_pos + offset, "added_by": user},
        )

    PlaylistImport.objects.create(
        playlist=playlist,
        source=source,
        source_url=url,
        source_external_id=parsed["external_id"],
        imported_by=user,
        track_count=len(tracks),
        status=PlaylistImport.Status.COMPLETED if tracks else PlaylistImport.Status.FAILED,
    )
    return playlist
