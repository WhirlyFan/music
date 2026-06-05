"""Project-level WebSocket URL routing.

Aggregates each app's WS routes. Room/jam consumers land here in a later stage;
for now only the liveness probe is wired.
"""

from django.urls import path

from apps.core.consumers import PingConsumer

websocket_urlpatterns = [
    path("ws/ping/", PingConsumer.as_asgi()),
]
