from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.serializers import TrackSerializer

from . import services
from .models import QueueItem, Room


class QueueItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "kind", "position", "track"]


class RoomSerializer(serializers.ModelSerializer):
    """The room as the player needs it: now-playing + two up-next layers —
    `queue` (explicit "Next in queue") and `context` (the playlist remaining,
    "Next from: …"). Already-played context tracks are not surfaced (they stay in
    the context, reachable via Previous)."""

    current = serializers.SerializerMethodField()
    current_item_id = serializers.UUIDField(
        source="playback.current_item_id", read_only=True, allow_null=True
    )
    is_playing = serializers.BooleanField(source="playback.is_playing", read_only=True)
    position_ms = serializers.IntegerField(source="playback.position_ms", read_only=True)
    context_label = serializers.CharField(source="playback.context_label", read_only=True)
    queue = serializers.SerializerMethodField()
    context = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id",
            "current",
            "current_item_id",
            "is_playing",
            "position_ms",
            "context_label",
            "queue",
            "context",
        ]

    @extend_schema_field(TrackSerializer)
    def get_current(self, room):
        playback = getattr(room, "playback", None)
        item = playback.current_item if (playback and playback.current_item_id) else None
        return TrackSerializer(item.track).data if item else None

    @extend_schema_field(QueueItemSerializer(many=True))
    def get_queue(self, room):
        # The ephemeral user queue (excluding the now-playing item).
        return QueueItemSerializer(services.upcoming(room)["queue"], many=True).data

    @extend_schema_field(QueueItemSerializer(many=True))
    def get_context(self, room):
        # The FULL context (the whole playlist/album), in order — the client shows
        # it as a stable list and highlights `current_item_id`. Already-played
        # tracks stay visible; clicking just moves the position.
        rows = sorted(
            (i for i in room.items.all() if i.kind == QueueItem.Kind.CONTEXT),
            key=lambda i: i.position,
        )
        return QueueItemSerializer(rows, many=True).data


class PlaySerializer(serializers.Serializer):
    """Replace the context with `track_ids` and play from `start_index`."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    start_index = serializers.IntegerField(min_value=0, default=0)
    label = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class PlayNowSerializer(serializers.Serializer):
    """Play a single track now (context becomes just that song)."""

    track_id = serializers.UUIDField()


class QueueSerializer(serializers.Serializer):
    """Add tracks to the user queue. `play_next` puts them at the head."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    play_next = serializers.BooleanField(default=False)


class PlayPlaylistSerializer(serializers.Serializer):
    playlist_id = serializers.UUIDField()


class QueueItemRefSerializer(serializers.Serializer):
    """Reference an existing queue/context item (for jump / remove)."""

    item_id = serializers.UUIDField()


class SaveAsPlaylistSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
