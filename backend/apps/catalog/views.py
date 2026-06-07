from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import collab, match, realtime
from .ingest.spotify import SpotifyError
from .models import (
    PlaybackSource,
    Playlist,
    PlaylistActivity,
    PlaylistCollaborator,
    PlaylistTrack,
    SourcePlaylist,
    Track,
)
from .serializers import (
    CreatePlaylistSerializer,
    ImportResultSerializer,
    IngestSerializer,
    PlaybackSourceSerializer,
    PlaylistActivitySerializer,
    PlaylistCollaboratorSerializer,
    PlaylistDetailSerializer,
    PlaylistSerializer,
    PlaylistTrackSerializer,
    PlaylistUpdateSerializer,
    TrackSerializer,
)
from .services import (
    UnsupportedSourceError,
    create_playlist_from_tracks,
    refresh_playlist,
    search_songs,
)
from .services import ingest as ingest_source

User = get_user_model()

# Prefetch playlist items (ordered) + each track's playback sources in one go.
_DETAIL_PREFETCH = [
    Prefetch(
        "items",
        queryset=PlaylistTrack.objects.select_related("track").order_by("position"),
    ),
    "items__track__playback_sources",
]


class IngestViewSet(viewsets.ViewSet):
    """Paste a source URL → loose catalog Tracks (no playlist created).

    The client then chooses what to do with them: play, add to queue, or save
    as a playlist (all handled by the rooms API)."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=IngestSerializer, responses=ImportResultSerializer)
    def create(self, request):
        serializer = IngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        url = serializer.validated_data["url"]
        try:
            result = ingest_source(url, user=request.user)
        except (UnsupportedSourceError, SpotifyError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:  # noqa: BLE001 — pasted URLs are untrusted; never 500 on a bad link
            return Response(
                {"detail": "Couldn't read that link — check it's a public playlist and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sp = result.get("source_playlist")
        # If the caller already saved this same source playlist, surface that fork so
        # the UI can offer open/refresh instead of a duplicate save.
        already_saved = (
            Playlist.objects.filter(created_by=request.user, origin=sp)
            .values_list("id", flat=True)
            .first()
            if sp
            else None
        )
        data = {
            "id": result["import"].id,
            "title": result["title"],
            "track_count": len(result["tracks"]),
            "tracks": result["tracks"],
            "cover": result.get("cover") or "",
            "note": result.get("note"),
            "source_playlist": sp.id if sp else None,
            "already_saved": already_saved,
        }
        return Response(ImportResultSerializer(data).data, status=status.HTTP_201_CREATED)


class PlaylistViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """A caller's playlists — owned, public (read), and ones they collaborate on.

    Playlists are a shared/global table fronted by RLS. The queryset mirrors the
    RLS policies in the app layer per action group:
      - read  (retrieve/tracks): owner OR public OR accepted-collaborator
      - edit  (update/track actions): owner OR accepted-collaborator
      - else  (list/create/refresh/destroy/collaborator mgmt): owner-only
    Collaborator-management + accept + activity are custom actions that resolve the
    playlist directly with their own scope (see the helpers below). Deleting a
    playlist drops its PlaylistTrack rows but leaves the global Track/PlaybackSource
    catalog intact (PlaylistTrack.track is PROTECT), and stays owner-only."""

    permission_classes = [permissions.IsAuthenticated]
    # `?search=` matches a playlist by title. (Searching *within* a playlist's songs
    # lives on the playlist detail page's track search, not here.)
    filter_backends = [filters.SearchFilter]
    search_fields = ["title"]

    # Actions whose object may be owned OR co-edited by the caller.
    _EDIT_ACTIONS = ("update", "partial_update", "remove_track", "remove_tracks", "reorder", "add_tracks")

    def get_queryset(self):
        user = self.request.user
        qs = Playlist.objects.annotate(track_count=Count("items", distinct=True))
        collaborated = Q(
            collaborators__user=user, collaborators__status=PlaylistCollaborator.Status.ACCEPTED
        )
        if self.action in ("retrieve", "tracks"):
            qs = qs.filter(Q(created_by=user) | Q(is_public=True) | collaborated)
        elif self.action in self._EDIT_ACTIONS:
            qs = qs.filter(Q(created_by=user) | collaborated)
        elif self.action == "list" and self.request.query_params.get("filter") == "shared":
            qs = qs.filter(collaborated)  # playlists I collaborate on (not mine)
        else:
            qs = qs.filter(created_by=user)
        if self.action == "retrieve":
            qs = qs.prefetch_related(*_DETAIL_PREFETCH)
        # The collaborator join can fan out rows → dedupe (the Count is distinct-safe).
        return qs.distinct().order_by("-created_at")

    def _member_playlist(self, pk):
        """A playlist the caller owns OR is a collaborator on (any status) — the scope
        for viewing collaborators/activity. RLS also permits these rows."""
        return get_object_or_404(
            Playlist.objects.filter(
                Q(created_by=self.request.user) | Q(collaborators__user=self.request.user)
            ).distinct(),
            pk=pk,
        )

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return PlaylistUpdateSerializer
        return PlaylistDetailSerializer if self.action == "retrieve" else PlaylistSerializer

    def perform_update(self, serializer):
        # Metadata edit (owner or collaborator) → save + log to the audit trail.
        # The is_public column guard lives in PlaylistUpdateSerializer.
        with transaction.atomic():
            playlist = serializer.save()
            collab.log(playlist, self.request.user, PlaylistActivity.Action.METADATA_EDITED)
            realtime.broadcast_playlist_changed(playlist.id)

    @extend_schema(request=CreatePlaylistSerializer, responses=PlaylistSerializer)
    def create(self, request, *args, **kwargs):
        s = CreatePlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        sp_id = s.validated_data.get("source_playlist")
        origin = SourcePlaylist.objects.filter(pk=sp_id).first() if sp_id else None
        playlist = create_playlist_from_tracks(
            user=request.user,
            title=s.validated_data["title"],
            track_ids=s.validated_data["track_ids"],
            artwork_url=s.validated_data.get("artwork_url", ""),
            origin=origin,
        )
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistSerializer(playlist).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=PlaylistDetailSerializer)
    @action(detail=True, methods=["post"])
    def refresh(self, request, pk=None):
        """Re-fetch this playlist from its source and mirror its tracks (sync from
        source — discards manual edits). 400 if it has no source origin."""
        playlist = self.get_object()
        try:
            refresh_playlist(playlist, user=request.user)
        except (UnsupportedSourceError, SpotifyError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        realtime.broadcast_playlist_changed(playlist.id)
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistDetailSerializer(playlist, context={"request": request}).data)

    @extend_schema(responses=PlaylistTrackSerializer(many=True))
    @action(detail=True, methods=["get"])
    def tracks(self, request, pk=None):
        """Paginated tracks for one playlist, in playlist order.

        The detail endpoint returns metadata only; the client pages through the
        tracks here so opening a long playlist doesn't inline every track.
        `?search=` narrows to tracks whose title or artist matches (server-side).
        """
        # Fetch via get_queryset (owner-scoped) but NOT self.get_object(), which runs
        # filter_queryset — the title SearchFilter would 404 the playlist whenever a
        # track `?search=` doesn't also match the playlist's title.
        playlist = get_object_or_404(self.get_queryset(), pk=pk)
        qs = (
            playlist.items.select_related("track", "added_by")
            .prefetch_related("track__playback_sources")
            .order_by("position")
        )
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(track__title__icontains=search) | Q(track__primary_artist__icontains=search)
            )
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(PlaylistTrackSerializer(page, many=True).data)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"], url_path="remove-track")
    def remove_track(self, request, pk=None):
        """Remove one track from this playlist and re-pack positions. The global
        Track row is untouched — only the membership (PlaylistTrack) is dropped.
        Allowed for the owner and accepted collaborators."""
        playlist = self.get_object()
        with transaction.atomic():
            item = (
                playlist.items.select_related("track")
                .filter(track_id=request.data.get("track_id"))
                .first()
            )
            if item is None:
                raise Http404("Track not in this playlist.")
            title = item.track.title
            item.delete()
            _repack(playlist)
            collab.record_track_edit(
                playlist,
                request.user,
                PlaylistActivity.Action.TRACKS_REMOVED,
                summary=f"removed “{title}”",
                count=1,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"], url_path="remove-tracks")
    def remove_tracks(self, request, pk=None):
        """Remove one OR many tracks (batch) and re-pack once. Idempotent — ids not
        in the playlist are simply ignored. Owner + accepted collaborators."""
        playlist = self.get_object()
        ids = request.data.get("track_ids") or []
        with transaction.atomic():
            n = playlist.items.filter(track_id__in=ids).count()
            if n:
                playlist.items.filter(track_id__in=ids).delete()
                _repack(playlist)
                collab.record_track_edit(
                    playlist,
                    request.user,
                    PlaylistActivity.Action.TRACKS_REMOVED,
                    summary=f"removed {n} track{'s' if n != 1 else ''}",
                    count=n,
                )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"], url_path="add-tracks")
    def add_tracks(self, request, pk=None):
        """Append tracks to the end of the playlist, in request order, skipping any
        already present. The write path for collaboration — available to the owner
        and accepted collaborators."""
        playlist = self.get_object()
        ids = request.data.get("track_ids") or []
        with transaction.atomic():
            existing = set(playlist.items.values_list("track_id", flat=True))
            by_id = {str(t.id): t for t in Track.objects.filter(pk__in=ids)}
            pos = playlist.items.count()
            added = []
            for tid in ids:
                track = by_id.get(str(tid))
                if track is None or track.id in existing:
                    continue
                PlaylistTrack.objects.create(
                    playlist=playlist, track=track, position=pos, added_by=request.user
                )
                existing.add(track.id)
                pos += 1
                added.append(track)
            if added:
                summary = (
                    f"added “{added[0].title}”"
                    if len(added) == 1
                    else f"added {len(added)} tracks"
                )
                collab.record_track_edit(
                    playlist,
                    request.user,
                    PlaylistActivity.Action.TRACKS_ADDED,
                    summary=summary,
                    count=len(added),
                )
        return Response({"added": len(added)}, status=status.HTTP_200_OK)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """Move one track to an absolute position; renumber the rest 0..n-1."""
        playlist = self.get_object()
        try:
            target = int(request.data.get("position"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "position must be an integer."}, status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            items = list(playlist.items.order_by("position"))
            moving = next(
                (it for it in items if str(it.track_id) == str(request.data.get("track_id"))), None
            )
            if moving is None:
                raise Http404("Track not in this playlist.")
            items.remove(moving)
            items.insert(max(0, min(target, len(items))), moving)
            for i, it in enumerate(items):
                if it.position != i:
                    it.position = i
                    it.save(update_fields=["position"])
            collab.record_track_edit(
                playlist,
                request.user,
                PlaylistActivity.Action.TRACK_REORDERED,
                summary="reordered the tracks",
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- collaboration ---

    @extend_schema(request=None, responses=PlaylistCollaboratorSerializer(many=True))
    @action(detail=True, methods=["get", "post"])
    def collaborators(self, request, pk=None):
        """GET: list collaborators (owner + any member may view). POST: invite a user
        by `{user_id}` (owner only) — creates a PENDING invite + notifies them."""
        if request.method == "POST":
            playlist = get_object_or_404(
                Playlist.objects.filter(created_by=request.user), pk=pk
            )
            invitee = get_object_or_404(User, pk=request.data.get("user_id"))
            try:
                c = collab.invite(playlist, invitee=invitee, by=request.user)
            except collab.CollaboratorError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            return Response(
                PlaylistCollaboratorSerializer(c).data, status=status.HTTP_201_CREATED
            )
        playlist = self._member_playlist(pk)
        qs = playlist.collaborators.select_related("user").order_by("-created_at")
        page = self.paginate_queryset(qs)  # 25/page; the client loads more on scroll
        return self.get_paginated_response(PlaylistCollaboratorSerializer(page, many=True).data)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["delete"], url_path="collaborators/(?P<user_id>[^/.]+)")
    def remove_collaborator(self, request, pk=None, user_id=None):
        """Owner removes any collaborator, or a collaborator removes themselves (leave)."""
        c = get_object_or_404(PlaylistCollaborator, playlist_id=pk, user_id=user_id)
        is_owner = c.playlist.created_by_id == request.user.id
        if not (is_owner or c.user_id == request.user.id):
            return Response(
                {"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN
            )
        collab.remove(c, by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"], url_path="collab-accept")
    def collab_accept(self, request, pk=None):
        """The invitee accepts a pending collaboration invite (→ edit access)."""
        c = get_object_or_404(PlaylistCollaborator, playlist_id=pk, user=request.user)
        collab.accept(c, by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"], url_path="collab-decline")
    def collab_decline(self, request, pk=None):
        """The invitee declines their own pending invite (drops the row)."""
        c = get_object_or_404(PlaylistCollaborator, playlist_id=pk, user=request.user)
        collab.remove(c, by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses=PlaylistActivitySerializer(many=True))
    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        """The playlist's edit history (owner + any member may view), paginated."""
        playlist = self._member_playlist(pk)
        qs = playlist.activity.select_related("actor").all()
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(PlaylistActivitySerializer(page, many=True).data)


