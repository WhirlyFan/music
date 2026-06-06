"""Project-level WebSocket URL routing.

Aggregates each app's WS routes. Room/jam consumers land here in a later stage;
for now only the liveness probe is wired.
"""

from django.urls import path

from apps.catalog.routing import websocket_urlpatterns as catalog_ws
from apps.core.consumers import PingConsumer
from apps.notifications.routing import websocket_urlpatterns as notifications_ws
from apps.rooms.routing import websocket_urlpatterns as rooms_ws

websocket_urlpatterns = [
    path("ws/ping/", PingConsumer.as_asgi()),
    *rooms_ws,
    *notifications_ws,
    *catalog_ws,
]
