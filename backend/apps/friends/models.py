from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Friendship(BaseModel):
    """A friendship between two users, stored as a single directed row.

    `requester` sent the request to `addressee`; the row is PENDING until the
    addressee accepts (→ ACCEPTED). Declining, cancelling, and unfriending all
    just delete the row, so the table only ever holds live requests and active
    friendships — "are A and B friends?" is one ACCEPTED row in either direction.

    Not RLS (like rooms): the viewset scopes every query to the calling user.
    A reciprocal request (B→A while A→B is still pending) is auto-accepted in the
    service layer instead of stored as a mirror row, so the UniqueConstraint only
    needs to block an exact duplicate in one direction.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friendships_sent"
    )
    addressee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friendships_received"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["requester", "addressee"], name="uniq_friendship_pair")
        ]
        indexes = [models.Index(fields=["addressee", "status"])]

    def __str__(self) -> str:
        return f"Friendship({self.requester_id} → {self.addressee_id}: {self.status})"
