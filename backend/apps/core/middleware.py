"""Custom middleware.

`django_rls.middleware.RLSContextMiddleware` (configured in settings) handles
the rls.user_id session var + cleanup; we don't reimplement that here.

MFA is fully optional (opt-in for everyone, incl. staff) — `MFA_REQUIRED=False`
and there is no staff gate; users enroll voluntarily from Settings.

Middleware in this module:

- RequireVerifiedEmailMiddleware: gates /api/* for authenticated users whose
  email isn't verified. Symmetric prior art to the MFA-staff gate — allauth
  is configured with `ACCOUNT_EMAIL_VERIFICATION = "optional"` so signup
  creates a real session; this middleware (plus the frontend root guard)
  enforces verification before any protected resource access.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse, JsonResponse

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
