"""
Catalog / identity layer for the music app.

Design (see docs/data-model.md): internal UUIDv7s are identity; external
URLs/IDs are versioned attributes (history, not overwrite); tracks dedupe on
ISRC; sources are data (the `Source` registry); one active playback source per
track.

Every model inherits BaseModel → UUIDv7 PK + created_at + updated_at. These are
SHARED, global tables (NOT RLS owner-isolated) — playlists and the catalog are
meant to be shared; visibility (is_public) is enforced in the app layer. Runtime
`app_user` gets DML via ALTER DEFAULT PRIVILEGES (see postgres/init.sql).
"""

from django.conf import settings
from django.db import models
from django_rls import RLSModel

from apps.core.models import BaseModel
from apps.core.rls import owner_scoped_policy, public_readable_policy


# ---------------------------------------------------------------------------
# Reference
# ---------------------------------------------------------------------------
class Source(BaseModel):
    """Registry of every platform we ingest from and/or play back from.

    Sources are *data, not code* — adding Tidal/SoundCloud or changing a URL
    pattern is a row change, never a migration.
    """

    class Role(models.TextChoices):
        CATALOG = "catalog", "Catalog (ingest tracks from)"
        PLAYBACK = "playback", "Playback (stream audio from)"
        BOTH = "both", "Both"

    class IngestMethod(models.TextChoices):
        API = "api", "API"
        SCRAPE = "scrape", "Scrape"
        YT_DLP = "yt_dlp", "yt-dlp"
        UPLOAD = "upload", "Upload"
        NONE = "none", "None"

    # Stable machine codes (used in seeds + code).
    SPOTIFY = "SPOTIFY"
    APPLE_MUSIC = "APPLE_MUSIC"
    YOUTUBE = "YOUTUBE"
    YOUTUBE_MUSIC = "YOUTUBE_MUSIC"
    UPLOAD = "UPLOAD"
    DIRECT_URL = "DIRECT_URL"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=64)
    role = models.CharField(max_length=16, choices=Role.choices)
    ingest_method = models.CharField(max_length=16, choices=IngestMethod.choices)
    url_patterns = models.JSONField(default=list, blank=True)
    base_url = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


# ---------------------------------------------------------------------------
# Catalog / identity
# ---------------------------------------------------------------------------
class Track(BaseModel):
    """Canonical, platform-agnostic song. Dedupe on ISRC, else match_key."""

    isrc = models.CharField(max_length=15, blank=True, db_index=True)
    match_key = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=512)
    primary_artist = models.CharField(max_length=512)
    duration_ms = models.IntegerField(null=True, blank=True)
    # Display metadata, normalized from the ingest source (Apple/Spotify); YouTube
    # is only the playback layer, so its imports carry sparser metadata. Enriched
    # across sources on re-import (an empty field is filled in by a later source).
    artwork_url = models.URLField(max_length=1024, blank=True)
    album_name = models.CharField(max_length=512, blank=True)
    is_explicit = models.BooleanField(default=False)
    preview_url = models.URLField(max_length=1024, blank=True)  # 30s clip (Spotify/Apple)
    source_url = models.URLField(max_length=1024, blank=True)  # link back to the origin track/page

    class Meta:
        ordering = ["title"]

    def __str__(self) -> str:
        return f"{self.title} — {self.primary_artist}"


