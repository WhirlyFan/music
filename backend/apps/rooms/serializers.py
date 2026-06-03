from rest_framework import serializers

from apps.catalog.serializers import TrackSerializer

from .models import QueueItem, Room


class QueueItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "kind", "position", "track"]


class RoomSerializer(serializers.ModelSerializer):
    """The room as the player needs it: now-playing track + the two up-next
    layers (explicit `queue`, then the `context` it resumes into)."""

    current = TrackSerializer(source="playback.current_track", read_only=True, allow_null=True)
    is_playing = serializers.BooleanField(source="playback.is_playing", read_only=True)
    position_ms = serializers.IntegerField(source="playback.position_ms", read_only=True)
    context_label = serializers.CharField(source="playback.context_label", read_only=True)
    queue = serializers.SerializerMethodField()
    context = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ["id", "current", "is_playing", "position_ms", "context_label", "queue", "context"]

    def _layer(self, room, kind):
        # Uses the prefetched `items` (no extra query); ordered by position.
        items = sorted(
            (i for i in room.items.all() if i.kind == kind), key=lambda i: i.position
        )
        return QueueItemSerializer(items, many=True).data

    def get_queue(self, room):
        return self._layer(room, QueueItem.Kind.QUEUE)

    def get_context(self, room):
        return self._layer(room, QueueItem.Kind.CONTEXT)


class PlaySerializer(serializers.Serializer):
    """Set the context to `track_ids` and start playing at `start_index`."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    start_index = serializers.IntegerField(min_value=0, default=0)
    label = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class QueueSerializer(serializers.Serializer):
    """Add tracks to the user queue. `play_next` puts them at the head."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    play_next = serializers.BooleanField(default=False)


class PlayPlaylistSerializer(serializers.Serializer):
    playlist_id = serializers.UUIDField()


class SaveAsPlaylistSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
