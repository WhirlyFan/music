"""Invite-only signup: the adapter gate, the invite service, and the endpoint."""

import re

import pytest
from allauth.account.models import EmailAddress
from allauth.core import context
from django.contrib.auth.models import AnonymousUser
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from waffle.testutils import override_switch

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


@override_switch("invite_only", active=True)
@pytest.mark.django_db
def test_adapter_blocks_uninvited_signup():
    with context.request_context(_anon_request()):  # anonymous → a signup
        with pytest.raises(ValidationError):
            AccountAdapter().clean_email("stranger@example.com")


@override_switch("invite_only", active=True)
@pytest.mark.django_db
def test_adapter_allows_invited_signup():
    Invitation.objects.create(email="invited@example.com")
    with context.request_context(_anon_request()):
        # Case-insensitive match against the pending invite → allowed.
        assert AccountAdapter().clean_email("Invited@example.com") == "Invited@example.com"


@override_switch("invite_only", active=False)
@pytest.mark.django_db
def test_adapter_allows_uninvited_signup_when_flag_off():
    # Switch off → open signups; an uninvited stranger is allowed (normal verification).
    with context.request_context(_anon_request()):
        assert AccountAdapter().clean_email("stranger@example.com") == "stranger@example.com"


@override_switch("invite_only", active=True)
@pytest.mark.django_db
def test_adapter_allows_authed_email_change(member):
    # Authenticated user changing email → not a signup, so no invite required.
    with context.request_context(_authed_request(member)):
        assert AccountAdapter().clean_email("newaddr@example.com") == "newaddr@example.com"


@override_switch("invite_only", active=True)
@pytest.mark.django_db
def test_adapter_allows_already_accepted_invite_during_signup_setup():
    # allauth re-validates the email during post-signup setup, *after* save_user marked
    # the invite accepted. The gate must still pass then, or it drops the verified-email
    # stash (→ unverified account). A pending-only check would wrongly reject here.
    Invitation.objects.create(email="accepted@example.com", accepted_at=timezone.now())
    with context.request_context(_anon_request()):
        assert AccountAdapter().clean_email("accepted@example.com") == "accepted@example.com"


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
    req.user = AnonymousUser()
    req.session = {}
    redeem_invitation(token, req)
    assert req.session.get("account_verified_email") == "stash@example.com"


@pytest.mark.django_db
def test_redeem_authed_peek_does_not_stash(member):
    # An already-logged-in caller peeking at the invite (e.g. the signup page deciding
    # whether to offer sign-out) gets the email back but must not pollute their session.
    create_invitation("peek@example.com", invited_by=member)
    token = _token_from_email()
    req = RequestFactory().post("/")
    req.user = member
    req.session = {}
    inv = redeem_invitation(token, req)
    assert inv.email == "peek@example.com"
    assert "account_verified_email" not in req.session


# ── end-to-end: invite redeem → signup yields a verified account, no extra email ─
@override_switch("invite_only", active=True)
@override_settings(AUTH_PASSWORD_VALIDATORS=[])  # offline + deterministic (skip pwned API)
@pytest.mark.django_db
def test_invite_signup_creates_verified_account_without_confirmation_email(member):
    # Regression: the invite-only gate used to reject the email during allauth's
    # post-signup email setup (save_user had already marked the invite accepted),
    # dropping the verified-email stash → an unverified account + a confirmation mail +
    # the /account/verify-email loop. Redeem then signup must yield a verified account.
    create_invitation("fullflow@example.com", invited_by=member)
    token = _token_from_email()
    mail.outbox.clear()
    c = APIClient()  # one client → redeem + signup share the session (and the stash)
    assert c.post(REDEEM, {"token": token}, format="json").status_code == 200
    r = c.post(
        "/_allauth/browser/v1/auth/signup",
        {"email": "fullflow@example.com", "username": "fullflow", "password": "x7K2mq9ZvLp4Tn8w"},
        format="json",
    )
    assert r.status_code == 200, r.content  # 200 + authenticated == verified, not pending
    ea = EmailAddress.objects.get(email="fullflow@example.com")
    assert ea.verified is True and ea.primary is True
    assert mail.outbox == []  # the invite was the verification — no confirmation mail


# ── rate limiting (an invite emails someone → cap per member) ─────────────────
@pytest.mark.django_db
def test_invite_endpoint_is_rate_limited(client, monkeypatch):
    cache.clear()  # throttle history lives in the cache; start clean
    monkeypatch.setattr(InviteRateThrottle, "get_rate", lambda self: "2/day")
    assert client.post(INVITE, {"email": "a@example.com"}, format="json").status_code == 201
    assert client.post(INVITE, {"email": "b@example.com"}, format="json").status_code == 201
    assert client.post(INVITE, {"email": "c@example.com"}, format="json").status_code == 429
