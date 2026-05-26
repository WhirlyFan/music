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

api_v1 = [
    path("notes/", include("apps.notes.urls")),
    path("jobs/", include("apps.jobs.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("_allauth/", include("allauth.headless.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("health/", HealthCheckView.as_view(), name="health-check"),
    path("api/v1/", include((api_v1, "v1"))),
]

if settings.DEBUG:
    import debug_toolbar

    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
