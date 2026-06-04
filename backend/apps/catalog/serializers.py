from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import PlaybackSource, Playlist, PlaylistTrack, Track


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
            "id", "title", "primary_artist", "duration_ms", "isrc",
            "artwork_url", "album_name", "is_explicit", "preview_url", "source_url",
            "active_source",
        ]

    @extend_schema_field(PlaybackSourceSerializer)
    def get_active_source(self, obj):
        # Uses prefetched playback_sources (no extra query per track).
        active = [p for p in obj.playback_sources.all() if p.status == PlaybackSource.Status.ACTIVE]
        return PlaybackSourceSerializer(active[0]).data if active else None


class PlaylistTrackSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = PlaylistTrack
        fields = ["position", "track"]


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


class PlaylistDetailSerializer(serializers.ModelSerializer):
    # Metadata only — tracks are paginated via the playlist `tracks` action so a
    # long playlist isn't inlined here. `track_count` powers the header.
    track_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Playlist
        fields = [
            "id", "title", "description", "artwork_url", "is_public",
            "created_at", "track_count",
        ]


class IngestSerializer(serializers.Serializer):
    url = serializers.URLField()


class ImportResultSerializer(serializers.Serializer):
    """The result of a paste: loose tracks the caller can play/queue/save."""

    id = serializers.UUIDField(read_only=True)  # the PlaylistImport id
    title = serializers.CharField(read_only=True)
    track_count = serializers.IntegerField(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    cover = serializers.CharField(read_only=True, allow_blank=True, required=False)  # collection art
    # Optional advisory (e.g. "imported the first 50 — Spotify caps the preview").
    note = serializers.CharField(read_only=True, allow_null=True, required=False)
