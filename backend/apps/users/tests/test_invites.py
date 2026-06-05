"""Invite-only signup: the adapter gate, the invite service, and the endpoint."""

import re

import pytest
from allauth.account.models import EmailAddress
from allauth.core import context
from django.contrib.auth.models import AnonymousUser
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.users.adapter import AccountAdapter
from apps.users.invites import InviteError, create_invitation, redeem_invitation
from apps.users.models import Invitation
from apps.users.tests.factories import UserFactory
from apps.users.views import InviteRateThrottle

INVITE = "/api/v1/users/invite/"


def _token_from_email() -> str:
    """The raw token from the most recent invite email's link (the DB stores only its
    hash, so the link is the only place the raw token exists — exactly as a user gets it)."""
    m = re.search(r"/signup\?invite=([\w-]+)", mail.outbox[-1].body)
    assert m, "no invite link in the email"
    return m.group(1)


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
    assert "/signup?invite=" in mail.outbox[0].body  # link carries the redeemable token


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


# ── redeem (the invite link → stash verified email, Auth0/Clerk pattern) ─────
REDEEM = "/api/v1/users/invite/redeem/"


@pytest.mark.django_db
def test_redeem_returns_email(member):
    create_invitation("redeemer@example.com", invited_by=member)
    token = _token_from_email()
    r = APIClient().post(REDEEM, {"token": token}, format="json")  # anonymous, pre-signup
    assert r.status_code == 200, r.content
    assert r.data["email"] == "redeemer@example.com"


@pytest.mark.django_db
def test_token_is_hashed_at_rest(member):
    # The DB must never hold the raw token — only its SHA-256 (OWASP).
    create_invitation("hashed@example.com", invited_by=member)
    raw = _token_from_email()
    stored = Invitation.pending_for("hashed@example.com").token_hash
    assert stored != raw
    assert len(stored) == 64 and re.fullmatch(r"[0-9a-f]{64}", stored)


@pytest.mark.django_db
def test_reinvite_rotates_token_old_link_dies(member):
    create_invitation("rot@example.com", invited_by=member)
    old = _token_from_email()
    create_invitation("rot@example.com", invited_by=member)  # resend → new token
    new = _token_from_email()
    assert old != new
    assert Invitation.pending_by_token(old) is None  # old link no longer redeems
    assert Invitation.pending_by_token(new) is not None


@pytest.mark.django_db
def test_redeem_invalid_token_is_404():
    r = APIClient().post(REDEEM, {"token": "not-a-real-token"}, format="json")
    assert r.status_code == 404


@pytest.mark.django_db
def test_redeem_stashes_verified_email_for_signup(member):
    # The stash is allauth's native "this email is pre-verified" channel — signup then
    # creates the EmailAddress verified + sends no confirmation mail.
    create_invitation("stash@example.com", invited_by=member)
    token = _token_from_email()
    req = RequestFactory().post("/")
    req.session = {}
    redeem_invitation(token, req)
    assert req.session.get("account_verified_email") == "stash@example.com"


# ── rate limiting (an invite emails someone → cap per member) ─────────────────
@pytest.mark.django_db
def test_invite_endpoint_is_rate_limited(client, monkeypatch):
    cache.clear()  # throttle history lives in the cache; start clean
    monkeypatch.setattr(InviteRateThrottle, "get_rate", lambda self: "2/day")
    assert client.post(INVITE, {"email": "a@example.com"}, format="json").status_code == 201
    assert client.post(INVITE, {"email": "b@example.com"}, format="json").status_code == 201
    assert client.post(INVITE, {"email": "c@example.com"}, format="json").status_code == 429
