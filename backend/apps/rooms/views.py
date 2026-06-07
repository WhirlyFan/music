from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, F
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.catalog.models import Playlist, Track
from apps.catalog.serializers import PlaylistSerializer
from apps.notifications.events import emit
from apps.notifications.models import Notification

from . import broadcast, services, snapshot
from .models import PlaybackState, QueueItem
from .serializers import (
    GuestControlSerializer,
    JoinRoomSerializer,
    KickMemberSerializer,
    PlayNowSerializer,
    PlayPlaylistSerializer,
    PlaySerializer,
    QueueItemRefSerializer,
    QueueItemSerializer,
    QueueReorderSerializer,
    QueueSerializer,
    RoomMemberSerializer,
    RoomSerializer,
    SaveAsPlaylistSerializer,
    SyncPositionSerializer,
)

User = get_user_model()


def _ordered_tracks(track_ids):
    """Tracks for the given ids, in the requested order (drops unknown ids)."""
    by_id = {str(t.id): t for t in Track.objects.filter(pk__in=track_ids)}
    return [by_id[str(tid)] for tid in track_ids if str(tid) in by_id]


class RoomViewSet(viewsets.ViewSet):
    """The caller's own listening room (room-of-one). All actions operate on
    `request.user`'s active room — there is no other-user access."""

    permission_classes = [permissions.IsAuthenticated]

    def _data(self, room) -> dict:
        """Serialize a room in the player's shape (re-loads it fully prefetched).
        Shared with the WebSocket consumer via apps.rooms.snapshot."""
        return snapshot.serialize_room(room.id)

    def _read(self, room):
        """Plain read — no generation bump, no broadcast."""
        return Response(self._data(room))

    def _apply(self, room, mutate):
        """Run a state change with strong ordering, then broadcast it.

        `mutate` is a 0-arg callable performing the change. We hold a row lock on
        the room's PlaybackState for the whole mutation AND bump the generation in
        the SAME transaction, so concurrent writers to one room serialize and a
        higher generation always carries state at least as new (no torn
        gen/state). The broadcast runs after commit, so subscribers never observe
        pre-commit state; a channel-layer failure can't roll back the write."""
        with transaction.atomic():
            PlaybackState.objects.get_or_create(room=room)
            PlaybackState.objects.select_for_update().get(room=room)  # serialize per room
            mutate()
            PlaybackState.objects.filter(room=room).update(generation=F("generation") + 1)
        data = self._data(room)  # re-load picks up the committed state + new generation
        broadcast.publish(room.id, data)
        # The upcoming tracks are warmed on the client now (each desktop node caches
        # locally, off its own residential IP) via the frame's `prewarm` list — see
        # services.prewarm_video_ids. No server-side warming.
        return Response(data)

    def _control_room(self, request):
        """Resolve the room a transport action (play/pause/seek/skip) targets — the
        jam the user is in, else their own — and authorize it: the host always,
        guests only when the host enabled guest control. Raises 403 otherwise.
        (Host and solo users resolve to their own room, exactly as before.)"""
        room = services.current_room(request.user)
        if room.host_id == request.user.id or (room.is_shared and room.allow_guest_control):
            return room
        raise PermissionDenied("The host hasn't enabled guest controls in this jam.")

    def _broadcast_room(self, room):
        """Bump generation + broadcast a room to its group WITHOUT returning it —
        for when the response is a different room (e.g. leaving: tell the jam its
        members changed, but respond with the leaver's own room)."""
        PlaybackState.objects.filter(room=room).update(generation=F("generation") + 1)
        broadcast.publish(room.id, self._data(room))

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        return self._read(services.get_active_room(request.user))

    @extend_schema(responses=RoomSerializer)
    @action(detail=False, methods=["get"])
    def current(self, request):
        """The room the user is actively in — a Jam they've joined as a guest,
        else their own room. This is what the player subscribes to."""
        return self._read(services.current_room(request.user))

    @extend_schema(responses=RoomMemberSerializer(many=True))
    @action(detail=False, methods=["get"])
    def members(self, request):
        """Paginated member list for the room the user is in (host first, then
        join order). Backs the jam modal's infinite-scroll roster — kept off the
        broadcast frames, which carry only members_count."""
        room = services.current_room(request.user)
        qs = room.members.select_related("user").order_by("joined_at")
        paginator = PageNumberPagination()
        paginator.page_size = 30
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(RoomMemberSerializer(page, many=True).data)

    @extend_schema(responses=QueueItemSerializer(many=True))
    @action(detail=False, methods=["get"])
    def context(self, request):
        """Paginated FULL context (the played-from list) for the room the user is
        in, ordered by position. Kept off the broadcast frames (which carry only
        a small window + count); fetched once and cached, refetched only when
        context_version changes. Resolves the jam (guest → host's room)."""
        room = services.current_room(request.user)
        qs = (
            room.items.filter(kind=QueueItem.Kind.CONTEXT)
            .select_related("track")
            .prefetch_related("track__playback_sources")
            .order_by("position")
        )
        paginator = PageNumberPagination()
        paginator.page_size = 50
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(QueueItemSerializer(page, many=True).data)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def share(self, request):
        """Turn the caller's room into a Jam (assigns a join code)."""
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.share_room(room))

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def unshare(self, request):
        """End the Jam — drop guests, clear the code, go private again."""
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.unshare_room(room))

    @extend_schema(request=GuestControlSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="guest-control")
    def guest_control(self, request):
        """Host toggle: let guests drive playback in this jam. Operates on the
        caller's own room (you set this on the room you host)."""
        s = GuestControlSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.set_guest_control(room, s.validated_data["enabled"]))

    @extend_schema(request=KickMemberSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def kick(self, request):
        """Host removes a guest from their jam (broadcasts; the kicked guest's
        client falls back to their own room)."""
        s = KickMemberSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user_id = s.validated_data["user_id"]
        room = services.get_active_room(request.user)
        resp = self._apply(room, lambda: services.kick_member(room, user_id))
        # Targeted nudge so the kicked client falls back to its own room (it's no
        # longer in the roster, and the frame only carries a count now).
        broadcast.notify_revoked(user_id, room.id)
        return resp

    @extend_schema(request=JoinRoomSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def join(self, request):
        """Join a Jam by its code (as a guest)."""
        s = JoinRoomSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.find_open_jam(s.validated_data["code"])
        if room is None:
            raise Http404("No open jam with that code.")
        left_rooms: list = []

        def _join():
            left_rooms.extend(services.join_guest(room, request.user))

        resp = self._apply(room, _join)
        # The jams the user left lost a member — refresh their counts now.
        for prev in left_rooms:
            self._broadcast_room(prev)
        return resp

    @extend_schema(request=KickMemberSerializer, responses=None)
    @action(detail=False, methods=["post"], url_path="invite-to-jam")
    def invite_to_jam(self, request):
        """Invite a user to the caller's jam (through the events architecture). Shares
        the room first if it isn't a jam yet, then sends the invitee a JAM_INVITE
        notification carrying the join code — their Accept joins."""
        s = KickMemberSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        invitee = get_object_or_404(User, pk=s.validated_data["user_id"])
        if invitee.id == request.user.id:
            raise ValidationError("You can't invite yourself.")
        room = services.get_active_room(request.user)
        services.share_room(room)  # inviting starts the jam if it wasn't shared yet
        emit(
            Notification.Kind.JAM_INVITE,
            recipient=invitee,
            actor=request.user,
            code=room.code,
            room_id=str(room.id),
        )
        self._broadcast_room(room)  # the host became a member on share → refresh roster
        return Response(status=204)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def leave(self, request):
        """Leave a jam (guest). Responds with the caller's own room; the jam its
        remaining members see is updated separately."""
        left = services.leave_room(request.user)
        if left is not None:
            self._broadcast_room(left)
        return self._read(services.get_active_room(request.user))

    @extend_schema(request=SyncPositionSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def sync(self, request):
        """Host re-anchors the server clock to its real playhead (periodic
        heartbeat, or after a seek/play/pause). Operates on the caller's OWN room,
        so only a host re-anchors their jam — a guest's call just touches their own
        private room harmlessly."""
        s = SyncPositionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = self._control_room(request)
        return self._apply(
            room,
            lambda: services.set_position(
                room, s.validated_data["position_ms"], s.validated_data["is_playing"]
            ),
        )

    @extend_schema(request=PlaySerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def play(self, request):
        """Replace the queue with a list and play from `start_index`
        (Play playlist / Play all)."""
        s = PlaySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tracks = _ordered_tracks(s.validated_data["track_ids"])
        room = services.get_active_room(request.user)
        return self._apply(
            room,
            lambda: services.play(
                room,
                tracks,
                start=s.validated_data["start_index"],
                added_by=request.user,
                label=s.validated_data["label"],
            ),
        )

    @extend_schema(request=PlayNowSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-now")
    def play_now(self, request):
        """Play one song now (clicking a track) — inserts it at the cursor; does
        not pull in the surrounding list."""
        s = PlayNowSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        track = get_object_or_404(Track, pk=s.validated_data["track_id"])
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.play_now(room, track, added_by=request.user))

    @extend_schema(request=PlayPlaylistSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"], url_path="play-playlist")
    def play_playlist(self, request):
        s = PlayPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        playlist = get_object_or_404(Playlist, pk=s.validated_data["playlist_id"])
        room = services.get_active_room(request.user)
        return self._apply(
            room,
            lambda: services.play_playlist(
                room,
                playlist,
                start_track_id=s.validated_data.get("start_track_id"),
                added_by=request.user,
            ),
        )

    @extend_schema(request=QueueSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def queue(self, request):
        """Add one or more tracks to the queue (`play_next` → right after current)."""
        s = QueueSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        tracks = _ordered_tracks(s.validated_data["track_ids"])
        room = services.get_active_room(request.user)
        if services.queue_count(room) + len(tracks) > services.QUEUE_CAP:
            raise ValidationError(
                f"Your queue is full ({services.QUEUE_CAP} max). Play or clear some tracks first."
            )

        def _enqueue():
            if s.validated_data["play_next"]:
                for track in reversed(tracks):  # keep requested order right after current
                    services.enqueue(room, track, added_by=request.user, play_next=True)
            else:
                services.enqueue_many(room, tracks, added_by=request.user)

        return self._apply(room, _enqueue)

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def next(self, request):
        room = self._control_room(request)
        return self._apply(room, lambda: services.next_track(room))

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def previous(self, request):
        room = self._control_room(request)
        return self._apply(room, lambda: services.previous_track(room))

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def jump(self, request):
        """Play a specific queue item now (click any row in the queue). This is a
        playback action (like skip), so it targets the jam and is allowed for a
        guest when the host enabled guest control — not a host-only queue edit."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = self._control_room(request)
        return self._apply(room, lambda: services.jump(room, s.validated_data["item_id"]))

    @extend_schema(request=QueueItemRefSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def remove(self, request):
        """Remove a single queue item."""
        s = QueueItemRefSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.remove(room, s.validated_data["item_id"]))

    @extend_schema(request=QueueReorderSerializer, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Drag-reorder the user queue (host-only queue edit, like remove/clear)."""
        s = QueueReorderSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        return self._apply(
            room,
            lambda: services.reorder_queue(
                room, s.validated_data["item_id"], s.validated_data["position"]
            ),
        )

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def shuffle(self, request):
        """Reshuffle the up-next items."""
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.shuffle(room))

    @extend_schema(request=None, responses=RoomSerializer)
    @action(detail=False, methods=["post"])
    def clear(self, request):
        room = services.get_active_room(request.user)
        return self._apply(room, lambda: services.clear(room))

    @extend_schema(request=SaveAsPlaylistSerializer, responses=PlaylistSerializer)
    @action(detail=False, methods=["post"], url_path="save-as-playlist")
    def save_as_playlist(self, request):
        s = SaveAsPlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        room = services.get_active_room(request.user)
        playlist = services.save_as_playlist(
            room,
            request.user,
            s.validated_data["title"],
            track_ids=s.validated_data.get("track_ids"),
        )
        # PlaylistSerializer reads a `track_count` annotation — re-fetch with it.
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistSerializer(playlist).data)
