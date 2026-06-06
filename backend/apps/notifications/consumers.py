from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import notification_group


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """A global per-user socket for live events — independent of any room or page, so
    a user receives notifications wherever they are in the app. It carries no payload:
    on a nudge the client refetches the (durable) notifications from the REST API."""

    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)  # unauthenticated
            return
        self.group = notification_group(user.id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        group = getattr(self, "group", None)
        if group is not None:
            await self.channel_layer.group_discard(group, self.channel_name)

    # {"type": "notification.new"} fanned to the group → this handler → the client.
    async def notification_new(self, event):
        await self.send_json({"type": "notification.new"})
