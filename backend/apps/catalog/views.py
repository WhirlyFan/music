from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import match, streaming
from .ingest.spotify import SpotifyError
from .models import PlaybackSource, Playlist, PlaylistTrack, Track
from .serializers import (
    CreatePlaylistSerializer,
    ImportResultSerializer,
    IngestSerializer,
    PlaybackSourceSerializer,
    PlaylistDetailSerializer,
    PlaylistSerializer,
    PlaylistTrackSerializer,
    PlaylistUpdateSerializer,
    TrackSerializer,
)
from .services import UnsupportedSourceError, create_playlist_from_tracks, search_songs
from .services import ingest as ingest_source

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
        data = {
            "id": result["import"].id,
            "title": result["title"],
            "track_count": len(result["tracks"]),
            "tracks": result["tracks"],
            "cover": result.get("cover") or "",
            "note": result.get("note"),
        }
        return Response(ImportResultSerializer(data).data, status=status.HTTP_201_CREATED)


class PlaylistViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """The caller's own playlists: list/search, retrieve, create, rename/edit,
    delete, and edit track membership.

    Playlists are a shared/global table (not RLS); we scope every action to
    `created_by=request.user` so a caller only ever sees and mutates their own.
    Deleting a playlist drops its `PlaylistTrack` rows but leaves the global
    `Track`/`PlaybackSource` catalog intact (PlaylistTrack.track is PROTECT)."""

    permission_classes = [permissions.IsAuthenticated]
    # `?search=` matches a playlist by title. (Searching *within* a playlist's songs
    # lives on the playlist detail page's track search, not here.)
    filter_backends = [filters.SearchFilter]
    search_fields = ["title"]

    def get_queryset(self):
        qs = (
            Playlist.objects.filter(created_by=self.request.user)
            .annotate(track_count=Count("items", distinct=True))
            .order_by("-created_at")
        )
        if self.action == "retrieve":
            qs = qs.prefetch_related(*_DETAIL_PREFETCH)
        return qs

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return PlaylistUpdateSerializer
        return PlaylistDetailSerializer if self.action == "retrieve" else PlaylistSerializer

    @extend_schema(request=CreatePlaylistSerializer, responses=PlaylistSerializer)
    def create(self, request, *args, **kwargs):
        s = CreatePlaylistSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        playlist = create_playlist_from_tracks(
            user=request.user,
            title=s.validated_data["title"],
            track_ids=s.validated_data["track_ids"],
            artwork_url=s.validated_data.get("artwork_url", ""),
        )
        playlist = Playlist.objects.annotate(track_count=Count("items")).get(pk=playlist.pk)
        return Response(PlaylistSerializer(playlist).data, status=status.HTTP_201_CREATED)

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
            playlist.items.select_related("track")
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
        Track row is untouched — only the membership (PlaylistTrack) is dropped."""
        playlist = self.get_object()
        with transaction.atomic():
            deleted, _ = playlist.items.filter(track_id=request.data.get("track_id")).delete()
            if not deleted:
                raise Http404("Track not in this playlist.")
            _repack(playlist)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """Move one track to an absolute position; renumber the rest 0..n-1."""
        playlist = self.get_object()
        try:
            target = int(request.data.get("position"))
        except TypeError, ValueError:
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
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        track = get_object_or_404(Track, pk=pk)
        ps = track.playback_sources.filter(
            status=PlaybackSource.Status.ACTIVE
        ).first() or match.match_track_to_youtube(track)
        if ps is None:
            return Response({"detail": "No YouTube match found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PlaybackSourceSerializer(ps).data)

    @extend_schema(exclude=True)  # binary audio proxy — no typed client needed
    @action(detail=True, methods=["get"])
    def stream(self, request, pk=None):
        """Proxy this track's audio from YouTube (resolved live via yt-dlp).

        Nothing is stored — we hold only the `video_id`; the audio is streamed
        through and never written. Range is forwarded so the <audio> element can
        seek. 404 until the track has an active source (Play matches first).
        """
        track = get_object_or_404(Track, pk=pk)
        ps = track.playback_sources.filter(
            status=PlaybackSource.Status.ACTIVE,
            locator_kind=PlaybackSource.LocatorKind.VIDEO_ID,
        ).first()
        if ps is None:
            raise Http404("Track has no active YouTube source.")

        # NOTE: artwork is resolved off this hot path (the client calls
        # refresh-artwork separately) — never make the audio wait on an image fetch.
        try:
            audio = streaming.resolved_audio(ps.locator)
        except Exception:  # noqa: BLE001 — yt-dlp/YouTube failure (rate limit, format, …)
            # Don't 500 with a stack trace: this is an upstream extraction failure,
            # not our bug. The client's <audio> onError surfaces a clear message.
            return Response(
                {"detail": "Couldn't load this track's audio from YouTube — try again shortly."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        headers = dict(audio.get("http_headers") or {})
        if request.headers.get("Range"):
            headers["Range"] = request.headers["Range"]
        upstream = streaming.open_upstream(audio["url"], headers)

        resp = StreamingHttpResponse(
            streaming.stream_chunks(upstream),
            status=getattr(upstream, "status", 200),
            content_type=upstream.headers.get("Content-Type", "audio/mp4"),
        )
        for header in ("Content-Length", "Content-Range"):
            if upstream.headers.get(header):
                resp[header] = upstream.headers[header]
        resp["Accept-Ranges"] = "bytes"
        return resp

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
