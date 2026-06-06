import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.friends import services
from apps.friends.models import Friendship
from apps.notifications.models import Notification
from apps.users.tests.factories import UserFactory


def _authed(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.mark.django_db
def test_send_request_creates_pending_and_notifies():
    a, b = UserFactory(), UserFactory()
    fr = services.send_request(a, b)
    assert fr.status == Friendship.Status.PENDING
    note = Notification.objects.get(recipient=b, kind=Notification.Kind.FRIEND_REQUEST)
    assert note.actor_id == a.id
    assert note.payload == {"friendship_id": str(fr.id)}


@pytest.mark.django_db
def test_cannot_friend_yourself():
    a = UserFactory()
    with pytest.raises(services.FriendshipError):
        services.send_request(a, a)


@pytest.mark.django_db
def test_duplicate_request_is_idempotent():
    a, b = UserFactory(), UserFactory()
    first = services.send_request(a, b)
    again = services.send_request(a, b)
    assert first.id == again.id
    assert Friendship.objects.count() == 1


@pytest.mark.django_db
def test_reciprocal_request_auto_accepts_instead_of_mirroring():
    a, b = UserFactory(), UserFactory()
    services.send_request(a, b)  # a → b pending
    fr = services.send_request(b, a)  # b asks a back → accept a's request
    assert fr.status == Friendship.Status.ACCEPTED
    assert Friendship.objects.count() == 1  # no mirror row
    # The original requester (a) is told their request was accepted.
    assert Notification.objects.filter(
        recipient=a, kind=Notification.Kind.FRIEND_ACCEPT, actor=b
    ).exists()


@pytest.mark.django_db
def test_accept_notifies_requester_and_is_idempotent():
    a, b = UserFactory(), UserFactory()
    fr = services.send_request(a, b)
    services.accept(fr, by=b)
    fr.refresh_from_db()
    assert fr.status == Friendship.Status.ACCEPTED and fr.responded_at is not None
    services.accept(fr, by=b)  # no second notification
    assert Notification.objects.filter(kind=Notification.Kind.FRIEND_ACCEPT).count() == 1


@pytest.mark.django_db
def test_friends_list_and_requests_split():
    me, fr_user, asker = UserFactory(), UserFactory(), UserFactory()
    services.accept(services.send_request(me, fr_user), by=fr_user)  # accepted friend
    services.send_request(me, UserFactory())  # outgoing pending
    services.send_request(asker, me)  # incoming pending

    api = _authed(me)
    friends = api.get("/api/v1/friends/").data["results"]  # paginated
    assert len(friends) == 1 and friends[0]["status"] == "accepted"

    reqs = api.get("/api/v1/friends/requests/").data
    assert len(reqs["incoming"]) == 1 and reqs["incoming"][0]["requester"]["id"] == str(asker.id)
    assert len(reqs["outgoing"]) == 1


@pytest.mark.django_db
def test_request_endpoint_uses_user_id():
    me, target = UserFactory(), UserFactory()
    api = _authed(me)
    resp = api.post("/api/v1/friends/request/", {"user_id": str(target.id)}, format="json")
    assert resp.status_code == 201
    assert Friendship.objects.filter(requester=me, addressee=target).exists()


@pytest.mark.django_db
def test_only_addressee_can_accept():
    a, b = UserFactory(), UserFactory()
    fr = services.send_request(a, b)
    # a (the requester) can't accept their own request.
    assert _authed(a).post(f"/api/v1/friends/{fr.id}/accept/").status_code == 403
    assert _authed(b).post(f"/api/v1/friends/{fr.id}/accept/").status_code == 200


@pytest.mark.django_db
def test_unfriend_and_scoping():
    a, b, stranger = UserFactory(), UserFactory(), UserFactory()
    fr = services.accept(services.send_request(a, b), by=b)
    # A stranger can't see or delete someone else's friendship (scoped queryset → 404).
    assert _authed(stranger).delete(f"/api/v1/friends/{fr.id}/").status_code == 404
    assert _authed(a).delete(f"/api/v1/friends/{fr.id}/").status_code == 204
    assert not Friendship.objects.filter(pk=fr.id).exists()


@pytest.mark.django_db
def test_user_search_excludes_self_and_matches_username():
    me = UserFactory(username="alice")
    UserFactory(username="bob")
    api = _authed(me)
    results = api.get("/api/v1/users/search/?q=b").data["results"]  # paginated
    names = {u["username"] for u in results}
    assert "bob" in names and "alice" not in names
    assert api.get("/api/v1/users/search/?q=").data["results"] == []


@pytest.mark.django_db
def test_public_profile_reports_relationship():
    me = UserFactory(username="me")
    friend = UserFactory(username="pal")
    stranger = UserFactory(username="rando")  # noqa: F841 — exists so 'rando' resolves
    asker = UserFactory(username="asker")
    services.accept(services.send_request(me, friend), by=friend)  # friends
    services.send_request(asker, me)  # asker → me (incoming, pending)
    api = _authed(me)

    assert api.get("/api/v1/users/profile/me/").data["relationship"]["status"] == "self"
    assert api.get("/api/v1/users/profile/pal/").data["relationship"]["status"] == "friends"
    assert api.get("/api/v1/users/profile/rando/").data["relationship"]["status"] == "none"
    incoming = api.get("/api/v1/users/profile/asker/").data["relationship"]
    assert incoming["status"] == "incoming" and "id" in incoming
    assert api.get("/api/v1/users/profile/nope/").status_code == 404
