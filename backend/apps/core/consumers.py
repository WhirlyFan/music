"""WebSocket consumers shared across the project."""

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class PingConsumer(AsyncJsonWebsocketConsumer):
    """Liveness probe — proves the ASGI/WebSocket path is wired end to end.

    Accepts any connection (origin is already vetted by OriginValidator),
    announces readiness, and echoes a pong for every frame it receives.
    Useful as a deploy smoke-test and a cheap "is the socket layer up" check.
    """

    async def connect(self):
        await self.accept()
        await self.send_json({"type": "ready"})

    async def receive_json(self, content, **kwargs):
        await self.send_json({"type": "pong", "echo": content})
