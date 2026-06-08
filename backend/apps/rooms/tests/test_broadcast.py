"""Stage 3: every room mutation fans out to the room's channel group."""

import asyncio

import pytest
from allauth.account.models import EmailAddress
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework.test import APIClient

from apps.rooms import broadcast, services
from apps.users.tests.factories import UserFactory


def authed():
    user = UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def _recv(layer, chan, timeout=3):
    async def go():
        return await asyncio.wait_for(layer.receive(chan), timeout)

    return async_to_sync(go)()


@pytest.mark.django_db
def test_joining_another_jam_refreshes_the_one_you_left():
    # Guest is in jam A; joining jam B must broadcast to A so its count drops now
    # (not only on the next heartbeat).
    host_a, _ = authed()
    code_a = host_a.post("/api/v1/rooms/share/").json()["code"]
    room_a_id = host_a.get("/api/v1/rooms/me/").json()["id"]
    host_b, _ = authed()
    code_b = host_b.post("/api/v1/rooms/share/").json()["code"]
    guest, _ = authed()
    guest.post("/api/v1/rooms/join/", {"code": code_a}, format="json")

    layer = get_channel_layer()
    chan = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(broadcast.group_name(room_a_id), chan)

    guest.post("/api/v1/rooms/join/", {"code": code_b}, format="json")

    msg = _recv(layer, chan)
    assert msg["type"] == "room.update"
    assert msg["room"]["members_count"] == 1  # only host A remains


@pytest.mark.django_db
def test_mutation_broadcasts_room_update_to_group():
    api, user = authed()
    room = services.get_active_room(user)
    layer = get_channel_layer()
    chan = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(broadcast.group_name(room.id), chan)

    res = api.post("/api/v1/rooms/clear/")
    assert res.status_code == 200

    msg = _recv(layer, chan)
    assert msg["type"] == "room.update"
    assert msg["room"]["id"] == str(room.id)
    assert msg["generation"] >= 1


@pytest.mark.django_db
def test_generation_increments_each_mutation():
    api, _ = authed()
    g1 = api.post("/api/v1/rooms/clear/").json()["generation"]
    g2 = api.post("/api/v1/rooms/clear/").json()["generation"]
    assert g2 == g1 + 1


@pytest.mark.django_db
def test_read_endpoints_do_not_bump_generation():
    api, _ = authed()
    g1 = api.get("/api/v1/rooms/me/").json()["generation"]
    g2 = api.get("/api/v1/rooms/me/").json()["generation"]
    assert g1 == g2  # plain reads have no side effects


@pytest.mark.django_db
def test_sync_reanchors_position_and_broadcasts():
    api, user = authed()
    room = services.get_active_room(user)
    layer = get_channel_layer()
    chan = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(broadcast.group_name(room.id), chan)

    res = api.post("/api/v1/rooms/sync/", {"position_ms": 42000, "is_playing": True}, format="json")
    assert res.status_code == 200
    body = res.json()
    assert body["position_ms"] == 42000
    assert body["is_playing"] is True
    assert body["playing_since"] is not None  # anchor set so guests recompute

    msg = _recv(layer, chan)
    assert msg["room"]["position_ms"] == 42000


@pytest.mark.django_db
def test_sync_paused_clears_anchor():
    api, _ = authed()
    body = api.post(
        "/api/v1/rooms/sync/", {"position_ms": 1000, "is_playing": False}, format="json"
    ).json()
    assert body["is_playing"] is False
    assert body["position_ms"] == 1000
    assert body["playing_since"] is None  # paused → position holds, no clock running
