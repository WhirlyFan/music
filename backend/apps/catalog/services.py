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
from django.utils import timezone

from .ingest import applemusic, spotify, youtube
from .ingest.normalize import make_match_key
from .ingest.spotify import SpotifyError
from .models import (
    PlaybackSource,
    Playlist,
    PlaylistImport,
    PlaylistTrack,
    Source,
    SourceLink,
    SourcePlaylist,
    SourcePlaylistTrack,
    Track,
)


class UnsupportedSourceError(ValueError):
    """The pasted URL isn't a supported source (Apple Music / Spotify / YouTube)."""


@transaction.atomic
def create_playlist_from_tracks(
    *, user, title: str, track_ids, artwork_url: str = "", origin: SourcePlaylist | None = None
) -> Playlist:
    """Create an owned, named playlist from a list of track ids (in order).
    Unknown ids are skipped; duplicates collapse to first position. The playlist's
    own cover is used if given, else the first track that has artwork. `origin` stamps
    the SourcePlaylist it was forked from (+ its snapshot) so it can be refreshed."""
    by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
    if not artwork_url:
        for tid in track_ids:
            t = by_id.get(str(tid))
            if t and t.artwork_url:
                artwork_url = t.artwork_url
                break
    playlist = Playlist.objects.create(
        title=title,
        created_by=user,
        artwork_url=artwork_url,
        origin=origin,
        origin_snapshot_id=origin.snapshot_id if origin else "",
    )
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


@transaction.atomic
def _cache_source_playlist(
    source: Source, external_id: str, parsed: dict, url: str
) -> SourcePlaylist:
    """Upsert the shared SourcePlaylist cache + its ordered membership from a fresh
    fetch. Tracks dedupe globally (so cached YouTube matches carry over); membership
    is rebuilt to mirror the source. Runs only on a cache miss / refresh."""
    sp, _ = SourcePlaylist.objects.update_or_create(
        source=source,
        external_id=external_id,
        defaults={
            "url": url,
            "title": parsed.get("title") or "",
            "owner_name": parsed.get("owner_name") or "",
            "owner_url": parsed.get("owner_url") or "",
            "cover_url": parsed.get("cover") or "",
            "snapshot_id": parsed.get("snapshot") or "",
            "last_fetched_at": timezone.now(),
        },
    )
    SourcePlaylistTrack.objects.filter(source_playlist=sp).delete()  # rebuild to mirror source
    seen: set = set()
    position = 0
    for row in parsed["tracks"]:
        track = _upsert_track(row)
        if track.id in seen:
            continue  # source listed the same song twice — keep one (like a user playlist)
        seen.add(track.id)
        SourcePlaylistTrack.objects.create(source_playlist=sp, track=track, position=position)
        position += 1
        if row.get("external_id"):  # per-track source link, so we can re-resolve later
            SourceLink.objects.update_or_create(
                source=source,
                external_id=row["external_id"],
                kind=SourceLink.Kind.TRACK,
                defaults={"url": row.get("source_url") or "", "track": track, "is_active": True},
            )
    sp.track_count = position
    sp.save(update_fields=["track_count", "updated_at"])
    return sp


def _import_from_source_playlist(sp: SourcePlaylist, *, url: str, user=None) -> dict:
    """Build an import result from the cached SourcePlaylist (no source API). Logs a
    PlaylistImport for provenance (who pulled it, when, at which snapshot)."""
    imp = PlaylistImport.objects.create(
        source=sp.source,
        source_url=url,
        source_external_id=sp.external_id,
        source_snapshot_id=sp.snapshot_id,
        imported_by=user,
        track_count=sp.track_count,
        status=PlaylistImport.Status.COMPLETED if sp.track_count else PlaylistImport.Status.FAILED,
    )
    tracks = [
        it.track
        for it in sp.items.select_related("track")
        .prefetch_related("track__playback_sources")
        .order_by("position")
    ]
    return {
        "import": imp,
        "title": sp.title or "Imported",
        "tracks": tracks,
        "cover": sp.cover_url,
        "source_playlist": sp,
    }


