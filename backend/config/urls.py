"""Root URL configuration.

API routes live under /api/v1/. Versioning the URL prefix from the start
costs nothing now and gives a clean migration path when we need breaking
changes — add /api/v2/ alongside v1, deprecate v1 on a known timeline.

The OpenAPI schema endpoint stays at /api/schema/ (unversioned) so the
codegen path doesn't need to know about API versions.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from health_check.views import HealthCheckView


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
    path("notes/", include("apps.notes.urls")),
    path("jobs/", include("apps.jobs.urls")),
    path("users/", include("apps.users.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("_allauth/", include("allauth.headless.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("health/", AppHealthCheckView.as_view(), name="health-check"),
    path("api/v1/", include((api_v1, "v1"))),
]

if settings.DEBUG:
    import debug_toolbar

    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
