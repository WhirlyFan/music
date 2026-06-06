"""Project-level WebSocket URL routing.

Aggregates each app's WS routes. Room/jam consumers land here in a later stage;
for now only the liveness probe is wired.
"""

from django.urls import path

from apps.core.consumers import PingConsumer
from apps.rooms.routing import websocket_urlpatterns as rooms_ws

websocket_urlpatterns = [
    path("ws/ping/", PingConsumer.as_asgi()),
    *rooms_ws,
]