class Upload(BaseModel):
    """A user-uploaded audio file living in object storage (R2/S3)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="uploads"
    )
    storage_key = models.CharField(max_length=512)
    original_filename = models.CharField(max_length=512, blank=True)
    content_type = models.CharField(max_length=128, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    sha256 = models.CharField(max_length=64, unique=True, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)

    def __str__(self) -> str:
        return self.original_filename or self.storage_key


class Playlist(BaseModel, RLSModel):
    """A user's canonical playlist (a fork/snapshot — decoupled from any source).

    The one owner-isolated table in the catalog: RLS enforces, at the DB layer,
    that the runtime `app_user` role only sees rows where `created_by` matches
    the request's user — a backstop under the viewset's app-layer filter. Reads
    additionally allow `is_public` rows (forward-compat with public sharing);
    writes stay owner-only. Admin (`rls.bypass`) and migrations (BYPASSRLS role)
    are unaffected. The rest of the catalog stays shared-global.
    """

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    artwork_url = models.URLField(max_length=1024, blank=True)  # the playlist's own cover
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="playlists",
    )
    is_public = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        rls_policies = [owner_scoped_policy("created_by"), public_readable_policy()]

    def __str__(self) -> str:
        return self.title


class SourceLink(BaseModel):
    """History of external references → a Track or Playlist (append-only).

    `created_at` is the first-seen time. `last_verified_at` / `invalidated_at`
    capture later lifecycle events distinct from creation/update.
    """

    class Kind(models.TextChoices):
        TRACK = "track", "Track"
        ALBUM = "album", "Album"
        PLAYLIST = "playlist", "Playlist"
        VIDEO = "video", "Video"
        FILE = "file", "File"

    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="links")
    track = models.ForeignKey(
        Track, on_delete=models.CASCADE, null=True, blank=True, related_name="source_links"
    )
    playlist = models.ForeignKey(
        Playlist, on_delete=models.CASCADE, null=True, blank=True, related_name="source_links"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    external_id = models.CharField(max_length=255)
    url = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    raw = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source", "external_id", "kind"],
                name="uniq_sourcelink_source_external_kind",
            )
        ]
        indexes = [models.Index(fields=["source", "external_id"])]

    def __str__(self) -> str:
        return f"{self.source.code}:{self.kind}:{self.external_id}"


class PlaybackSource(BaseModel):
    """Every playable rendition of a Track (matched YouTube, pasted video,
    uploaded file, direct URL). Exactly one `active` per track; corrections are
    new rows (history) with `manual` beating `auto`/`direct`."""

    class LocatorKind(models.TextChoices):
        VIDEO_ID = "video_id", "YouTube video id"
        STORAGE_KEY = "storage_key", "Object-storage key"
        URL = "url", "Direct URL"

    class Origin(models.TextChoices):
        MATCHED_AUTO = "matched_auto", "Matched (auto)"
        MATCHED_MANUAL = "matched_manual", "Matched (manual correction)"
        DIRECT = "direct", "Direct (paste/upload, no search)"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CANDIDATE = "candidate", "Candidate"
        DEAD = "dead", "Dead"
        REPLACED = "replaced", "Replaced"
        REJECTED = "rejected", "Rejected"

    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name="playback_sources")
    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="playback_sources")
    locator_kind = models.CharField(max_length=16, choices=LocatorKind.choices)
    locator = models.CharField(max_length=1024)
    upload = models.ForeignKey(
        Upload, on_delete=models.SET_NULL, null=True, blank=True, related_name="playback_sources"
    )
    title = models.CharField(max_length=512, blank=True)
    uploader = models.CharField(max_length=512, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    origin = models.CharField(max_length=16, choices=Origin.choices)
    confidence = models.FloatField(null=True, blank=True)
    duration_delta_ms = models.IntegerField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.CANDIDATE)
    selected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="playback_source_selections",
    )
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # Enforce exactly one active rendition per track (partial unique).
            models.UniqueConstraint(
                fields=["track"],
                condition=models.Q(status="active"),
                name="one_active_playback_source_per_track",
            )
        ]
        indexes = [models.Index(fields=["track", "status"])]

    def __str__(self) -> str:
        return f"{self.source.code}:{self.locator} ({self.status})"


class PlaylistTrack(BaseModel):
    """Ordered membership of a Track in a Playlist (created_at = added time)."""

    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name="items")
    track = models.ForeignKey(Track, on_delete=models.PROTECT, related_name="playlist_items")
    position = models.IntegerField()
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="added_playlist_tracks",
    )

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["playlist", "track"], name="uniq_playlisttrack_playlist_track"
            )
        ]

    def __str__(self) -> str:
        return f"{self.playlist_id}[{self.position}] → {self.track_id}"


class PlaylistImport(BaseModel):
    """Provenance: a point-in-time snapshot of one paste/ingest (created_at =
    import time). `playlist` is null for a loose paste (the default flow); it is
    set only when an import is bound to an owned playlist."""

    class Status(models.TextChoices):
        COMPLETED = "completed", "Completed"
        PARTIAL = "partial", "Partial"
        FAILED = "failed", "Failed"

    playlist = models.ForeignKey(
        Playlist, on_delete=models.CASCADE, null=True, blank=True, related_name="imports"
    )
    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="imports")
    source_url = models.TextField()
    source_external_id = models.CharField(max_length=255, blank=True)
    # Spotify exposes a `snapshot_id` that changes when the playlist changes —
    # lets a future "refresh" cheaply detect edits without diffing all tracks.
    source_snapshot_id = models.CharField(max_length=255, blank=True)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="playlist_imports",
    )
    track_count = models.IntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.COMPLETED)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.source.code} import → {self.playlist_id} ({self.track_count} tracks)"