def _ingest_collection(source_code: str, module, url: str, *, user=None) -> dict:
    """Spotify/Apple ingest. **Playlists** resolve through the shared SourcePlaylist
    cache — the first import of a URL fetches + stores it; later imports of the same
    URL (by anyone) ride the cache with zero source API calls. Albums/tracks stay on
    the loose-track path. Refresh (services.refresh_playlist) re-fetches on demand."""
    source = Source.objects.get(code=source_code)
    try:
        kind, external_id = module._classify(url)  # cheap, no network
    except SpotifyError:  # only spotify._classify raises; applemusic returns a fallback
        kind, external_id = None, None
    if kind == "playlist" and external_id:
        sp = SourcePlaylist.objects.filter(source=source, external_id=external_id).first()
        if not (sp and sp.items.exists()):  # cache miss → fetch once + store
            sp = _cache_source_playlist(source, external_id, module.ingest_with_meta(url), url)
        return _import_from_source_playlist(sp, url=url, user=user)
    return _record(source, module.ingest_with_meta(url), url, user=user)


def ingest_apple(url: str, *, user=None) -> dict:
    """Apple Music playlist/album/song → loose Tracks (matched to YouTube on play).
    Playlists ride the SourcePlaylist cache (see _ingest_collection)."""
    return _ingest_collection(Source.APPLE_MUSIC, applemusic, url, user=user)


def ingest_spotify(url: str, *, user=None) -> dict:
    """Spotify playlist/album/track → loose Tracks (matched to YouTube on play).
    Playlists ride the SourcePlaylist cache; albums/tracks use the API-first path
    (full list + ISRC) with the keyless scrape as fallback. See _ingest_collection."""
    return _ingest_collection(Source.SPOTIFY, spotify, url, user=user)


def ingest_youtube(url: str, *, user=None, metadata: dict | None = None) -> dict:
    """YouTube playlist/video → loose Tracks, each with its video as an ACTIVE
    playback source already set (no search/match needed — it's playable now).

    `metadata` is the desktop's yt-dlp extraction (the shape of
    `youtube.ingest_with_meta()`), run on the user's own IP. When omitted we fall
    back to a cloud-side extraction (legacy — the cloud should not call YouTube)."""
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

    parsed = metadata if metadata is not None else youtube.ingest_with_meta(url)
    return _record(yt, parsed, url, user=user, on_track=set_direct_source)


def ingest(url: str, *, user=None, youtube_metadata: dict | None = None) -> dict:
    """Dispatch a pasted URL to the right source ingester by host. `youtube_metadata`
    (desktop-supplied yt-dlp extraction) is used only for YouTube URLs."""
    host = urlparse(url).netloc.lower()
    if "apple.com" in host:
        return ingest_apple(url, user=user)
    if "spotify.com" in host:
        return ingest_spotify(url, user=user)
    if "youtube.com" in host or "youtu.be" in host:
        return ingest_youtube(url, user=user, metadata=youtube_metadata)
    raise UnsupportedSourceError("Paste an Apple Music, Spotify, or YouTube link.")


@transaction.atomic
def refresh_playlist(playlist: Playlist, *, user=None) -> int:
    """Re-fetch the playlist's origin SourcePlaylist from the source and **mirror** the
    fork's tracks to match it (rebuild membership in source order). An explicit "sync
    from source" — it discards manual edits. Reuses cached Tracks + YouTube matches;
    only the source listing is re-fetched. Returns the new track count."""
    sp = playlist.origin
    if sp is None or not sp.url:
        raise UnsupportedSourceError(
            "This playlist wasn't imported from a source, so there's nothing to refresh."
        )
    module = {Source.SPOTIFY: spotify, Source.APPLE_MUSIC: applemusic}.get(sp.source.code)
    if module is None:
        raise UnsupportedSourceError("Refreshing isn't supported for this source.")
    sp = _cache_source_playlist(sp.source, sp.external_id, module.ingest_with_meta(sp.url), sp.url)
    playlist.items.all().delete()  # mirror: rebuild membership from the source
    for it in sp.items.select_related("track").order_by("position"):
        PlaylistTrack.objects.create(
            playlist=playlist, track=it.track, position=it.position, added_by=user
        )
    playlist.origin_snapshot_id = sp.snapshot_id
    if sp.cover_url and not playlist.artwork_url:
        playlist.artwork_url = sp.cover_url
    playlist.save(update_fields=["origin_snapshot_id", "artwork_url", "updated_at"])
    return sp.track_count


def search_songs(query: str, *, limit: int = 20) -> list[Track]:
    """Global song search: find songs on Spotify and upsert them as global catalog
    Tracks, so they can be played (YouTube audio is matched lazily on play, like any
    other track). Returns the Tracks in Spotify's relevance order. Empty query → []."""
    if not query.strip():
        return []
    return [_upsert_track(row) for row in spotify.search_tracks(query, limit=limit)]
