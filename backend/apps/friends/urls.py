from rest_framework.routers import SimpleRouter

from .views import FriendshipViewSet

router = SimpleRouter()
router.register(r"friends", FriendshipViewSet, basename="friendship")

urlpatterns = router.urls
