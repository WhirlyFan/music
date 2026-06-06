"""Custom middleware.

`django_rls.middleware.RLSContextMiddleware` (configured in settings) handles
the rls.user_id session var + cleanup; we don't reimplement that here.

MFA is opt-in globally (`MFA_REQUIRED=False`), but MANDATORY for staff/superusers
hitting /admin/ — see RequireMfaForStaffMiddleware.

Middleware in this module:

- RequireMfaForStaffMiddleware: gates /admin/ access on having at least one
  enrolled MFA authenticator. Applies to any is_staff user (incl. superusers)
  regardless of how they authenticated (password, social, eventual SAML).
  Non-/admin/ paths and API requests are not gated — role-scoped, not global.

- RequireVerifiedEmailMiddleware: gates /api/* for authenticated users whose
  email isn't verified. Symmetric prior art to the MFA-staff gate — allauth
  is configured with `ACCOUNT_EMAIL_VERIFICATION = "optional"` so signup
  creates a real session; this middleware (plus the frontend root guard)
  enforces verification before any protected resource access.

- CanonicalAuthHostMiddleware: pins request.get_host() to the public domain on
  OAuth/auth paths so allauth builds the correct redirect_uri behind a
  reverse-proxy rewrite that doesn't forward the public host. No-ops in dev.
"""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect

# Paths exempt from the staff-MFA gate. Enrollment lives at /account/mfa, the
# MFA challenge endpoints live under /_allauth/, and a logged-in staff user must
# be able to log out without first enrolling.
_MFA_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/account/mfa",
    "/_allauth/",
    "/account/logout",
)


class RequireMfaForStaffMiddleware:
    """Block /admin/ for is_staff users who haven't enrolled an MFA method.

    Why: admin actions are higher-blast-radius than normal app use. Even if a
    customer's IdP (SAML, Google Workspace) already enforces MFA at login, we add
    a thin extra layer for the /admin/ surface specifically. Covers superusers
    too (they're is_staff). A social-only superuser (no password) still must
    enroll a factor here before reaching /admin/.

    Trust model: any *one* enrolled allauth.mfa.Authenticator (TOTP, recovery
    codes, or webauthn) satisfies the gate. The user enrolls once at /account/mfa
    (the page reads `?required=true` to show a "set this up to continue" prompt)
    and is then unblocked for future /admin/ visits.
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

        # Import lazily — allauth.mfa is only in INSTALLED_APPS once enabled.
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


# Auth-flow paths whose absolute URLs must use the public domain. allauth builds
# the OAuth redirect_uri under /accounts/<provider>/login/callback/; the headless
# provider-redirect that kicks the flow off lives under /_allauth/.
_CANONICAL_HOST_PREFIXES: tuple[str, ...] = ("/accounts/", "/_allauth/")


class CanonicalAuthHostMiddleware:
    """Pin request.get_host() to the public domain for OAuth/auth flows.

    Why: allauth derives the OAuth ``redirect_uri`` from ``request.get_host()``.
    This backend sits behind the frontend's reverse-proxy rewrite (Render static
    site → backend service), which does NOT reliably forward the public host in
    ``X-Forwarded-Host``. So ``get_host()`` returns the internal *.onrender.com
    service host, Google sees an unregistered ``redirect_uri`` and rejects with
    ``redirect_uri_mismatch`` — and even past that, a callback completing on
    *.onrender.com can't set the ``.whirlyfan.com``-scoped session cookie, so
    login would silently fail. Header-trust (``USE_X_FORWARDED_HOST``) can't fix
    this when the proxy doesn't send the header, so we pin it explicitly.

    For auth paths only, override the host with ``settings.OAUTH_CALLBACK_HOST``
    (and drop any forwarded-host header so it can't win) so the generated
    ``redirect_uri`` and the cookie it sets use the public domain. The host must
    be in ``ALLOWED_HOSTS``. No-ops when the setting is empty/unset (local dev),
    leaving Google's localhost flow untouched.

    Ordering: runs early (before CSRF / CommonMiddleware / the allauth views) so
    ``get_host()`` already returns the pinned host wherever it's read.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.host: str = getattr(settings, "OAUTH_CALLBACK_HOST", "") or ""

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if self.host and (request.path or "").startswith(_CANONICAL_HOST_PREFIXES):
            request.META["HTTP_HOST"] = self.host
            request.META.pop("HTTP_X_FORWARDED_HOST", None)
        return self.get_response(request)
