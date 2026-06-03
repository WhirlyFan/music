from django.db.models import Count, Prefetch
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
    EnqueueBatchSerializer,
    EnqueueSerializer,
    PlayPlaylistSerializer,
    RoomSerializer,
    SaveAsPlaylistSerializer,
)


class RoomViewSet(viewsets.ViewSet):
    """The caller's own listening room (room-of-one). All actions operate on
    `request.user`'s active room — there is no other-user access."""

    permission_classes = [permissions.IsAuthenticated]

    def _room_detail(self, user) -> Room:
        services.get_active_room(user)  # ensure room + playback exist
        return (
            Room.objects.select_related("playback")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=QueueItem.objects.select_related("track").order_by("position"),
                ),
                "items__track__playback_sources",
            )
            .get(host=user, is_active=True)
        )

    def _respond(self, user):
        return Response(RoomSerializer(self._room_detail(user)).data)

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        return self._respond(request.user)

    @extend_schema(request=EnqueueSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def enqueue(self, request):
        s = EnqueueSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        track = get_object_or_404(Track, pk=s.validated_data["track_id"])
        room = services.get_active_room(request.user)
        services.enqueue(room, track, added_by=request.user, mode=s.validated_data["mode"])
        return self._respond(request.user)

    @extend_schema(request=EnqueueBatchSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="enqueue-batch")
    def enqueue_batch(self, request):
        """Play (replace) or add a batch of tracks — e.g. a pasted import."""
        s = EnqueueBatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        track_ids = s.validated_data["track_ids"]
        by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
        ordered = [by_id[str(tid)] for tid in track_ids if str(tid) in by_id]
        room = services.get_active_room(request.user)
        services.play_tracks(
            room, ordered, added_by=request.user, replace=s.validated_data["replace"]
        )
        return self._respond(request.user)

    @extend_schema(request=PlayPlaylistSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-playlist")
    def play_playlist(self, request):
        s = PlayPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        playlist = get_object_or_404(Playlist, pk=s.validated_data["playlist_id"])
        room = services.get_active_room(request.user)
        services.play_playlist(room, playlist, added_by=request.user, replace=True)
        return self._respond(request.user)

    @extend_schema(request=SaveAsPlaylistSerializer, responses=PlaylistSerializer)
    @action(detail=False, methods=["post"], url_path="save-as-playlist")
    def save_as_playlist(self, request):
        s = SaveAsPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        playlist = services.save_queue_as_playlist(room, request.user, s.validated_data["title"])
        # PlaylistSerializer reads a `track_count` annotation — re-fetch with it.
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistSerializer(playlist).data)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def advance(self, request):
        services.advance(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def clear(self, request):
        services.clear_queue(services.get_active_room(request.user))
        return self._respond(request.user)
