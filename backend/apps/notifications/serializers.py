from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    # Who triggered it (denormalized for display without an extra fetch).
    actor_username = serializers.CharField(source="actor.username", read_only=True, allow_null=True)

    class Meta:
        model = Notification
        fields = ["id", "kind", "actor_username", "payload", "read_at", "created_at"]
