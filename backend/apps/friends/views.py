from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import services
from .models import Friendship
from .serializers import FriendshipSerializer

User = get_user_model()


class FriendshipViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """The caller's friend graph: accepted friends, pending requests, and the
    request/accept/decline/unfriend actions. Friendships aren't RLS — every query
    is scoped here to rows where the caller is the requester or the addressee, so
    you only ever see and act on your own."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FriendshipSerializer

    def get_queryset(self):
        u = self.request.user
        return Friendship.objects.filter(Q(requester=u) | Q(addressee=u)).select_related(
            "requester", "addressee"
        )

    def list(self, request):
        """Accepted friends — paginated (25/page); the client loads more on scroll,
        so a user with many friends doesn't fetch them all at once."""
        qs = self.get_queryset().filter(status=Friendship.Status.ACCEPTED)
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(
        responses={
            200: {
                "type": "object",
                "properties": {
                    "incoming": {"type": "array"},
                    "outgoing": {"type": "array"},
                },
            }
        }
    )
    @action(detail=False, methods=["get"])
    def requests(self, request):
        """Pending requests split into incoming (to me) and outgoing (from me)."""
        pending = self.get_queryset().filter(status=Friendship.Status.PENDING)
        incoming = [f for f in pending if f.addressee_id == request.user.id]
        outgoing = [f for f in pending if f.requester_id == request.user.id]
        return Response(
            {
                "incoming": self.get_serializer(incoming, many=True).data,
                "outgoing": self.get_serializer(outgoing, many=True).data,
            }
        )

    @extend_schema(request=None, responses=FriendshipSerializer)
    @action(detail=False, methods=["post"], url_path="request")
    def create_request(self, request):
        """Send a friend request. Body `{"user_id": "<uuid>"}` — the addressee is
        picked from a user search, so we reference them by id, not username."""
        addressee = get_object_or_404(User, pk=request.data.get("user_id"))
        try:
            fr = services.send_request(request.user, addressee)
        except services.FriendshipError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(fr).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=FriendshipSerializer)
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        fr = get_object_or_404(self.get_queryset(), pk=pk)
        if fr.addressee_id != request.user.id:
            return Response(
                {"detail": "Only the addressee can accept a request."},
                status=status.HTTP_403_FORBIDDEN,
            )
        services.accept(fr, by=request.user)
        return Response(self.get_serializer(fr).data)

    @extend_schema(request=None, responses=None)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        """Decline an incoming request (drops the row)."""
        services.remove(get_object_or_404(self.get_queryset(), pk=pk))
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_destroy(self, instance):
        """DELETE /friends/{id}/ — unfriend, or cancel an outgoing request."""
        services.remove(instance)
