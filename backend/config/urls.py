"""Root URL configuration.

API routes live under /api/v1/. Versioning the URL prefix from the start
costs nothing now and gives a clean migration path when we need breaking
changes — add /api/v2/ alongside v1, deprecate v1 on a known timeline.

The OpenAPI schema endpoint stays at /api/schema/ (unversioned) so the
codegen path doesn't need to know about API versions.
"""

from django.conf import settings
from django.contrib import admin
from django.contrib.admin.views.decorators import staff_member_required
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView
from health_check.views import HealthCheckView

from apps.users.views import verify_email_page


def _docs_gate(view):
    """Wrap the OpenAPI schema view in `staff_member_required` for prod, open in dev.

    Why gated at all: the schema is a full map of the API — every endpoint, payload,
    and auth scheme. Even with auth-gated endpoints, listing the surface is free
    reconnaissance. Standard hardening for production OpenAPI tooling.

    Why dev stays open: `make gen-api` and local iteration are easier without needing a
    logged-in session cookie just to fetch the schema. Devs run with DEBUG=True; the gate
    kicks in the moment DJANGO_DEBUG=False is set (i.e. prod) — non-staff are redirected
    to the admin login.
    """
    return view if settings.DEBUG else staff_member_required(view)


class AppHealthCheckView(HealthCheckView):
    """`/health/` for our app — only checks that actually matter.

    django-health-check's default view runs five checks (Cache, Database,
    DNS, Mail, Storage). Two are actively harmful in our setup:

    - **Storage** writes a test file to MEDIA_ROOT to prove writable
      storage. Our prod container runs as a non-root user with a
      read-only working dir, so the write fails → 500 on /health/ →
      Render's load balancer marks the backend unhealthy and stops
      routing traffic. We don't use file storage in this template (no
      uploads, no `django-storages` yet).
    - **Mail** opens an SMTP connection to verify the email backend.
      Slow + flaky against an external provider (Resend), and a
      transient mail outage shouldn't make our app appear down.

    The other defaults (Cache, DNS) are harmless but not load-bearing.
    Database is the only check Render's LB actually needs: if Postgres
    is down, don't send traffic.
    """

    checks = ("health_check.checks.Database",)


api_v1 = [
    path("catalog/", include("apps.catalog.urls")),
    path("", include("apps.rooms.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.friends.urls")),
    path("users/", include("apps.users.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("_allauth/", include("allauth.headless.urls")),
    # OAuth provider callback endpoints (e.g. /accounts/google/login/callback/).
    # The headless browser redirect flow bootstraps the handshake, but the
    # provider still redirects back to allauth's provider views — and headless
    # ONLY mounts /_allauth/. Under HEADLESS_ONLY, allauth.urls reduces to just
    # the provider urlpatterns (build_provider_urlpatterns) — no regular
    # login/signup views — so this gives only the callbacks we need. The browser
    # reaches them same-origin via the frontend's /accounts/* rewrite, so the
    # session cookie is set on the public origin.
    path("accounts/", include("allauth.urls")),
    # Backend-rendered email-verification landing (the verification email links
    # here, not the web frontend — see HEADLESS_FRONTEND_URLS). Singular /account/
    # so it's neither host-pinned (CanonicalAuthHostMiddleware) nor proxied by the
    # frontend; the email link points straight at the backend's own domain.
    path(
        "account/verify-email/<str:key>/",
        verify_email_page,
        name="verify-email-page",
    ),
    path("api/schema/", _docs_gate(SpectacularAPIView.as_view()), name="schema"),
    path("health/", AppHealthCheckView.as_view(), name="health-check"),
    path("api/v1/", include((api_v1, "v1"))),
]

if settings.DEBUG:
    import debug_toolbar

    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
