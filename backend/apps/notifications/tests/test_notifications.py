import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.notifications.events import emit
from apps.notifications.models import Notification
from apps.rooms import services
from apps.users.tests.factories import UserFactory


def _authed(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.mark.django_db
def test_emit_writes_durable_row_and_skips_self():
    a, b = UserFactory(), UserFactory()
    note = emit(Notification.Kind.JAM_JOIN, recipient=b, actor=a, room_id="x")
    assert note and note.recipient_id == b.id and note.actor_id == a.id
    assert note.payload == {"room_id": "x"}
    # Never notify yourself.
    assert emit(Notification.Kind.JAM_JOIN, recipient=a, actor=a) is None
    assert Notification.objects.count() == 1


@pytest.mark.django_db
def test_api_is_scoped_unread_count_and_mark_read():
    me, other = UserFactory(), UserFactory()
    emit(Notification.Kind.JAM_JOIN, recipient=me, actor=other)
    emit(Notification.Kind.JAM_JOIN, recipient=me, actor=other)
    emit(Notification.Kind.JAM_JOIN, recipient=other, actor=me)  # not mine

    api = _authed(me)
    listed = api.get("/api/v1/notifications/")
    assert listed.data["count"] == 2  # only mine, not `other`'s
    assert api.get("/api/v1/notifications/unread-count/").data["count"] == 2

    assert api.post("/api/v1/notifications/mark-read/", {}, format="json").status_code == 200
    assert api.get("/api/v1/notifications/unread-count/").data["count"] == 0
    # `other`'s notification is untouched (scoping).
    assert Notification.objects.filter(recipient=other, read_at__isnull=True).count() == 1


@pytest.mark.django_db
def test_dismiss_removes_a_notification_and_is_scoped():
    me, other = UserFactory(), UserFactory()
    mine = emit(Notification.Kind.FRIEND_REQUEST, recipient=me, actor=other)
    theirs = emit(Notification.Kind.FRIEND_REQUEST, recipient=other, actor=me)

    api = _authed(me)
    # I can dismiss my own (consume an actioned item) → it leaves the list.
    assert api.delete(f"/api/v1/notifications/{mine.id}/").status_code == 204
    assert not Notification.objects.filter(pk=mine.id).exists()
    # I can't dismiss someone else's (scoped queryset → 404).
    assert api.delete(f"/api/v1/notifications/{theirs.id}/").status_code == 404
    assert Notification.objects.filter(pk=theirs.id).exists()


@pytest.mark.django_db
def test_joining_a_jam_notifies_the_host():
    host, guest = UserFactory(), UserFactory()
    room = services.get_active_room(host)
    services.share_room(room)

    services.join_guest(room, guest)
    note = Notification.objects.filter(recipient=host, kind=Notification.Kind.JAM_JOIN).first()
    assert note is not None and note.actor_id == guest.id

    # Re-joining (idempotent membership) doesn't spam a second notification.
    services.join_guest(room, guest)
    assert Notification.objects.filter(recipient=host, kind=Notification.Kind.JAM_JOIN).count() == 1
