"""Jam (shared-room) API tests — share, join-by-code, membership, current."""

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.rooms.models import Room, RoomMember
from apps.users.tests.factories import UserFactory


def authed(user=None):
    """An API client force-authenticated as a verified user (and the user)."""
    user = user or UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def members_of(api):
    """The jam roster via the paginated members endpoint (host first)."""
    return api.get("/api/v1/rooms/members/").json()["results"]


@pytest.mark.django_db
def test_share_creates_code_and_host_member():
    api, user = authed()
    res = api.post("/api/v1/rooms/share/")
    assert res.status_code == 200
    body = res.json()
    assert body["is_shared"] is True
    assert body["code"] and len(body["code"]) == 6
    assert body["members_count"] == 1
    # Host is recorded as a member with the host role.
    roster = members_of(api)
    assert [m["role"] for m in roster] == ["host"]
    assert roster[0]["user_id"] == str(user.id)


@pytest.mark.django_db
def test_share_is_idempotent_keeps_code():
    api, _ = authed()
    first = api.post("/api/v1/rooms/share/").json()
    second = api.post("/api/v1/rooms/share/").json()
    assert first["code"] == second["code"]
    # No duplicate host membership.
    assert second["members_count"] == 1
    assert len(members_of(api)) == 1


@pytest.mark.django_db
def test_join_by_code_adds_guest_member():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]

    guest_api, guest = authed()
    res = guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")
    assert res.status_code == 200
    body = res.json()
    assert body["host_id"] == str(host.id)
    roles = {m["user_id"]: m["role"] for m in members_of(guest_api)}
    assert roles[str(host.id)] == "host"
    assert roles[str(guest.id)] == "guest"


@pytest.mark.django_db
def test_join_is_case_insensitive_and_idempotent():
    host_api, _ = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, guest = authed()

    guest_api.post("/api/v1/rooms/join/", {"code": code.lower()}, format="json")
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")
    # Joined once despite two requests + a lowercased code.
    assert sum(m["role"] == "guest" for m in members_of(guest_api)) == 1


@pytest.mark.django_db
def test_join_unknown_code_is_404():
    api, _ = authed()
    res = api.post("/api/v1/rooms/join/", {"code": "ZZZZZZ"}, format="json")
    assert res.status_code == 404


@pytest.mark.django_db
def test_one_jam_at_a_time_leaves_previous():
    code_a = authed()[0].post("/api/v1/rooms/share/").json()["code"]
    host_b_api, _ = authed()
    code_b = host_b_api.post("/api/v1/rooms/share/").json()["code"]

    guest_api, guest = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code_a}, format="json")
    guest_api.post("/api/v1/rooms/join/", {"code": code_b}, format="json")

    # Guest is a member of B, no longer of A.
    rooms = set(
        RoomMember.objects.filter(user=guest, role="guest").values_list(
            "room__code", flat=True
        )
    )
    assert rooms == {code_b}


@pytest.mark.django_db
def test_unshare_drops_guests_and_clears_code():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, _ = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")

    body = host_api.post("/api/v1/rooms/unshare/").json()
    assert body["is_shared"] is False
    assert body["code"] == ""
    assert body["members_count"] == 0
    assert members_of(host_api) == []
    assert not Room.objects.filter(code=code, is_shared=True).exists()


@pytest.mark.django_db
def test_current_returns_joined_jam_for_guest():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, _ = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")

    body = guest_api.get("/api/v1/rooms/current/").json()
    # The guest's "current" room is the host's jam, not their own.
    assert body["host_id"] == str(host.id)
    assert body["is_shared"] is True


@pytest.mark.django_db
def test_current_returns_own_room_when_not_in_jam():
    api, user = authed()
    body = api.get("/api/v1/rooms/current/").json()
    assert body["host_id"] == str(user.id)
    assert body["is_shared"] is False


@pytest.mark.django_db
def test_guest_control_gating_and_toggle():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, _ = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")

    # Default: a guest can't drive transport in the jam.
    r = guest_api.post(
        "/api/v1/rooms/sync/", {"position_ms": 1000, "is_playing": True}, format="json"
    )
    assert r.status_code == 403
    assert guest_api.post("/api/v1/rooms/next/").status_code == 403

    # Host enables guest control (broadcasts; guests see allow_guest_control).
    body = host_api.post(
        "/api/v1/rooms/guest-control/", {"enabled": True}, format="json"
    ).json()
    assert body["allow_guest_control"] is True

    # Now the guest drives the JAM (host's room), not their own.
    r = guest_api.post(
        "/api/v1/rooms/sync/", {"position_ms": 2000, "is_playing": True}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["host_id"] == str(host.id)
    assert r.json()["position_ms"] == 2000

    # Host turns it back off → guest is gated again.
    host_api.post("/api/v1/rooms/guest-control/", {"enabled": False}, format="json")
    assert (
        guest_api.post(
            "/api/v1/rooms/sync/", {"position_ms": 3000, "is_playing": True}, format="json"
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_host_can_kick_guest():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, guest = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")

    body = host_api.post(
        "/api/v1/rooms/kick/", {"user_id": str(guest.id)}, format="json"
    ).json()
    # Guest is gone from the jam; the host remains.
    assert body["members_count"] == 1
    assert [m["user_id"] for m in members_of(host_api)] == [str(host.id)]
    assert not RoomMember.objects.filter(user=guest, role="guest").exists()
    # Kicked guest's current falls back to their own room.
    assert guest_api.get("/api/v1/rooms/current/").json()["host_id"] == str(guest.id)


@pytest.mark.django_db
def test_guest_can_leave_and_falls_back_to_own_room():
    host_api, host = authed()
    code = host_api.post("/api/v1/rooms/share/").json()["code"]
    guest_api, guest = authed()
    guest_api.post("/api/v1/rooms/join/", {"code": code}, format="json")

    # While joined, current is the host's jam.
    assert guest_api.get("/api/v1/rooms/current/").json()["host_id"] == str(host.id)

    res = guest_api.post("/api/v1/rooms/leave/")
    assert res.status_code == 200
    # Leave responds with the guest's OWN room, and current now resolves there.
    assert res.json()["host_id"] == str(guest.id)
    assert guest_api.get("/api/v1/rooms/current/").json()["host_id"] == str(guest.id)
    assert not RoomMember.objects.filter(user=guest, role="guest").exists()
    # Host's jam no longer lists the guest.
    assert [m["user_id"] for m in members_of(host_api)] == [str(host.id)]
