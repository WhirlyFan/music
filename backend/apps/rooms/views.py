from django.db.models import Count, Prefetch
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.catalog.models import Playlist, Track
from apps.catalog.serializers import PlaylistSerializer

from . import services
from .models import QueueItem, Room
from .serializers import (
    JoinRoomSerializer,
    PlayNowSerializer,
    PlayPlaylistSerializer,
    PlaySerializer,
    QueueItemRefSerializer,
    QueueSerializer,
    RoomSerializer,
    SaveAsPlaylistSerializer,
)


def _ordered_tracks(track_ids):
    """Tracks for the given ids, in the requested order (drops unknown ids)."""
    by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
    return [by_id[str(tid)] for tid in track_ids if str(tid) in by_id]


class RoomViewSet(viewsets.ViewSet):
    """The caller's own listening room (room-of-one). All actions operate on
    `request.user`'s active room — there is no other-user access."""

    permission_classes = [permissions.IsAuthenticated]

    def _load(self, room_id) -> Room:
        """Fully-prefetched room by id — the exact shape RoomSerializer needs
        (and, later, what the WebSocket broadcast re-serializes)."""
        return (
            Room.objects.select_related(
                "playback", "playback__current_item", "playback__current_item__track"
            )
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=QueueItem.objects.select_related("track").order_by("position"),
                ),
                "items__track__playback_sources",
                "playback__current_item__track__playback_sources",
                "members__user",
            )
            .get(pk=room_id)
        )

    def _room_detail(self, user) -> Room:
        room = services.get_active_room(user)  # ensure room + playback exist
        return self._load(room.id)

    def _respond(self, user):
        return Response(RoomSerializer(self._room_detail(user)).data)

    def _respond_room(self, room):
        return Response(RoomSerializer(self._load(room.id)).data)

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        return self._respond(request.user)

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def current(self, request):
        """The room the user is actively in — a Jam they've joined as a guest,
        else their own room. This is what the player subscribes to."""
        return self._respond_room(services.current_room(request.user))

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def share(self, request):
        """Turn the caller's room into a Jam (assigns a join code)."""
        room = services.share_room(services.get_active_room(request.user))
        return self._respond_room(room)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def unshare(self, request):
        """End the Jam — drop guests, clear the code, go private again."""
        room = services.unshare_room(services.get_active_room(request.user))
        return self._respond_room(room)

    @extend_schema(request=JoinRoomSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def join(self, request):
        """Join a Jam by its code (as a guest)."""
        s = JoinRoomSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            room = services.join_by_code(request.user, s.validated_data["code"])
        except services.RoomNotFound:
            raise Http404("No open jam with that code.") from None
        return self._respond_room(room)

    @extend_schema(request=PlaySerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def play(self, request):
        """Replace the queue with a list and play from `start_index`
        (Play playlist / Play all)."""
        s = PlaySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tracks = _ordered_tracks(s.validated_data["track_ids"])
        room = services.get_active_room(request.user)
        services.play(
            room,
            tracks,
            start=s.validated_data["start_index"],
            added_by=request.user,
            label=s.validated_data["label"],
        )
        return self._respond(request.user)

    @extend_schema(request=PlayNowSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-now")
    def play_now(self, request):
        """Play one song now (clicking a track) — inserts it at the cursor; does
        not pull in the surrounding list."""
        s = PlayNowSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        track = get_object_or_404(Track, pk=s.validated_data["track_id"])
        room = services.get_active_room(request.user)
        services.play_now(room, track, added_by=request.user)
        return self._respond(request.user)

    @extend_schema(request=PlayPlaylistSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-playlist")
    def play_playlist(self, request):
        s = PlayPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        playlist = get_object_or_404(Playlist, pk=s.validated_data["playlist_id"])
        room = services.get_active_room(request.user)
        services.play_playlist(
            room,
            playlist,
            start_track_id=s.validated_data.get("start_track_id"),
            added_by=request.user,
        )
        return self._respond(request.user)

    @extend_schema(request=QueueSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def queue(self, request):
        """Add one or more tracks to the queue (`play_next` → right after current)."""
        s = QueueSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tracks = _ordered_tracks(s.validated_data["track_ids"])
        room = services.get_active_room(request.user)
        if s.validated_data["play_next"]:
            for track in reversed(tracks):  # keep requested order right after current
                services.enqueue(room, track, added_by=request.user, play_next=True)
        else:
            services.enqueue_many(room, tracks, added_by=request.user)
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def next(self, request):
        services.next_track(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def previous(self, request):
        services.previous_track(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def jump(self, request):
        """Play a specific queue item now (click any row in the queue)."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.jump(services.get_active_room(request.user), s.validated_data["item_id"])
        return self._respond(request.user)

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def remove(self, request):
        """Remove a single queue item."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.remove(services.get_active_room(request.user), s.validated_data["item_id"])
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def shuffle(self, request):
        """Reshuffle the up-next items."""
        services.shuffle(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def clear(self, request):
        services.clear(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=SaveAsPlaylistSerializer, responses=PlaylistSerializer)
    @action(detail=False, methods=["post"], url_path="save-as-playlist")
    def save_as_playlist(self, request):
        s = SaveAsPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        playlist = services.save_as_playlist(room, request.user, s.validated_data["title"])
        # PlaylistSerializer reads a `track_count` annotation — re-fetch with it.
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistSerializer(playlist).data)
