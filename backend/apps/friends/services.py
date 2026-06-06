"""Friend-graph operations + the events they emit.

Every mutation runs in a transaction so its `Notification` outbox row commits
atomically with the friendship change (the DB-outbox pattern — see
apps.notifications.events). Reads/scoping live in the viewset; this layer only
mutates and emits.
"""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.notifications.events import emit
from apps.notifications.models import Notification

from .models import Friendship


class FriendshipError(Exception):
    """A friend action that can't proceed (e.g. friending yourself)."""


def between(a, b) -> Friendship | None:
    """The friendship row linking two users in either direction, or None."""
    return Friendship.objects.filter(
        Q(requester=a, addressee=b) | Q(requester=b, addressee=a)
    ).first()


@transaction.atomic
def send_request(requester, addressee) -> Friendship:
    """Send (or idempotently resolve) a friend request from `requester` to `addressee`.

    Already friends → returns the existing row (no-op). A pending request the
    other way (addressee already asked requester) → auto-accepts it rather than
    storing a mirror row. A pending request the same way → returns it (idempotent).
    """
    if requester.id == addressee.id:
        raise FriendshipError("You can't send yourself a friend request.")
    existing = between(requester, addressee)
    if existing is not None:
        if existing.status == Friendship.Status.ACCEPTED:
            return existing
        if existing.requester_id == addressee.id:
            return accept(existing, by=requester)  # reciprocal → accept theirs
        return existing  # my own pending request already exists
    fr = Friendship.objects.create(requester=requester, addressee=addressee)
    emit(
        Notification.Kind.FRIEND_REQUEST,
        recipient=addressee,
        actor=requester,
        friendship_id=str(fr.id),
    )
    return fr


@transaction.atomic
def accept(friendship: Friendship, *, by) -> Friendship:
    """Accept a pending request; notify the original requester. Idempotent."""
    if friendship.status == Friendship.Status.ACCEPTED:
        return friendship
    friendship.status = Friendship.Status.ACCEPTED
    friendship.responded_at = timezone.now()
    friendship.save(update_fields=["status", "responded_at", "updated_at"])
    emit(
        Notification.Kind.FRIEND_ACCEPT,
        recipient=friendship.requester,
        actor=by,
        friendship_id=str(friendship.id),
    )
    return friendship


def remove(friendship: Friendship) -> None:
    """Decline / cancel / unfriend — all just drop the row (no notification)."""
    friendship.delete()
