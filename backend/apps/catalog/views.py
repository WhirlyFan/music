from django.db.models import Count, Prefetch
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import match, streaming
from .models import PlaybackSource, Playlist, PlaylistTrack, Track
from .serializers import (
    IngestSerializer,
    MatchResultSerializer,
    PlaybackSourceSerializer,
    PlaylistDetailSerializer,
    PlaylistSerializer,
    SetSourceSerializer,
    TrackSerializer,
)
from .services import ingest_apple_playlist

# Prefetch playlist items (ordered) + each track's playback sources in one go.
_DETAIL_PREFETCH = [
    Prefetch(
        "items",
        queryset=PlaylistTrack.objects.select_related("track").order_by("position"),
    ),
    "items__track__playback_sources",
]


class PlaylistViewSet(viewsets.ReadOnlyModelViewSet):
    """List/retrieve playlists, plus ingest + match actions."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Playlist.objects.annotate(track_count=Count("items")).order_by("-created_at")
        if self.action == "retrieve":
            qs = qs.prefetch_related(*_DETAIL_PREFETCH)
        return qs

    def get_serializer_class(self):
        return PlaylistDetailSerializer if self.action == "retrieve" else PlaylistSerializer

    def _detail_response(self, playlist, status_code=status.HTTP_200_OK):
        playlist = (
            Playlist.objects.annotate(track_count=Count("items"))
            .prefetch_related(*_DETAIL_PREFETCH)
            .get(pk=playlist.pk)
        )
        return Response(PlaylistDetailSerializer(playlist).data, status=status_code)

    @extend_schema(request=IngestSerializer, responses=PlaylistDetailSerializer)
    @action(detail=False, methods=["post"])
    def ingest(self, request):
        serializer = IngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        url = serializer.validated_data["url"]
        if "music.apple.com" not in url:
            return Response(
                {"detail": "Only Apple Music URLs are supported for now."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        playlist = ingest_apple_playlist(url, user=request.user)
        return self._detail_response(playlist, status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=MatchResultSerializer)
    @action(detail=True, methods=["post"])
    def match(self, request, pk=None):
        """Resolve YouTube playback sources for this playlist's unmatched tracks."""
        playlist = get_object_or_404(Playlist, pk=pk)
        matched = 0
        for item in playlist.items.select_related("track"):
            if match.match_track_to_youtube(item.track):
                matched += 1
        return Response({"matched": matched})


class TrackViewSet(viewsets.ReadOnlyModelViewSet):
    """Retrieve tracks; list candidates; correct the active playback source."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TrackSerializer

    def get_queryset(self):
        return Track.objects.prefetch_related("playback_sources").all()

    @extend_schema(responses=PlaybackSourceSerializer(many=True))
    @action(detail=True, methods=["get"])
    def candidates(self, request, pk=None):
        track = get_object_or_404(Track, pk=pk)
        rows = track.playback_sources.exclude(status=PlaybackSource.Status.REPLACED).order_by(
            "-confidence"
        )
        return Response(PlaybackSourceSerializer(rows, many=True).data)

    @extend_schema(request=None, responses=PlaybackSourceSerializer)
    @action(detail=True, methods=["post"])
    def match(self, request, pk=None):
        """Resolve this track's YouTube source on demand (lazy — used by Play).

        Returns the existing active source if already matched (no wasted
        YouTube search); otherwise resolves one; 404 if nothing fits.
        """
        track = get_object_or_404(Track, pk=pk)
        ps = (
            track.playback_sources.filter(status=PlaybackSource.Status.ACTIVE).first()
            or match.match_track_to_youtube(track)
        )
        if ps is None:
            return Response(
                {"detail": "No YouTube match found."}, status=status.HTTP_404_NOT_FOUND
            )
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

        audio = streaming.resolved_audio(ps.locator)
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

    @extend_schema(request=SetSourceSerializer, responses=PlaybackSourceSerializer)
    @action(detail=True, methods=["post"], url_path="set-source")
    def set_source(self, request, pk=None):
        track = get_object_or_404(Track, pk=pk)
        serializer = SetSourceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get("playback_source_id"):
            ps = get_object_or_404(track.playback_sources, pk=data["playback_source_id"])
            ps = match.promote_candidate(ps, user=request.user)
        else:
            ps = match.set_manual_youtube_source(track, data["video_id"], user=request.user)
        return Response(PlaybackSourceSerializer(ps).data)
