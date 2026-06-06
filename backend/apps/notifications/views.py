from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The caller's own notifications: a paginated list, an unread count for the
    badge, and mark-read (specific ids, or all). Scoped to the caller — you only
    ever see and mutate your own."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @extend_schema(responses={200: {"type": "object", "properties": {"count": {"type": "integer"}}}})
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"count": count})

    @extend_schema(request=None, responses=None)
    @action(detail=False, methods=["post"], url_path="mark-read")
    def mark_read(self, request):
        """Mark notifications read. Body `{"ids": [...]}` marks those; omit `ids`
        to mark everything read."""
        ids = request.data.get("ids")
        qs = self.get_queryset().filter(read_at__isnull=True)
        if ids:
            qs = qs.filter(id__in=ids)
        qs.update(read_at=timezone.now())
        return Response({"ok": True})
