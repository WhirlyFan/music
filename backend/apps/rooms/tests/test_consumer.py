"""RoomConsumer: auth, membership gate, snapshot-on-connect, group relay.

Transactional DB: the consumer reads via database_sync_to_async (a worker
thread / separate connection), so it only sees committed rows.
"""

import pytest
from allauth.account.models import EmailAddress
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import AnonymousUser

from apps.catalog.tests.factories import TrackFactory
from apps.rooms import broadcast, coordination, services
from apps.rooms.models import PlaybackState
from apps.rooms.routing import websocket_urlpatterns
from apps.users.tests.factories import UserFactory

app = URLRouter(websocket_urlpatterns)


def verified(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    return user


def _connect(room_id, user):
    comm = WebsocketCommunicator(app, f"/ws/rooms/{room_id}/")
    comm.scope["user"] = user  # bypass AuthMiddlewareStack; exercise the consumer's own gate
    return comm


@pytest.mark.django_db(transaction=True)
def test_host_connects_and_receives_snapshot():
    user = verified(UserFactory())
    room = services.get_active_room(user)

    async def scenario():
        comm = _connect(room.id, user)
        connected, _ = await comm.connect()
        assert connected
        msg = await comm.receive_json_from()
        assert msg["type"] == "room.update"
        assert msg["room"]["id"] == str(room.id)
        await comm.disconnect()

    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_anonymous_is_rejected():
    user = verified(UserFactory())
    room = services.get_active_room(user)

    async def scenario():
        comm = _connect(room.id, AnonymousUser())
        connected, code = await comm.connect()
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_non_member_is_rejected():
    host = verified(UserFactory())
    room = services.get_active_room(host)
    stranger = verified(UserFactory())  # not a member of host's room

    async def scenario():
        comm = _connect(room.id, stranger)
        connected, code = await comm.connect()
        assert connected is False
        assert code == 4403

    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_group_broadcast_is_relayed_to_socket():
    user = verified(UserFactory())
    room = services.get_active_room(user)

    async def scenario():
        comm = _connect(room.id, user)
        connected, _ = await comm.connect()
        assert connected
        await comm.receive_json_from()  # consume the initial snapshot

        layer = get_channel_layer()
        await layer.group_send(
            broadcast.group_name(room.id),
            {"type": "room.update", "room": {"id": str(room.id), "generation": 7}, "generation": 7},
        )
        msg = await comm.receive_json_from()
        assert msg["type"] == "room.update"
        assert msg["generation"] == 7
        await comm.disconnect()

    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_ready_message_starts_a_parked_shared_room():
    """The synced-start handshake end to end: connecting marks the node present, a
    `ready` report (it's the only present node) starts the parked track, and the
    consumer relays the resulting is_playing broadcast."""
    host = verified(UserFactory())
    room = services.get_active_room(host)
    services.share_room(room)
    track = TrackFactory()

    async def scenario():
        coordination._present.clear()
        coordination._ready.clear()
        comm = _connect(room.id, host)
        connected, _ = await comm.connect()
        assert connected
        await comm.receive_json_from()  # initial snapshot

        # Park a freshly-chosen track (service path → no broadcast of its own).
        await database_sync_to_async(services.play_now)(room, track, added_by=host)
        pb = await database_sync_to_async(PlaybackState.objects.get)(room=room)
        assert pb.pending_start is True

        # Report readiness → every present node (just the host) is ready → start.
        # The flip + broadcast cross a worker thread, which can lag past the default
        # 1s receive timeout when the whole suite runs — give it headroom.
        await comm.send_json_to({"type": "ready", "generation": pb.generation})
        msg = await comm.receive_json_from(timeout=5)
        assert msg["type"] == "room.update"
        assert msg["room"]["is_playing"] is True
        assert msg["room"]["pending_start"] is False
        await comm.disconnect()

    async_to_sync(scenario)()
