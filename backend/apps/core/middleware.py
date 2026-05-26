"""Custom middleware.

`django_rls.middleware.RLSContextMiddleware` (configured in settings) handles
the rls.user_id session var + cleanup; we don't reimplement that here.

Middleware in this module:

- RequireMfaForStaffMiddleware: gates /admin/ access on having at least one
  enrolled MFA authenticator. Applies to any is_staff user regardless of how
  they authenticated (password, social, eventual SAML). Non-/admin/ paths and
  API requests are not gated — this is a role-scoped policy, not a global one.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect

# Paths exempt from the staff-MFA gate. Enrollment lives at /account/2fa,
# the MFA challenge endpoints live under /_allauth/, and we don't want a
# logged-in staff user to be unable to log out without first enrolling.
_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/account/2fa",
    "/_allauth/",
    "/account/logout",
)


class RequireMfaForStaffMiddleware:
    """Block /admin/ for is_staff users who haven't enrolled an MFA method.

    Why: admin actions are higher-blast-radius than normal app use. Even if
    a customer's IdP (SAML, Google Workspace) already enforces MFA at login,
    we add a thin extra layer here for the /admin/ surface specifically.

    Trust model: any *one* enrolled allauth.mfa.Authenticator (TOTP, recovery
    codes, or webauthn) satisfies the gate. The user enrolls once at
    /account/2fa and is then unblocked for future /admin/ visits.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        path = request.path or ""
        if not path.startswith("/admin/"):
            return self.get_response(request)
        if any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            return self.get_response(request)

        user = getattr(request, "user", None)
        if not (user and user.is_authenticated and user.is_staff):
            return self.get_response(request)

        # Import lazily — allauth.mfa is only in INSTALLED_APPS once enabled,
        # and we don't want this module to crash imports if it's removed.
        from allauth.mfa.models import Authenticator

        if not Authenticator.objects.filter(user=user).exists():
            return redirect(f"/account/2fa?required=true&next={path}")

        return self.get_response(request)
