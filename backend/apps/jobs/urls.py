from rest_framework.routers import DefaultRouter

from .views import WorkflowRunViewSet

router = DefaultRouter()
router.register(r"", WorkflowRunViewSet, basename="workflow-run")

urlpatterns = router.urls
