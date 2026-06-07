from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.serializers import TrackSerializer

from . import services
from .models import QueueItem, Room, RoomMember


class QueueItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "kind", "position", "track"]


class RoomMemberSerializer(serializers.ModelSerializer):
    """A participant in a shared room — for the paginated member list."""

    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = RoomMember
        fields = ["user_id", "username", "role"]


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
    # The full context (the played-from playlist) is NOT inlined — for a 1000-track
    # list it would re-ship on every broadcast frame. Instead the frame carries
    # metadata + a small window; the full list is the paginated /rooms/context/
    # endpoint, fetched once and cached client-side.
    context_count = serializers.SerializerMethodField()
    # Items still ahead of the pointer — exact (gap-safe), drives the Next button.
    context_ahead = serializers.SerializerMethodField()
    context_pos = serializers.IntegerField(
        source="playback.context_pos", read_only=True, allow_null=True
    )
    context_window = serializers.SerializerMethodField()
    # Changes only when the context list's membership/order changes, so a jam guest
    # refetches the full list on play/shuffle/remove but not on play/pause/seek.
    context_version = serializers.SerializerMethodField()
    # YouTube ids the client should warm ahead: the next up-next tracks + the exact
    # (seeded, deterministic) shuffle target. The desktop POSTs these to its local
    # engine so a skip / auto-advance / shuffle starts instantly. Web ignores it.
    prewarm = serializers.SerializerMethodField()

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
    # Just the count in the frame (kept light so broadcasts don't carry the whole
    # roster); the member list itself is a separate paginated endpoint
    # (GET /rooms/members/) fetched with an infinite query.
    members_count = serializers.SerializerMethodField()

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
            "context_count",
            "context_ahead",
            "context_pos",
            "context_window",
            "context_version",
            "prewarm",
            "host_id",
            "code",
            "is_shared",
            "allow_guest_control",
            "playing_since",
            "generation",
            "server_time",
            "members_count",
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

    @extend_schema_field(serializers.IntegerField())
    def get_context_count(self, room):
        return services.context_count(room)

    @extend_schema_field(serializers.IntegerField())
    def get_context_ahead(self, room):
        return services.context_ahead(room)

    @extend_schema_field(QueueItemSerializer(many=True))
    def get_context_window(self, room):
        # A small head (current + lookahead) for the panel's first paint; the full
        # list is GET /rooms/context/ (paginated, cached client-side).
        return QueueItemSerializer(services.context_window(room), many=True).data

    @extend_schema_field(serializers.CharField())
    def get_context_version(self, room):
        return services.context_version(room)

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_prewarm(self, room):
        return services.prewarm_video_ids(room)

    @extend_schema_field(serializers.DateTimeField())
    def get_server_time(self, room):
        # Return a string (not a datetime): unlike the HTTP renderer, the
        # WebSocket path json/msgpack-encodes this dict and can't handle a raw
        # datetime. Use DRF's representation so it matches playing_since's format.
        return serializers.DateTimeField().to_representation(timezone.now())

    @extend_schema_field(serializers.IntegerField())
    def get_members_count(self, room):
        # Uses the prefetched members (no extra query). 0 for a private room.
        return len(room.members.all())


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
    # An ordered snapshot of the track ids that were lined up when the user opened
    # the Save dialog. Sent so a track ending/advancing afterward doesn't change
    # what gets saved. Optional — without it the server reads live room state.
    track_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_empty=True
    )


class JoinRoomSerializer(serializers.Serializer):
    """Join a Jam by its code."""

    code = serializers.CharField(max_length=12)


class GuestControlSerializer(serializers.Serializer):
    """Host toggle: whether guests may drive playback."""

    enabled = serializers.BooleanField()


class KickMemberSerializer(serializers.Serializer):
    """Host removes a guest from the jam, by user id."""

    user_id = serializers.UUIDField()


class SyncPositionSerializer(serializers.Serializer):
    """Host re-anchor: the real playhead (ms) + whether audio is actually playing."""

    position_ms = serializers.IntegerField(min_value=0)
    is_playing = serializers.BooleanField()
