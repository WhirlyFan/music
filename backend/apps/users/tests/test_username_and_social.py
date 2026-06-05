"""Username change endpoint + the social-signup invite gate."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from waffle.testutils import override_switch

from apps.users.adapter import SocialAccountAdapter, _unique_handle
from apps.users.models import Invitation
from apps.users.tests.factories import UserFactory

USERNAME = "/api/v1/users/username/"


class _FakeSocialLogin:
    """Minimal stand-in: the adapter's gate only reads sociallogin.user.email."""

    def __init__(self, email):
        self.user = get_user_model()(email=email)


@pytest.fixture
def client_for():
    def _make(user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    return _make


def test_change_username_success_lowercases(db, client_for):
    user = UserFactory(username="old_handle")
    res = client_for(user).post(USERNAME, {"username": "NewHandle"}, format="json")
    assert res.status_code == 200
    user.refresh_from_db()
    assert user.username == "newhandle"  # PRESERVE_USERNAME_CASING is off


def test_change_username_rejects_taken(db, client_for):
    UserFactory(username="taken")
    user = UserFactory(username="mine")
    res = client_for(user).post(USERNAME, {"username": "Taken"}, format="json")
    assert res.status_code == 409
    user.refresh_from_db()
    assert user.username == "mine"


@pytest.mark.parametrize("bad", ["ab", "has space", "no$symbols", "x" * 31])
def test_change_username_rejects_bad_format(db, client_for, bad):
    user = UserFactory(username="mine")
    res = client_for(user).post(USERNAME, {"username": bad}, format="json")
    assert res.status_code == 400


def test_change_username_requires_auth(db):
    assert APIClient().post(USERNAME, {"username": "whoever"}, format="json").status_code == 403


@override_switch("invite_only", active=True)
def test_social_signup_blocked_without_invite(db):
    adapter = SocialAccountAdapter()
    login = _FakeSocialLogin("stranger@example.com")
    assert adapter.is_open_for_signup(None, login) is False


@override_switch("invite_only", active=True)
def test_social_signup_allowed_with_invite(db):
    Invitation.objects.create(
        email="invited@example.com",
        token_hash="x" * 64,
        expires_at=timezone.now() + timedelta(days=1),
    )
    adapter = SocialAccountAdapter()
    login = _FakeSocialLogin("invited@example.com")
    assert adapter.is_open_for_signup(None, login) is True


@override_switch("invite_only", active=False)
def test_social_signup_open_when_switch_off(db):
    adapter = SocialAccountAdapter()
    assert adapter.is_open_for_signup(None, _FakeSocialLogin("anyone@example.com")) is True


def test_unique_handle_uses_lowercase_first_name(db):
    assert _unique_handle("Alex") == "alex"


def test_unique_handle_suffixes_on_collision(db):
    UserFactory(username="alex")
    handle = _unique_handle("Alex")
    assert handle.startswith("alex_") and handle != "alex"


def test_unique_handle_falls_back_without_name(db):
    assert _unique_handle("").startswith("user_")
