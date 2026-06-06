from django.utils import timezone
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


class JamMemberSerializer(serializers.Serializer):
    """A participant in a shared room — for the member list."""

    user_id = serializers.UUIDField()
    username = serializers.CharField()
    role = serializers.CharField()


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
    # Synced start: true while a shared room waits for the server cache to warm
    # before everyone starts together. Clients show "Starting…" and don't play.
    pending_start = serializers.BooleanField(source="playback.pending_start", read_only=True)
    position_ms = serializers.IntegerField(source="playback.position_ms", read_only=True)
    context_label = serializers.CharField(source="playback.context_label", read_only=True)
    queue = serializers.SerializerMethodField()
    context = serializers.SerializerMethodField()

    # --- Jam (sharing) ---
    # User PK (UUIDv7). Clients compare it to the session user's id to tell host
    # from guest; matches members[].user_id.
    host_id = serializers.UUIDField(read_only=True)
    # Server clock authority for sync (see PlaybackState): the live position is
    # `position_ms + (now - playing_since)` while playing; `generation` lets a
    # client discard out-of-order frames.
    playing_since = serializers.DateTimeField(
        source="playback.playing_since", read_only=True, allow_null=True
    )
    generation = serializers.IntegerField(source="playback.generation", read_only=True)
    # Server's current time, stamped per response, so clients can correct for
    # client/server clock skew when computing the live position.
    server_time = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id",
            "current",
            "current_item_id",
            "is_playing",
            "pending_start",
            "position_ms",
            "context_label",
            "queue",
            "context",
            "host_id",
            "code",
            "is_shared",
            "allow_guest_control",
            "playing_since",
            "generation",
            "server_time",
            "members",
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

    @extend_schema_field(serializers.DateTimeField())
    def get_server_time(self, room):
        # Return a string (not a datetime): unlike the HTTP renderer, the
        # WebSocket path json/msgpack-encodes this dict and can't handle a raw
        # datetime. Use DRF's representation so it matches playing_since's format.
        return serializers.DateTimeField().to_representation(timezone.now())

    @extend_schema_field(JamMemberSerializer(many=True))
    def get_members(self, room):
        # Everyone in the Jam, host first then join order. Empty for a private room.
        return [
            {"user_id": str(m.user_id), "username": m.user.username, "role": m.role}
            for m in sorted(
                room.members.all(), key=lambda m: (m.role != "host", m.joined_at)
            )
        ]


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
    # Optional: start the context at this track (clicking a row plays from there).
    # Omitted → play from the top.
    start_track_id = serializers.UUIDField(required=False, allow_null=True)


class QueueItemRefSerializer(serializers.Serializer):
    """Reference an existing queue/context item (for jump / remove)."""

    item_id = serializers.UUIDField()


class SaveAsPlaylistSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)


class JoinRoomSerializer(serializers.Serializer):
    """Join a Jam by its code."""

    code = serializers.CharField(max_length=12)


class GuestControlSerializer(serializers.Serializer):
    """Host toggle: whether guests may drive playback."""

    enabled = serializers.BooleanField()


class SyncPositionSerializer(serializers.Serializer):
    """Host re-anchor: the real playhead (ms) + whether audio is actually playing."""

    position_ms = serializers.IntegerField(min_value=0)
    is_playing = serializers.BooleanField()
