"""Catalog ingestion services — turn a pasted source URL into persisted rows.

Ingest is **decoupled from playlists**: pasting a URL yields loose Tracks (plus
provenance), and the caller decides what to do with them — play, queue, or save
as a playlist. Currently Apple Music (metadata scrape, no audio); Spotify/
YouTube/upload will add their own `ingest_*` entry points funnelling into the
same Track model via the shared normalization (ISRC → match_key).
"""

from __future__ import annotations

from urllib.parse import urlparse

from django.db import transaction

from .ingest import applemusic, spotify, youtube
from .ingest.normalize import make_match_key
from .models import (
    PlaybackSource,
    Playlist,
    PlaylistImport,
    PlaylistTrack,
    Source,
    SourceLink,
    Track,
)


class UnsupportedSourceError(ValueError):
    """The pasted URL isn't a supported source (Apple Music / Spotify / YouTube)."""


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


def _upsert_track(row: dict) -> Track:
    """Get-or-create a Track from a normalized ingest row (dedupe by match_key)."""
    track, _ = Track.objects.get_or_create(
        match_key=make_match_key(row["title"], row.get("artist"), row.get("duration")),
        defaults={
            "title": row["title"],
            "primary_artist": row.get("artist") or "",
            "duration_ms": row.get("duration"),
            "isrc": row.get("isrc") or "",  # Spotify supplies this; others don't
        },
    )
    return track


@transaction.atomic
def _record(source: Source, parsed: dict, url: str, *, user=None, on_track=None) -> dict:
    """Shared ingest tail: versioned SourceLink + upsert Tracks (loose, no
    playlist) + a PlaylistImport snapshot. `on_track(track, row)` lets a source
    attach extra data (YouTube sets the playback source directly). Idempotent.

    Returns {"import": PlaylistImport, "title": str, "tracks": [Track, ...]}.
    """
    rows = parsed["tracks"]
    SourceLink.objects.update_or_create(
        source=source,
        external_id=parsed["external_id"],
        kind=parsed["kind"],
        defaults={"url": url, "is_active": True},
    )
    tracks = []
    for row in rows:
        track = _upsert_track(row)
        if on_track is not None:
            on_track(track, row)
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


def ingest_apple(url: str, *, user=None) -> dict:
    """Apple Music playlist/album/song → loose Tracks (matched to YouTube on play)."""
    return _record(Source.objects.get(code=Source.APPLE_MUSIC), applemusic.ingest_with_meta(url), url, user=user)


def ingest_spotify(url: str, *, user=None) -> dict:
    """Spotify playlist/album/track → loose Tracks (matched to YouTube on play).
    Carries ISRC. Raises spotify.SpotifyError on bad URL / missing credentials."""
    return _record(Source.objects.get(code=Source.SPOTIFY), spotify.ingest_with_meta(url), url, user=user)


def ingest_youtube(url: str, *, user=None) -> dict:
    """YouTube playlist/video → loose Tracks, each with its video as an ACTIVE
    playback source already set (no search/match needed — it's playable now)."""
    yt = Source.objects.get(code=Source.YOUTUBE)

    def set_direct_source(track: Track, row: dict) -> None:
        video_id = row.get("video_id")
        if not video_id:
            return
        if track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).exists():
            return
        PlaybackSource.objects.create(
            track=track,
            source=yt,
            locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
            locator=video_id,
            origin=PlaybackSource.Origin.DIRECT,
            status=PlaybackSource.Status.ACTIVE,
        )

    return _record(yt, youtube.ingest_with_meta(url), url, user=user, on_track=set_direct_source)


def ingest(url: str, *, user=None) -> dict:
    """Dispatch a pasted URL to the right source ingester by host."""
    host = urlparse(url).netloc.lower()
    if "apple.com" in host:
        return ingest_apple(url, user=user)
    if "spotify.com" in host:
        return ingest_spotify(url, user=user)
    if "youtube.com" in host or "youtu.be" in host:
        return ingest_youtube(url, user=user)
    raise UnsupportedSourceError("Paste an Apple Music, Spotify, or YouTube link.")
