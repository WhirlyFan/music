"""Backend-rendered account pages that replaced the (retired) web-frontend flows:
password reset and the invite landing page. The verification email link already had
this treatment (verify_email_page); these cover the other two emails.
"""

import re

import pytest
from allauth.account.forms import default_token_generator
from allauth.account.utils import user_pk_to_url_str
from django.contrib.auth import get_user_model
from django.core import mail

from apps.users.invites import create_invitation

User = get_user_model()


def _reset_key(user) -> str:
    """The opaque `<uidb36>-<token>` key allauth puts in the reset link."""
    return f"{user_pk_to_url_str(user)}-{default_token_generator.make_token(user)}"


def _invite_token() -> str:
    return re.search(r"/invite/([\w-]+)/", mail.outbox[-1].body).group(1)


# ── password reset ───────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_reset_page_get_renders_form():
    user = User.objects.create_user(username="resetme", email="resetme@example.com")
    user.set_password("oldpassword123")
    user.save()
    resp = client_get(f"/account/password/reset/key/{_reset_key(user)}/")
    assert resp.status_code == 200
    assert "Set a new password" in resp.content.decode()


@pytest.mark.django_db
def test_reset_page_invalid_key_is_410():
    resp = client_get("/account/password/reset/key/not-a-real-key/")
    assert resp.status_code == 410
    assert "invalid or expired" in resp.content.decode().lower()


@pytest.mark.django_db
def test_reset_page_post_sets_password():
    user = User.objects.create_user(username="resetme2", email="resetme2@example.com")
    user.set_password("oldpassword123")
    user.save()
    resp = client_post(
        f"/account/password/reset/key/{_reset_key(user)}/",
        {"password": "a-brand-new-pass-123", "confirm": "a-brand-new-pass-123"},
    )
    assert resp.status_code == 200
    assert "Password updated" in resp.content.decode()
    user.refresh_from_db()
    assert user.check_password("a-brand-new-pass-123")


@pytest.mark.django_db
def test_reset_page_mismatch_keeps_old_password():
    user = User.objects.create_user(username="resetme3", email="resetme3@example.com")
    user.set_password("oldpassword123")
    user.save()
    resp = client_post(
        f"/account/password/reset/key/{_reset_key(user)}/",
        {"password": "a-brand-new-pass-123", "confirm": "different-pass-123"},
    )
    assert resp.status_code == 200
    assert "don’t match" in resp.content.decode()
    user.refresh_from_db()
    assert user.check_password("oldpassword123")  # unchanged


# ── invite landing ───────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_invite_landing_shows_email_and_download():
    member = User.objects.create_user(username="theinviter", email="theinviter@example.com")
    create_invitation("invitee@example.com", invited_by=member)
    resp = client_get(f"/invite/{_invite_token()}/")
    body = resp.content.decode()
    assert resp.status_code == 200
    assert "invitee@example.com" in body  # which email to sign in with
    assert "Download the app" in body  # the download CTA


@pytest.mark.django_db
def test_invite_landing_invalid_token_is_410():
    resp = client_get("/invite/nope-not-real/")
    assert resp.status_code == 410
    assert "invalid or has expired" in resp.content.decode().lower()


# ── helpers ──────────────────────────────────────────────────────────────────
# Plain (unauthenticated) client: these are public, browser-rendered pages.


def client_get(path):
    from django.test import Client

    return Client().get(path)


def client_post(path, data):
    from django.test import Client

    return Client().post(path, data)
