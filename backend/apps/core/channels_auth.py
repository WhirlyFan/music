"""WebSocket authentication from an allauth headless ``X-Session-Token``.

The web app authenticates its WebSockets via the Django session cookie
(``AuthMiddlewareStack``). The native desktop app has no cookie — its local
proxy authenticates with an allauth headless **session token** sent as the
``X-Session-Token`` header (the same token DRF's ``XSessionTokenAuthentication``
accepts). This middleware reads that header off the WS upgrade and resolves it to
a user, mirroring the HTTP path so both client kinds work.

Wire it *inside* ``AuthMiddlewareStack`` so it runs after cookie auth and only
overrides ``scope["user"]`` when a valid token is present:

    AuthMiddlewareStack(XSessionTokenAuthMiddleware(URLRouter(...)))
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware


class XSessionTokenAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        token = None
        for name, value in scope.get("headers", []):
            if name == b"x-session-token":
                token = value.decode()
                break
        if token:
            user = await _user_from_token(token)
            if user is not None:
                scope["user"] = user
        return await super().__call__(scope, receive, send)


@database_sync_to_async
def _user_from_token(token: str):
    # Reuse allauth's own resolver so token semantics stay identical to the HTTP
    # path (XSessionTokenAuthentication). The session token is the Django session
    # key; this looks it up and returns the authenticated user (or None).
    from allauth.headless.internal.sessionkit import authenticate_by_x_session_token

    result = authenticate_by_x_session_token(token)
    return result[0] if result else None
