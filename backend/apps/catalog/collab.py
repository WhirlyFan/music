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

from apps.notifications.events import emit
from apps.notifications.models import Notification

from . import realtime
from .models import PlaylistActivity, PlaylistCollaborator


class CollaboratorError(Exception):
    """A collaboration action that can't proceed (e.g. inviting the owner)."""


def can_edit(playlist, user) -> bool:
    """True if `user` may edit this playlist's tracks/metadata — the owner, or an
    accepted collaborator. (Visibility/delete/collaborator-management stay owner-only,
    enforced separately in the viewset.)"""
    if playlist.created_by_id == user.id:
        return True
    return playlist.collaborators.filter(
        user=user, status=PlaylistCollaborator.Status.ACCEPTED
    ).exists()


def log(playlist, actor, action, **detail) -> PlaylistActivity:
    """Append one audit-log row (in the caller's transaction)."""
    return PlaylistActivity.objects.create(
        playlist=playlist, actor=actor, action=action, detail=detail
    )


def record_track_edit(playlist, actor, action, *, summary, **detail) -> None:
    """Record a track edit: append to the audit log + live-update anyone viewing the
    playlist. Track edits are deliberately NOT notifications (only invites are) — they
    surface in the activity log and sync live to current viewers."""
    log(playlist, actor, action, summary=summary, **detail)
    realtime.broadcast_playlist_changed(playlist.id)


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
        realtime.broadcast_playlist_changed(playlist.id)
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
    realtime.broadcast_playlist_changed(collab.playlist_id)
    return collab


@transaction.atomic
def remove(collab: PlaylistCollaborator, *, by) -> None:
    """Owner removes a collaborator, or a collaborator leaves — drops the row."""
    playlist, username = collab.playlist, collab.user.username
    collab.delete()
    log(playlist, by, PlaylistActivity.Action.COLLABORATOR_REMOVED, username=username)
    realtime.broadcast_playlist_changed(playlist.id)
