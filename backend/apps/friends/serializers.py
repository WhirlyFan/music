from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Friendship

User = get_user_model()


class FriendUserSerializer(serializers.ModelSerializer):
    """The minimal public shape of a user in friend lists/requests."""

    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "display_name"]


class FriendshipSerializer(serializers.ModelSerializer):
    requester = FriendUserSerializer(read_only=True)
    addressee = FriendUserSerializer(read_only=True)

    class Meta:
        model = Friendship
        fields = ["id", "status", "requester", "addressee", "created_at"]
