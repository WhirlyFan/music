"""WebSocket consumer for live playlist-view updates.

Anyone who can VIEW a playlist (owner, public, or collaborator) subscribes to
`playlist.{id}` while on the page and receives a content-less `playlist.changed`
nudge whenever it's edited — then refetches over REST. Read-only and payload-free,
so it's safe for the open-ended set of viewers a public playlist can have. The
durable, per-user notification socket stays the channel for owner/collaborators.
"""

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django_rls.db.functions import RLSContext

from .models import Playlist
from .realtime import playlist_group


class PlaylistConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get("user")
        if self.user is None or not self.user.is_authenticated:
            await self.close(code=4401)  # unauthenticated — no anonymous subscribers
            return
        self.playlist_id = self.scope["url_route"]["kwargs"]["playlist_id"]
        if not await self._can_view():
            await self.close(code=4403)  # can't view this playlist
            return
        self.group = playlist_group(self.playlist_id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        group = getattr(self, "group", None)
        if group is not None:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Read-only; the only client→server message is a keepalive.
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    # {"type": "playlist.changed"} fanned to the group → this handler → the client,
    # which refetches the playlist (the frame carries no data).
    async def playlist_changed(self, event):
        await self.send_json({"type": "playlist.changed"})

    @database_sync_to_async
    def _can_view(self) -> bool:
        # The consumer has no HTTP RLS middleware, so scope the check to this user
        # and let RLS (owner | public | collaborator) decide visibility — exactly
        # what the retrieve endpoint allows.
        with RLSContext(user_id=str(self.user.id)):
            return Playlist.objects.filter(pk=self.playlist_id).exists()
