"""The welcome notification sent on first signup (apps.users.adapter._on_signup)."""

import pytest

from apps.notifications.models import Notification
from apps.users.adapter import _on_signup
from apps.users.models import Invitation
from apps.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_signup_welcomes_invited_user_crediting_inviter():
    inviter = UserFactory(username="host")
    Invitation.objects.create(email="newbie@example.com", invited_by=inviter)
    newbie = UserFactory(email="newbie@example.com", username="newbie")

    _on_signup(newbie)

    note = Notification.objects.get(recipient=newbie, kind=Notification.Kind.WELCOME)
    assert note.actor_id == inviter.id
    # The invite is consumed so the link can't be reused.
    assert Invitation.objects.get(email="newbie@example.com").accepted_at is not None


@pytest.mark.django_db
def test_signup_welcomes_uninvited_user_without_actor():
    user = UserFactory(email="solo@example.com", username="solo")
    _on_signup(user)
    note = Notification.objects.get(recipient=user, kind=Notification.Kind.WELCOME)
    assert note.actor_id is None
