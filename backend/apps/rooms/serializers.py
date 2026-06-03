from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.serializers import TrackSerializer

from .models import QueueItem, Room


class QueueItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "position", "track"]


class RoomSerializer(serializers.ModelSerializer):
    """The room as the player needs it: now-playing + the single queue split into
    already-played `history` and upcoming `queue`, around the current cursor."""

    current = serializers.SerializerMethodField()
    current_item_id = serializers.UUIDField(
        source="playback.current_item_id", read_only=True, allow_null=True
    )
    is_playing = serializers.BooleanField(source="playback.is_playing", read_only=True)
    position_ms = serializers.IntegerField(source="playback.position_ms", read_only=True)
    history = serializers.SerializerMethodField()
    queue = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ["id", "current", "current_item_id", "is_playing", "position_ms", "history", "queue"]

    def _split(self, room):
        playback = getattr(room, "playback", None)
        cur_id = playback.current_item_id if playback else None
        items = sorted(room.items.all(), key=lambda i: i.position)  # prefetched
        cur_pos = next((i.position for i in items if i.id == cur_id), None)
        if cur_pos is None:
            return [], items
        return (
            [i for i in items if i.position < cur_pos],
            [i for i in items if i.position > cur_pos],
        )

    @extend_schema_field(TrackSerializer)
    def get_current(self, room):
        playback = getattr(room, "playback", None)
        item = playback.current_item if (playback and playback.current_item_id) else None
        return TrackSerializer(item.track).data if item else None

    @extend_schema_field(QueueItemSerializer(many=True))
    def get_history(self, room):
        return QueueItemSerializer(self._split(room)[0], many=True).data

    @extend_schema_field(QueueItemSerializer(many=True))
    def get_queue(self, room):
        return QueueItemSerializer(self._split(room)[1], many=True).data


class PlaySerializer(serializers.Serializer):
    """Replace the queue with `track_ids` and play from `start_index`."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    start_index = serializers.IntegerField(min_value=0, default=0)


class PlayNowSerializer(serializers.Serializer):
    """Play a single track now (insert at the cursor)."""

    track_id = serializers.UUIDField()


class QueueSerializer(serializers.Serializer):
    """Add tracks to the queue. `play_next` inserts right after current."""

    track_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    play_next = serializers.BooleanField(default=False)


class PlayPlaylistSerializer(serializers.Serializer):
    playlist_id = serializers.UUIDField()


class QueueItemRefSerializer(serializers.Serializer):
    """Reference an existing queue item (for jump / remove)."""

    item_id = serializers.UUIDField()


class SaveAsPlaylistSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
