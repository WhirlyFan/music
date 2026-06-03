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

    def _room_detail(self, user) -> Room:
        services.get_active_room(user)  # ensure room + playback exist
        return (
            Room.objects.select_related("playback", "playback__current_track")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=QueueItem.objects.select_related("track").order_by("position"),
                ),
                "items__track__playback_sources",
                "playback__current_track__playback_sources",
            )
            .get(host=user, is_active=True)
        )

    def _respond(self, user):
        return Response(RoomSerializer(self._room_detail(user)).data)

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        return self._respond(request.user)

    @extend_schema(request=PlaySerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def play(self, request):
        """Play a list as the context, starting at `start_index` (per-track Play
        sends the surrounding list + the clicked index)."""
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

    @extend_schema(request=PlayPlaylistSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-playlist")
    def play_playlist(self, request):
        s = PlayPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        playlist = get_object_or_404(Playlist, pk=s.validated_data["playlist_id"])
        room = services.get_active_room(request.user)
        services.play_playlist(room, playlist, added_by=request.user)
        return self._respond(request.user)

    @extend_schema(request=QueueSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def queue(self, request):
        """Add one or more tracks to the user queue (`play_next` → at the head)."""
        s = QueueSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tracks = _ordered_tracks(s.validated_data["track_ids"])
        room = services.get_active_room(request.user)
        if s.validated_data["play_next"]:
            for track in reversed(tracks):  # keep requested order at the head
                services.enqueue(room, track, added_by=request.user, play_next=True)
        else:
            services.enqueue_many(room, tracks, added_by=request.user)
        return self._respond(request.user)

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def jump(self, request):
        """Play an up-next item now (click-to-play); skips everything before it."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.jump(services.get_active_room(request.user), s.validated_data["item_id"])
        return self._respond(request.user)

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def remove(self, request):
        """Remove a single up-next item."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.remove(services.get_active_room(request.user), s.validated_data["item_id"])
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def shuffle(self, request):
        """Reshuffle the remaining context order."""
        services.shuffle(services.get_active_room(request.user))
        return self._respond(request.user)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def advance(self, request):
        services.advance(services.get_active_room(request.user))
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
