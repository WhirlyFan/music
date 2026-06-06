"""Playlist collaboration: invites, the accepted-collaborator audience, the audit
log, and the events each edit fans out.

Collaboration rides the same DB-outbox events layer as everything else
(apps.notifications.events): an invite/accept/edit writes its Notification +
PlaylistActivity rows in the caller's transaction, then nudges recipients' live
sockets after commit. Authorization (who may edit) is enforced in the viewset
(get_queryset + the owner-only guards); this module is the mutate-and-emit seam.
"""

from django.db import transaction
from django.utils import timezone

from apps.notifications.events import emit, emit_many
from apps.notifications.models import Notification

from .models import PlaylistActivity, PlaylistCollaborator


class CollaboratorError(Exception):
    """A collaboration action that can't proceed (e.g. inviting the owner)."""


def accepted_collaborator_ids(playlist) -> set:
    """User ids of every accepted collaborator on a playlist."""
    return set(
        playlist.collaborators.filter(
            status=PlaylistCollaborator.Status.ACCEPTED
        ).values_list("user_id", flat=True)
    )


def can_edit(playlist, user) -> bool:
    """True if `user` may edit this playlist's tracks/metadata — the owner, or an
    accepted collaborator. (Visibility/delete/collaborator-management stay owner-only,
    enforced separately in the viewset.)"""
    if playlist.created_by_id == user.id:
        return True
    return playlist.collaborators.filter(
        user=user, status=PlaylistCollaborator.Status.ACCEPTED
    ).exists()


def _audience(playlist, *, exclude_id):
    """Everyone who should hear about an edit: the owner + accepted collaborators,
    minus the actor. `emit` also self-skips, but excluding here avoids a useless row."""
    from django.contrib.auth import get_user_model

    user_model = get_user_model()
    ids = accepted_collaborator_ids(playlist)
    if playlist.created_by_id:
        ids.add(playlist.created_by_id)
    ids.discard(exclude_id)
    return user_model.objects.filter(pk__in=ids)


def log(playlist, actor, action, **detail) -> PlaylistActivity:
    """Append one audit-log row (in the caller's transaction)."""
    return PlaylistActivity.objects.create(
        playlist=playlist, actor=actor, action=action, detail=detail
    )


def record_track_edit(playlist, actor, action, *, summary, **detail) -> None:
    """Log a track edit AND notify the rest of the playlist's audience. Called inside
    the edit's transaction so the activity row + notifications commit atomically with
    the change (and never fire if it rolls back)."""
    log(playlist, actor, action, **detail)
    emit_many(
        Notification.Kind.PLAYLIST_TRACKS,
        recipients=_audience(playlist, exclude_id=actor.id),
        actor=actor,
        playlist_id=str(playlist.id),
        title=playlist.title,
        summary=summary,
    )


@transaction.atomic
def invite(playlist, *, invitee, by) -> PlaylistCollaborator:
    """Invite a user to collaborate (PENDING until they accept). Idempotent — an
    existing invite/membership is returned unchanged. Notifies the invitee."""
    if invitee.id == playlist.created_by_id:
        raise CollaboratorError("The owner already has full access.")
    collab, created = PlaylistCollaborator.objects.get_or_create(
        playlist=playlist,
        user=invitee,
        defaults={"invited_by": by, "status": PlaylistCollaborator.Status.PENDING},
    )
    if created:
        log(playlist, by, PlaylistActivity.Action.COLLABORATOR_INVITED, username=invitee.username)
        emit(
            Notification.Kind.PLAYLIST_INVITE,
            recipient=invitee,
            actor=by,
            playlist_id=str(playlist.id),
            title=playlist.title,
        )
    return collab


@transaction.atomic
def accept(collab: PlaylistCollaborator, *, by) -> PlaylistCollaborator:
    """Accept an invite (→ ACCEPTED, granting edit access). Notifies the owner."""
    if collab.status == PlaylistCollaborator.Status.ACCEPTED:
        return collab
    collab.status = PlaylistCollaborator.Status.ACCEPTED
    collab.responded_at = timezone.now()
    collab.save(update_fields=["status", "responded_at", "updated_at"])
    log(collab.playlist, by, PlaylistActivity.Action.COLLABORATOR_JOINED, username=by.username)
    emit(
        Notification.Kind.PLAYLIST_INVITE_ACCEPT,
        recipient=collab.playlist.created_by,
        actor=by,
        playlist_id=str(collab.playlist.id),
        title=collab.playlist.title,
    )
    return collab


@transaction.atomic
def remove(collab: PlaylistCollaborator, *, by) -> None:
    """Owner removes a collaborator, or a collaborator leaves — drops the row."""
    playlist, username = collab.playlist, collab.user.username
    collab.delete()
    log(playlist, by, PlaylistActivity.Action.COLLABORATOR_REMOVED, username=username)
