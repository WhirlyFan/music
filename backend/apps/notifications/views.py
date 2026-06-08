from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


class NotificationPagination(PageNumberPagination):
    """Small pages: the bell shows ~5 and infinite-scrolls for more."""

    page_size = 5


class NotificationViewSet(mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """The caller's own notifications: a paginated list (5/page for the bell's
    infinite scroll), an unread count for the badge, mark-read (specific ids, or all),
    and dismiss (DELETE one). Scoped to the caller — you only ever see and mutate your
    own. Dismiss is used to consume an actioned item (e.g. after accepting) so it goes."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer
    pagination_class = NotificationPagination

    def get_queryset(self):
        qs = Notification.objects.filter(recipient=self.request.user)
        # The bell lists only UNREAD notifications, so read ones drop on a fresh load
        # (hard refresh). Other actions (mark-read / dismiss / unread-count) still
        # operate over the full set.
        if self.action == "list":
            qs = qs.filter(read_at__isnull=True)
        return qs

    @extend_schema(
        responses={200: {"type": "object", "properties": {"count": {"type": "integer"}}}}
    )
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"count": count})

    @extend_schema(request=None, responses=None)
    @action(detail=False, methods=["post"], url_path="mark-read")
    def mark_read(self, request):
        """Mark notifications read. Body `{"ids": [...]}` marks those; `{"exclude_kinds":
        [...]}` marks all unread EXCEPT those kinds (used by "mark all read" to clear
        the informational notifications while leaving actionable ones pending); omit
        both to mark everything read."""
        ids = request.data.get("ids")
        exclude_kinds = request.data.get("exclude_kinds")
        qs = self.get_queryset().filter(read_at__isnull=True)
        if ids:
            qs = qs.filter(id__in=ids)
        elif exclude_kinds:
            qs = qs.exclude(kind__in=exclude_kinds)
        qs.update(read_at=timezone.now())
        return Response({"ok": True})
