from django.db.models import Count, Prefetch
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
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
    TrackSerializer,
)
from .services import UnsupportedSourceError, create_playlist_from_tracks
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


class PlaylistViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """List/retrieve owned playlists, and create a named one from track ids
    (e.g. saving an import)."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Playlist.objects.annotate(track_count=Count("items")).order_by("-created_at")
        if self.action == "retrieve":
            qs = qs.prefetch_related(*_DETAIL_PREFETCH)
        return qs

    def get_serializer_class(self):
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
        """
        playlist = self.get_object()
        qs = (
            playlist.items.select_related("track")
            .prefetch_related("track__playback_sources")
            .order_by("position")
        )
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(PlaylistTrackSerializer(page, many=True).data)


class TrackViewSet(viewsets.ReadOnlyModelViewSet):
    """Retrieve tracks; resolve a track's playback source (match), proxy its
    audio (stream), and self-heal cover art (refresh-artwork)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TrackSerializer

    def get_queryset(self):
        return Track.objects.prefetch_related("playback_sources").all()

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
