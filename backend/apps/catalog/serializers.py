from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    PlaybackSource,
    Playlist,
    PlaylistActivity,
    PlaylistCollaborator,
    PlaylistTrack,
    Track,
)


class PlaybackSourceSerializer(serializers.ModelSerializer):
    source_code = serializers.CharField(source="source.code", read_only=True)

    class Meta:
        model = PlaybackSource
        fields = [
            "id",
            "source_code",
            "locator_kind",
            "locator",
            "status",
            "origin",
            "confidence",
            "duration_delta_ms",
            "title",
            "uploader",
            "duration_ms",
        ]


class TrackSerializer(serializers.ModelSerializer):
    active_source = serializers.SerializerMethodField()

    class Meta:
        model = Track
        fields = [
            "id",
            "title",
            "primary_artist",
            "duration_ms",
            "isrc",
            "artwork_url",
            "album_name",
            "is_explicit",
            "preview_url",
            "source_url",
            "active_source",
        ]

    @extend_schema_field(PlaybackSourceSerializer)
    def get_active_source(self, obj):
        # Uses prefetched playback_sources (no extra query per track).
        active = [p for p in obj.playback_sources.all() if p.status == PlaybackSource.Status.ACTIVE]
        return PlaybackSourceSerializer(active[0]).data if active else None


class PlaylistTrackSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)
    # Who added this song — shown on the row so collaborators can see each other's
    # additions. Null for tracks added before this was tracked / by a deleted user.
    added_by = serializers.CharField(source="added_by.username", read_only=True, allow_null=True)

    class Meta:
        model = PlaylistTrack
        fields = ["position", "track", "added_by"]


class PlaylistSerializer(serializers.ModelSerializer):
    track_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Playlist
        fields = ["id", "title", "artwork_url", "is_public", "track_count", "created_at"]


class CreatePlaylistSerializer(serializers.Serializer):
    """Create a named playlist from a set of track ids (e.g. a saved import)."""

    title = serializers.CharField(max_length=255)
    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    artwork_url = serializers.URLField(required=False, allow_blank=True, default="")
    # The SourcePlaylist this was imported from — stamps the playlist's origin so it
    # can be refreshed from source later. Omitted for from-scratch playlists.
    source_playlist = serializers.UUIDField(required=False, allow_null=True)


class PlaylistUpdateSerializer(serializers.ModelSerializer):
    """Edit a playlist's own metadata (rename / describe / visibility).

    Collaborators may edit title + description, but NOT `is_public` — visibility is
    the owner's call. RLS is row-level (it lets an accepted collaborator UPDATE the
    row but can't protect a single column), so the column guard lives here.
    """

    # The model field is an unbounded TextField; cap it here so a description can't
    # grow unreasonably (the client also enforces this in the textarea).
    description = serializers.CharField(max_length=1000, allow_blank=True, required=False)

    class Meta:
        model = Playlist
        fields = ["title", "description", "is_public"]

    def validate_is_public(self, value):
        request = self.context.get("request")
        owner_id = getattr(self.instance, "created_by_id", None)
        changing = self.instance is not None and value != self.instance.is_public
        if changing and getattr(request and request.user, "id", None) != owner_id:
            raise serializers.ValidationError("Only the owner can change visibility.")
        return value


class CollaboratorUserSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    username = serializers.CharField(read_only=True)
    display_name = serializers.CharField(read_only=True)


class PlaylistCollaboratorSerializer(serializers.ModelSerializer):
    user = CollaboratorUserSerializer(read_only=True)

    class Meta:
        model = PlaylistCollaborator
        fields = ["id", "user", "role", "status", "created_at"]


class PlaylistActivitySerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source="actor.username", read_only=True, allow_null=True)

    class Meta:
        model = PlaylistActivity
        fields = ["id", "action", "actor_username", "detail", "created_at"]


class PlaylistDetailSerializer(serializers.ModelSerializer):
    # Metadata only — tracks are paginated via the playlist `tracks` action so a
    # long playlist isn't inlined here. `track_count` powers the header.
    track_count = serializers.IntegerField(read_only=True)
    # The SourcePlaylist this was imported from (null for from-scratch playlists) —
    # presence enables the "Refresh from source" action.
    origin = serializers.UUIDField(source="origin_id", read_only=True, allow_null=True)
    # Whether the caller owns this playlist — false when viewing someone else's
    # PUBLIC playlist, so the client hides delete/refresh/visibility/collaborators.
    is_owner = serializers.SerializerMethodField()
    # Whether the caller may edit tracks + metadata — the owner OR an accepted
    # collaborator. Drives the track-edit affordances (which collaborators get too).
    can_edit = serializers.SerializerMethodField()
    # Number of accepted collaborators — the client shows per-row "added by" avatars
    # only when a playlist is actually collaborative (>0).
    collaborator_count = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = [
            "id",
            "title",
            "description",
            "artwork_url",
            "is_public",
            "is_owner",
            "can_edit",
            "collaborator_count",
            "created_at",
            "track_count",
            "origin",
        ]

    @extend_schema_field(serializers.BooleanField())
    def get_is_owner(self, obj):
        request = self.context.get("request")
        return bool(request and obj.created_by_id == getattr(request.user, "id", None))

    @extend_schema_field(serializers.BooleanField())
    def get_can_edit(self, obj):
        request = self.context.get("request")
        if not request:
            return False
        from . import collab

        return collab.can_edit(obj, request.user)

    @extend_schema_field(serializers.IntegerField())
    def get_collaborator_count(self, obj):
        return obj.collaborators.filter(status=PlaylistCollaborator.Status.ACCEPTED).count()


class IngestSerializer(serializers.Serializer):
    url = serializers.URLField()


class ImportResultSerializer(serializers.Serializer):
    """The result of a paste: loose tracks the caller can play/queue/save."""

    id = serializers.UUIDField(read_only=True)  # the PlaylistImport id
    title = serializers.CharField(read_only=True)
    track_count = serializers.IntegerField(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    cover = serializers.CharField(
        read_only=True, allow_blank=True, required=False
    )  # collection art
    # Optional advisory (e.g. "imported the first 50 — Spotify caps the preview").
    note = serializers.CharField(read_only=True, allow_null=True, required=False)
    # The SourcePlaylist this came from (pass back on save to stamp the fork's origin),
    # and — if the caller already saved this same source playlist — that playlist's id,
    # so the UI can offer "open / refresh" instead of a duplicate save.
    source_playlist = serializers.UUIDField(read_only=True, allow_null=True, required=False)
    already_saved = serializers.UUIDField(read_only=True, allow_null=True, required=False)
