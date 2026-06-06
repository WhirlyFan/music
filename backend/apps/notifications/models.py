from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Notification(BaseModel):
    """A durable, per-user notification. The DB row IS the outbox: it's written in the
    same transaction as the change that triggered it (so it can't be lost), and a live
    nudge is pushed over the recipient's global WebSocket after commit (best-effort).

    `payload` carries event-specific context (kept flexible so new event kinds don't
    need migrations); `actor` is who triggered it (null for system events)."""

    class Kind(models.TextChoices):
        JAM_JOIN = "jam_join", "Joined your jam"
        FRIEND_REQUEST = "friend_request", "Sent you a friend request"
        FRIEND_ACCEPT = "friend_accept", "Accepted your friend request"
        PLAYLIST_INVITE = "playlist_invite", "Invited you to collaborate"
        PLAYLIST_INVITE_ACCEPT = "playlist_invite_accept", "Joined your playlist"
        PLAYLIST_TRACKS = "playlist_tracks", "Updated a shared playlist"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at"])]

    def __str__(self) -> str:
        return f"Notification({self.kind} → {self.recipient_id})"
