"""Invite-only signup: the adapter gate, the invite service, and the endpoint."""

import pytest
from allauth.account.models import EmailAddress
from allauth.core import context
from django.contrib.auth.models import AnonymousUser
from django.core import mail
from django.core.exceptions import ValidationError
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.users.adapter import AccountAdapter
from apps.users.invites import InviteError, create_invitation
from apps.users.models import Invitation
from apps.users.tests.factories import UserFactory

INVITE = "/api/v1/users/invite/"


@pytest.fixture
def member(db):
    user = UserFactory()
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    return user


@pytest.fixture
def client(member):
    api = APIClient()
    api.force_authenticate(member)
    return api


# ── adapter gate (the adapter reads allauth's request context, not a ctor arg) ─
def _anon_request():
    req = RequestFactory().post("/")
    req.user = AnonymousUser()
    return req


def _authed_request(user):
    req = RequestFactory().post("/")
    req.user = user
    return req


@pytest.mark.django_db
def test_adapter_blocks_uninvited_signup():
    with context.request_context(_anon_request()):  # anonymous → a signup
        with pytest.raises(ValidationError):
            AccountAdapter().clean_email("stranger@example.com")


@pytest.mark.django_db
def test_adapter_allows_invited_signup():
    Invitation.objects.create(email="invited@example.com")
    with context.request_context(_anon_request()):
        # Case-insensitive match against the pending invite → allowed.
        assert AccountAdapter().clean_email("Invited@example.com") == "Invited@example.com"


@pytest.mark.django_db
def test_adapter_allows_authed_email_change(member):
    # Authenticated user changing email → not a signup, so no invite required.
    with context.request_context(_authed_request(member)):
        assert AccountAdapter().clean_email("newaddr@example.com") == "newaddr@example.com"


# ── service ──────────────────────────────────────────────────────────────────
@pytest.mark.django_db
def test_create_invitation_sends_email(member):
    create_invitation("friend@example.com", invited_by=member)
    inv = Invitation.pending_for("friend@example.com")
    assert inv is not None and inv.invited_by == member
    assert len(mail.outbox) == 1
    assert "friend@example.com" in mail.outbox[0].to
    assert "/signup?email=" in mail.outbox[0].body  # link prefills the invitee's email


@pytest.mark.django_db
def test_create_invitation_rejects_existing_member(member):
    with pytest.raises(InviteError):
        create_invitation(member.email, invited_by=member)


@pytest.mark.django_db
def test_reinvite_refreshes_pending_not_duplicate(member):
    create_invitation("again@example.com", invited_by=member)
    create_invitation("again@example.com", invited_by=member)
    assert Invitation.objects.filter(email="again@example.com").count() == 1  # refreshed, not dup
    assert len(mail.outbox) == 2  # but re-sent both times


# ── endpoint (any logged-in member can invite) ───────────────────────────────
@pytest.mark.django_db
def test_invite_endpoint_creates_and_emails(client):
    r = client.post(INVITE, {"email": "newpal@example.com"}, format="json")
    assert r.status_code == 201, r.content
    assert Invitation.pending_for("newpal@example.com") is not None
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_invite_endpoint_requires_auth(db):
    r = APIClient().post(INVITE, {"email": "x@example.com"}, format="json")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
def test_invite_endpoint_existing_member_is_400(client, member):
    r = client.post(INVITE, {"email": member.email}, format="json")
    assert r.status_code == 400
