"""Tests for RequireVerifiedEmailMiddleware.

The gate fires only on /api/* for authenticated users without a verified
EmailAddress row. Branches covered:

- Anonymous /api/* → DRF's own 401 (we don't touch)
- Authenticated + verified /api/* → request flows through normally
- Authenticated + unverified /api/* → 403 with structured body
- Authenticated + unverified /_allauth/* → reachable (exempt)
- Authenticated + unverified /account/verify-email → reachable (exempt)
- Authenticated + unverified /admin/ → not gated (only /api/* is)
"""

from __future__ import annotations

import json

import pytest
from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.test import Client

User = get_user_model()


@pytest.fixture
def verified_user(db):
    user = User.objects.create_user(
        email="verified@example.com",
        username="verified",
        password="pw1234567890",
    )
    EmailAddress.objects.create(
        user=user,
        email=user.email,
        verified=True,
        primary=True,
    )
    return user


@pytest.fixture
def unverified_user(db):
    user = User.objects.create_user(
        email="unverified@example.com",
        username="unverified",
        password="pw1234567890",
    )
    EmailAddress.objects.create(
        user=user,
        email=user.email,
        verified=False,
        primary=True,
    )
    return user


@pytest.mark.django_db
def test_anonymous_api_request_not_gated(db):
    """Anonymous /api/* requests pass through the middleware — DRF's own
    IsAuthenticated permission returns 401. The verified-email gate is
    only this middleware's concern when the user IS authenticated."""
    client = Client()
    response = client.get("/api/v1/catalog/playlists/")
    # 401 (or 403) from DRF, not our 403 with email_verification_required
    if response.status_code == 403:
        body = json.loads(response.content)
        assert body.get("detail") != "email_verification_required"


@pytest.mark.django_db
def test_verified_user_can_reach_api(verified_user):
    client = Client()
    client.force_login(verified_user)
    response = client.get("/api/v1/catalog/playlists/")
    # Should reach the view — 200 or any non-403-email-required
    if response.status_code == 403:
        body = json.loads(response.content)
        assert body.get("detail") != "email_verification_required"


@pytest.mark.django_db
def test_unverified_user_blocked_from_api(unverified_user):
    client = Client()
    client.force_login(unverified_user)
    response = client.get("/api/v1/catalog/playlists/")
    assert response.status_code == 403
    body = json.loads(response.content)
    assert body["detail"] == "email_verification_required"


@pytest.mark.django_db
def test_unverified_user_can_reach_allauth(unverified_user):
    """allauth endpoints must remain reachable so the user can complete
    verification (resend email, submit the key, etc.)."""
    client = Client()
    client.force_login(unverified_user)
    response = client.get("/_allauth/browser/v1/auth/session")
    # 200 / 401 — anything other than 403 email_verification_required
    if response.status_code == 403:
        body = json.loads(response.content)
        assert body.get("detail") != "email_verification_required"


@pytest.mark.django_db
def test_unverified_user_can_reach_verify_email_route(unverified_user):
    """The frontend's holding page at /account/verify-email isn't a Django
    view (the SPA renders it), but the middleware must not block it on
    the off-chance someone hits it directly. 404 is fine; 403 with
    email_verification_required is not."""
    client = Client()
    client.force_login(unverified_user)
    response = client.get("/account/verify-email")
    if response.status_code == 403:
        body = json.loads(response.content)
        assert body.get("detail") != "email_verification_required"


@pytest.mark.django_db
def test_unverified_user_admin_not_gated(unverified_user):
    """The verified-email gate only enforces /api/*. /admin/ has its own
    permission story (handled by Django admin + the MFA-staff middleware)."""
    client = Client()
    client.force_login(unverified_user)
    response = client.get("/admin/")
    if response.status_code == 403:
        body = json.loads(response.content)
        assert body.get("detail") != "email_verification_required"
