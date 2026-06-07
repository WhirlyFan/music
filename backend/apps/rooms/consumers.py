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

from . import broadcast, coordination, snapshot
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

        # This node is now present for synced-start readiness. A clean disconnect
        # drops it; a crash ages it out (coordination.PRESENCE_TTL).
        coordination.mark_present(self.room_id, self.user.id)

        data = await self._snapshot()
        if data is not None:
            await self._send_room(data)  # immediately current on connect/reconnect
        self._heartbeat = asyncio.create_task(self._heartbeat_loop())

    async def disconnect(self, code):
        # This node left, so it no longer counts toward "everyone is ready". Drop it
        # and re-check: the REMAINING present nodes may now all be ready (a node we
        # were waiting on just left), which should start the jam without the deadline.
        room_id = getattr(self, "room_id", None)
        if room_id is not None and getattr(self, "user", None) is not None:
            coordination.mark_absent(room_id, self.user.id)
            await database_sync_to_async(coordination.recheck)(room_id)
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
        # Playback commands still go over REST (the single write path). The only
        # client→server messages here are a keepalive and a synced-start readiness
        # report — neither mutates playback directly; readiness only *accelerates* a
        # start the server was already going to make at the deadline.
        msg_type = content.get("type")
        if msg_type == "ready":
            generation = content.get("generation")
            if isinstance(generation, int):
                coordination.touch(self.room_id, self.user.id)
                # DB + broadcast → run off the event loop.
                await database_sync_to_async(coordination.client_ready)(
                    self.room_id, self.user.id, generation
                )
            return
        if msg_type == "ping":
            coordination.touch(self.room_id, self.user.id)
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
        # Re-sends the FULL snapshot each tick. Strictly this only needs to re-anchor
        # the clock (position/playing_since/server_time/generation) — track/queue/
        # window change only via a room.update broadcast — so a lean `room.sync` frame
        # would be ~150 bytes vs a few KB. That trim was attempted (2026-06) but
        # *reproducibly* timed out the WS consumer tests (test_consumer.py) — even
        # tests it can't logically touch (anonymous/non-member reject) — which points
        # to a timing/teardown fragility we couldn't root-cause, not a logic bug. The
        # snapshot is already small (post context-windowing), so this is low priority;
        # revisit the trim in CI / with the dev backend stopped, or by raising the
        # WebsocketCommunicator receive timeout. See memory: ws-heartbeat-trim.
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_SECONDS)
                data = await self._snapshot()
                if data is not None:
                    await self._send_room(data)
                    # The send succeeded, so this node is alive → keep it present.
                    coordination.touch(self.room_id, self.user.id)
                # Recovery path: if a process restart lost the in-memory deadline
                # timer, a room can be stuck pending past its deadline. Any live
                # socket nudges it (idempotent — only flips if the deadline passed).
                await database_sync_to_async(coordination.start_overdue)(self.room_id)
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
