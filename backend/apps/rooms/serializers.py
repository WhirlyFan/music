from rest_framework import serializers

from apps.catalog.serializers import TrackSerializer

from .models import QueueItem, Room


class QueueItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "position", "played", "track"]


class RoomSerializer(serializers.ModelSerializer):
    items = QueueItemSerializer(many=True, read_only=True)
    current_item = serializers.UUIDField(
        source="playback.current_item_id", read_only=True, allow_null=True
    )
    is_playing = serializers.BooleanField(source="playback.is_playing", read_only=True)
    position_ms = serializers.IntegerField(source="playback.position_ms", read_only=True)

    class Meta:
        model = Room
        fields = ["id", "current_item", "is_playing", "position_ms", "items"]


class EnqueueSerializer(serializers.Serializer):
    track_id = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=["add", "play_next", "play_now"], default="add")


class EnqueueBatchSerializer(serializers.Serializer):
    """Enqueue many tracks (e.g. a pasted import). replace=True is Play (reset
    the queue and start at the first); replace=False is Add to queue (append)."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    replace = serializers.BooleanField(default=False)


class PlayPlaylistSerializer(serializers.Serializer):
    playlist_id = serializers.UUIDField()


class SaveAsPlaylistSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
