"""Custom middleware.

`django_rls.middleware.RLSContextMiddleware` (configured in settings) handles
the rls.user_id session var + cleanup; we don't reimplement that here.

Middleware in this module:

- RequireMfaForStaffMiddleware: gates /admin/ access on having at least one
  enrolled MFA authenticator. Applies to any is_staff user regardless of how
  they authenticated (password, social, eventual SAML). Non-/admin/ paths and
  API requests are not gated — this is a role-scoped policy, not a global one.

- RequireVerifiedEmailMiddleware: gates /api/* for authenticated users whose
  email isn't verified. Symmetric prior art to the MFA-staff gate — allauth
  is configured with `ACCOUNT_EMAIL_VERIFICATION = "optional"` so signup
  creates a real session; this middleware (plus the frontend root guard)
  enforces verification before any protected resource access.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect

# Paths exempt from the staff-MFA gate. Enrollment lives at /account/mfa,
# the MFA challenge endpoints live under /_allauth/, and we don't want a
# logged-in staff user to be unable to log out without first enrolling.
_MFA_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/account/mfa",
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
    /account/mfa and is then unblocked for future /admin/ visits.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        path = request.path or ""
        if not path.startswith("/admin/"):
            return self.get_response(request)
        if any(path.startswith(p) for p in _MFA_EXEMPT_PREFIXES):
            return self.get_response(request)

        user = getattr(request, "user", None)
        if not (user and user.is_authenticated and user.is_staff):
            return self.get_response(request)

        # Import lazily — allauth.mfa is only in INSTALLED_APPS once enabled,
        # and we don't want this module to crash imports if it's removed.
        from allauth.mfa.models import Authenticator

        if not Authenticator.objects.filter(user=user).exists():
            return redirect(f"/account/mfa?required=true&next={path}")

        return self.get_response(request)


# Paths exempt from the verified-email gate. allauth endpoints stay reachable
# (the user needs to be able to hit /_allauth/account/email/verify to
# complete verification). The frontend's verify-email holding page also
# needs to be reachable. Logout must always work. Health checks are
# unauthenticated infrastructure.
_VERIFIED_EMAIL_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/_allauth/",
    "/account/verify-email",
    "/account/logout",
    "/admin/logout",
    "/health/",
)

# Paths the gate enforces on. Currently only the API surface — admin, allauth
# headless endpoints, and the SPA's static assets are not protected here.
# (The frontend's root-route guard handles the SPA side; this middleware is
# the backend backstop for direct API hits from cURL / scripts / mobile.)
_VERIFIED_EMAIL_GATED_PREFIXES: tuple[str, ...] = ("/api/",)


class RequireVerifiedEmailMiddleware:
    """Block /api/* for authenticated users whose email isn't verified.

    Why: with `ACCOUNT_EMAIL_VERIFICATION = "optional"` allauth creates a
    real authenticated session at signup. That's intentional — it makes
    `useResendEmailVerification` work refresh-after-refresh instead of only
    inside the signup tab's in-flight session. But we still need verification
    before granting access to actual app data.

    Trust model: any verified EmailAddress row for the user satisfies the
    gate. Verification once per email persists across sessions.

    Returns 403 with a structured body so the SPA's fetch wrapper can detect
    the case and redirect to the holding page. Direct API clients (cURL,
    mobile, etc.) see a machine-readable signal instead of a 302 to HTML.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        path = request.path or ""

        # Fast path: only gate the configured prefixes
        if not any(path.startswith(p) for p in _VERIFIED_EMAIL_GATED_PREFIXES):
            return self.get_response(request)

        # Belt-and-suspenders — exempt list takes precedence over gated list
        if any(path.startswith(p) for p in _VERIFIED_EMAIL_EXEMPT_PREFIXES):
            return self.get_response(request)

        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            # Anonymous requests aren't this middleware's concern — DRF's
            # IsAuthenticated will handle them with a 401.
            return self.get_response(request)

        # Import lazily — allauth.account is only in INSTALLED_APPS once
        # auth is enabled, and we don't want this module to crash imports.
        from allauth.account.models import EmailAddress

        if EmailAddress.objects.filter(user=user, verified=True).exists():
            return self.get_response(request)

        return JsonResponse(
            {
                "detail": "email_verification_required",
                "message": (
                    "Verify your email address before using the API. "
                    "Check your inbox or request a new verification email."
                ),
            },
            status=403,
        )
