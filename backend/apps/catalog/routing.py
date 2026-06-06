"""WebSocket routes for live playlist-view updates."""

from django.urls import path

from .consumers import PlaylistConsumer

websocket_urlpatterns = [
    path("ws/playlists/<uuid:playlist_id>/", PlaylistConsumer.as_asgi()),
]
