"""ASGI config — HTTP served by Django, WebSockets by Channels."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

# Must run before importing anything that touches Django models/apps (the
# consumers do). Initializing the HTTP app populates the app registry.
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402

from config.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # The session cookie is sent on the WS upgrade, so AuthMiddlewareStack
        # populates scope["user"]. OriginValidator only admits sockets opened
        # from our own frontend origins (CSWSH guard — see WEBSOCKET_ALLOWED_ORIGINS).
        "websocket": OriginValidator(
            AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
            settings.WEBSOCKET_ALLOWED_ORIGINS,
        ),
    }
)
