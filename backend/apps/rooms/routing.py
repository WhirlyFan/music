"""WebSocket routes for rooms/jams."""

from django.urls import path

from .consumers import RoomConsumer

websocket_urlpatterns = [
    path("ws/rooms/<uuid:room_id>/", RoomConsumer.as_asgi()),
]