def _repack(playlist):
    """Renumber a playlist's items to contiguous positions 0..n-1."""
    for i, item in enumerate(playlist.items.order_by("position")):
        if item.position != i:
            item.position = i
            item.save(update_fields=["position"])


class TrackViewSet(viewsets.ReadOnlyModelViewSet):
    """Retrieve tracks; resolve a track's playback source (match), proxy its
    audio (stream), and self-heal cover art (refresh-artwork)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TrackSerializer

    def get_queryset(self):
        return Track.objects.prefetch_related("playback_sources").all()

    @extend_schema(responses=TrackSerializer(many=True))
    @action(detail=False, methods=["get"])
    def search(self, request):
        """Global song search via `?q=`. Finds songs on Spotify (relevance order)
        and upserts them as catalog Tracks; YouTube audio resolves on play."""
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response([])
        try:
            tracks = search_songs(query, limit=25)
        except SpotifyError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(TrackSerializer(tracks, many=True).data)

    @extend_schema(request=None, responses=PlaybackSourceSerializer)
    @action(detail=True, methods=["post"])
    def match(self, request, pk=None):
        """Resolve this track's YouTube source on demand (lazy — used by Play).

        Returns the existing active source if already matched (no wasted
        YouTube search); otherwise resolves one; 404 if nothing fits.
        """
        # Lock the track row so concurrent match-on-play calls (every client in a
        # jam fires one for the same current track) serialize: the first resolves
        # + creates the ACTIVE source, the rest wait and then find it — instead of
        # racing into duplicate inserts that violate one_active_playback_source_per_track.
        with transaction.atomic():
            track = get_object_or_404(Track.objects.select_for_update(), pk=pk)
            ps = (
                track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).first()
                or match.match_track_to_youtube(track)
            )
        if ps is None:
            return Response({"detail": "No YouTube match found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PlaybackSourceSerializer(ps).data)

    @extend_schema(request=None, responses=TrackSerializer)
    @action(detail=True, methods=["post"], url_path="refresh-artwork")
    def refresh_artwork(self, request, pk=None):
        """Self-heal a broken cover: clear it and re-resolve from the origin
        (Spotify/Apple), falling back to the YouTube thumbnail. The frontend calls
        this when an <img> fails to load (the CDN URL rotted)."""
        track = get_object_or_404(Track, pk=pk)
        track.artwork_url = ""
        track.save(update_fields=["artwork_url"])
        ps = track.playback_sources.filter(
            status=PlaybackSource.Status.ACTIVE,
            locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
        ).first()
        match.backfill_artwork(track, ps.locator if ps else "")
        track.refresh_from_db()
        return Response(TrackSerializer(track).data)
