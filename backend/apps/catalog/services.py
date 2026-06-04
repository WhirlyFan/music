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
def create_playlist_from_tracks(*, user, title: str, track_ids, artwork_url: str = "") -> Playlist:
    """Create an owned, named playlist from a list of track ids (in order).
    Unknown ids are skipped; duplicates collapse to first position. The playlist's
    own cover is used if given, else the first track that has artwork."""
    by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
    if not artwork_url:
        for tid in track_ids:
            t = by_id.get(str(tid))
            if t and t.artwork_url:
                artwork_url = t.artwork_url
                break
    playlist = Playlist.objects.create(title=title, created_by=user, artwork_url=artwork_url)
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
    """Get-or-create a Track from a normalized ingest row (dedupe by match_key).

    Metadata is combined across sources: a track first seen via one source (say
    keyless Spotify, no album art) is enriched when re-imported from a richer one
    (Apple/Spotify API) — we fill any field the stored track is still missing."""
    track, created = Track.objects.get_or_create(
        match_key=make_match_key(row["title"], row.get("artist"), row.get("duration")),
        defaults={
            "title": row["title"],
            "primary_artist": row.get("artist") or "",
            "duration_ms": row.get("duration"),
            "isrc": row.get("isrc") or "",  # Spotify supplies this; others don't
            "artwork_url": row.get("artwork") or "",
            "album_name": row.get("album") or "",
            "is_explicit": bool(row.get("explicit")),
            "preview_url": row.get("preview") or "",
            "source_url": row.get("source_url") or "",
        },
    )
    if not created:
        # Backfill only blanks — never overwrite metadata we already have.
        blanks = {
            "artwork_url": row.get("artwork"),
            "album_name": row.get("album"),
            "isrc": row.get("isrc"),
            "preview_url": row.get("preview"),
            "source_url": row.get("source_url"),
        }
        updates = {f: v for f, v in blanks.items() if v and not getattr(track, f)}
        if row.get("explicit") and not track.is_explicit:
            updates["is_explicit"] = True
        if updates:
            for f, v in updates.items():
                setattr(track, f, v)
            track.save(update_fields=list(updates))
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
    track_kind = SourceLink.Kind.VIDEO if source.code == Source.YOUTUBE else SourceLink.Kind.TRACK
    tracks = []
    for row in rows:
        track = _upsert_track(row)
        # Store this song's own link on this source, so we can refer to (and
        # re-resolve) it per source later — independent of the collection link.
        if row.get("external_id"):
            SourceLink.objects.update_or_create(
                source=source,
                external_id=row["external_id"],
                kind=track_kind,
                defaults={"url": row.get("source_url") or "", "track": track, "is_active": True},
            )
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
    return {
        "import": imp,
        "title": parsed["title"] or "Imported",
        "tracks": tracks,
        "cover": parsed.get("cover") or "",  # the collection's own artwork
    }


def ingest_apple(url: str, *, user=None) -> dict:
    """Apple Music playlist/album/song → loose Tracks (matched to YouTube on play)."""
    return _record(Source.objects.get(code=Source.APPLE_MUSIC), applemusic.ingest_with_meta(url), url, user=user)


def ingest_spotify(url: str, *, user=None) -> dict:
    """Spotify playlist/album/track → loose Tracks (matched to YouTube on play).
    API-first (full list + ISRC when creds are set); falls back to the keyless embed
    scrape when the API refuses, returns nothing, or caps a playlist — keeping the
    larger read. No partial warning: we just recover as many tracks as we can."""
    parsed = spotify.ingest_with_meta(url)
    return _record(Source.objects.get(code=Source.SPOTIFY), parsed, url, user=user)


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


def search_songs(query: str, *, limit: int = 20) -> list[Track]:
    """Global song search: find songs on Spotify and upsert them as global catalog
    Tracks, so they can be played (YouTube audio is matched lazily on play, like any
    other track). Returns the Tracks in Spotify's relevance order. Empty query → []."""
    if not query.strip():
        return []
    return [_upsert_track(row) for row in spotify.search_tracks(query, limit=limit)]
