"""Tests for RequireMfaForStaffMiddleware.

The gate fires only for authenticated is_staff users hitting /admin/, and
only when they have zero Authenticator rows. Verifying each branch:

- Anonymous /admin/ → standard Django admin login redirect (we don't touch)
- Authenticated non-staff /admin/ → admin's own permission redirect
- Authenticated staff without MFA → our redirect to /account/2fa?required=true&next=…
- Authenticated staff with MFA → admin renders normally
- Staff without MFA hitting /account/2fa → no redirect loop
"""

from __future__ import annotations

import pytest
from allauth.mfa.models import Authenticator
from django.contrib.auth import get_user_model
from django.test import Client

User = get_user_model()


@pytest.fixture
def staff_no_mfa(db):
    return User.objects.create_user(
        email="staff@example.com",
        username="staff",
        password="pw1234567890",
        is_staff=True,
    )


@pytest.fixture
def staff_with_totp(db):
    user = User.objects.create_user(
        email="staff_mfa@example.com",
        username="staffmfa",
        password="pw1234567890",
        is_staff=True,
    )
    Authenticator.objects.create(
        user=user,
        type=Authenticator.Type.TOTP,
        data={"secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"},
    )
    return user


@pytest.fixture
def regular_user(db):
    return User.objects.create_user(
        email="regular@example.com",
        username="regular",
        password="pw1234567890",
    )


@pytest.mark.django_db
def test_staff_without_mfa_redirected_from_admin(staff_no_mfa):
    client = Client()
    client.force_login(staff_no_mfa)
    response = client.get("/admin/")
    assert response.status_code == 302
    assert response["Location"].startswith("/account/2fa")
    assert "required=true" in response["Location"]
    assert "next=/admin/" in response["Location"]


@pytest.mark.django_db
def test_staff_with_mfa_can_reach_admin(staff_with_totp):
    client = Client()
    client.force_login(staff_with_totp)
    response = client.get("/admin/")
    # Admin renders (200) or short-redirects to its own index — anything
    # NOT /account/2fa is a pass.
    assert "/account/2fa" not in response.get("Location", "")
    assert response.status_code in (200, 302)


@pytest.mark.django_db
def test_non_staff_user_not_redirected_by_mfa_gate(regular_user):
    """Regular user hitting /admin/ should get the admin's own redirect
    (which sends them to /admin/login/), not our MFA enrollment redirect."""
    client = Client()
    client.force_login(regular_user)
    response = client.get("/admin/")
    assert "/account/2fa" not in response.get("Location", "")


@pytest.mark.django_db
def test_anonymous_request_to_admin_not_affected(db):
    """Anonymous user hits /admin/ — Django admin handles its own login
    redirect; our gate must not fire (request.user is anonymous, not staff)."""
    client = Client()
    response = client.get("/admin/")
    assert "/account/2fa" not in response.get("Location", "")


@pytest.mark.django_db
def test_staff_without_mfa_can_reach_enrollment_page(staff_no_mfa):
    """The enrollment page itself must not be gated — otherwise users get
    a redirect loop and can never enroll."""
    client = Client()
    client.force_login(staff_no_mfa)
    response = client.get("/account/2fa?required=true&next=/admin/")
    # Anything other than a redirect to /account/2fa would be a loop; this
    # path isn't handled by Django (no view), so it 404s — that's fine,
    # the point is the MIDDLEWARE didn't loop. Either 200, 302-elsewhere,
    # or 404 is acceptable.
    assert "/account/2fa?required=" not in response.get("Location", "")
