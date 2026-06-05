from rest_framework.routers import DefaultRouter

from .views import IngestViewSet, PlaylistViewSet, TrackViewSet

router = DefaultRouter()
router.register(r"ingest", IngestViewSet, basename="ingest")
router.register(r"playlists", PlaylistViewSet, basename="playlist")
router.register(r"tracks", TrackViewSet, basename="track")

urlpatterns = router.urls
