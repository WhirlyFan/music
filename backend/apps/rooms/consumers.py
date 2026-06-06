"""WebSocket consumer for a room/jam.

Read-only by design: clients never send playback commands here — those stay on
the REST endpoints (which broadcast). The consumer authenticates via the session
cookie carried on the upgrade, verifies room membership, joins the room's group,
sends an initial snapshot, and relays every `room.update` the group receives. A
low-frequency snapshot heartbeat re-pushes current state so a client that missed
the last frame (and gets no further action) can't sit stale — the gap #2 backstop
from the design review.

Room tables carry no RLS policies (only catalog.Playlist does), so the snapshot
queries need no per-request RLS context.
"""

import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import broadcast, snapshot
from .models import Room, RoomMember

# How often each socket re-receives a full snapshot as a staleness backstop.
# Slow on purpose — real changes arrive instantly via broadcast; this only
# bounds how long a *missed* final frame can leave a client behind.
HEARTBEAT_SECONDS = 20


class RoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get("user")
        if self.user is None or not self.user.is_authenticated:
            await self.close(code=4401)  # unauthenticated
            return
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        if not await self._is_member():
            await self.close(code=4403)  # not a member of this room
            return

        self.group = broadcast.group_name(self.room_id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        # Per-user group for targeted signals (e.g. being kicked).
        self.user_group = broadcast.user_group(self.user.id)
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        await self.accept()

        data = await self._snapshot()
        if data is not None:
            await self._send_room(data)  # immediately current on connect/reconnect
        self._heartbeat = asyncio.create_task(self._heartbeat_loop())

    async def disconnect(self, code):
        hb = getattr(self, "_heartbeat", None)
        if hb is not None:
            hb.cancel()
        group = getattr(self, "group", None)
        if group is not None:
            await self.channel_layer.group_discard(group, self.channel_name)
        user_group = getattr(self, "user_group", None)
        if user_group is not None:
            await self.channel_layer.group_discard(user_group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # The socket is read-only; the only client→server message is a keepalive.
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    # Channel-layer message {"type": "room.update", ...} → this handler.
    async def room_update(self, event):
        await self.send_json(
            {"type": "room.update", "room": event["room"], "generation": event["generation"]}
        )

    # {"type": "membership.revoked", ...} → this handler (I was kicked).
    async def membership_revoked(self, event):
        await self.send_json({"type": "membership.revoked", "room_id": event["room_id"]})

    # --- helpers ---

    async def _send_room(self, data):
        await self.send_json(
            {"type": "room.update", "room": data, "generation": data.get("generation", 0)}
        )

    async def _heartbeat_loop(self):
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_SECONDS)
                data = await self._snapshot()
                if data is not None:
                    await self._send_room(data)
        except asyncio.CancelledError:
            pass

    @database_sync_to_async
    def _is_member(self) -> bool:
        room = Room.objects.filter(pk=self.room_id, is_active=True).first()
        if room is None:
            return False
        if room.host_id == self.user.id:
            return True
        return RoomMember.objects.filter(room=room, user=self.user).exists()

    @database_sync_to_async
    def _snapshot(self):
        try:
            return snapshot.serialize_room(self.room_id)
        except Room.DoesNotExist:
            return None
