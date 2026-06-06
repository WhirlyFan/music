"""Collaboration API tests — invite/accept, edit access, fan-out, audit log, and the
owner-only guards (delete + visibility). Authed APIClient runs as app_admin (RLS
bypassed), so these exercise the app-layer authorization; the DB-layer RLS backstop
is proven separately in test_rls.py."""

import pytest
from allauth.account.models import EmailAddress
from rest_framework.test import APIClient

from apps.catalog import collab
from apps.catalog.models import Playlist, PlaylistActivity, PlaylistCollaborator
from apps.catalog.tests.factories import PlaylistFactory, TrackFactory
from apps.notifications.models import Notification
from apps.users.tests.factories import UserFactory

BASE = "/api/v1/catalog/playlists"


def _authed(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


def _join(owner, user, playlist):
    """Invite + accept, returning the accepted collaborator row."""
    return collab.accept(collab.invite(playlist, invitee=user, by=owner), by=user)


@pytest.mark.django_db
def test_invite_creates_pending_and_notifies_invitee():
    owner, friend = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False)
    r = _authed(owner).post(
        f"{BASE}/{pl.id}/collaborators/", {"user_id": str(friend.id)}, format="json"
    )
    assert r.status_code == 201, r.content
    assert PlaylistCollaborator.objects.filter(
        playlist=pl, user=friend, status=PlaylistCollaborator.Status.PENDING
    ).exists()
    assert Notification.objects.filter(
        recipient=friend, kind=Notification.Kind.PLAYLIST_INVITE, actor=owner
    ).exists()


@pytest.mark.django_db
def test_non_owner_cannot_invite():
    owner, stranger, target = UserFactory(), UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner)
    # Not the stranger's playlist → owner-only queryset 404s.
    r = _authed(stranger).post(
        f"{BASE}/{pl.id}/collaborators/", {"user_id": str(target.id)}, format="json"
    )
    assert r.status_code == 404


@pytest.mark.django_db
def test_cannot_invite_the_owner():
    owner = UserFactory()
    pl = PlaylistFactory(created_by=owner)
    r = _authed(owner).post(
        f"{BASE}/{pl.id}/collaborators/", {"user_id": str(owner.id)}, format="json"
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_accept_grants_access_and_notifies_owner():
    owner, friend = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False)
    collab.invite(pl, invitee=friend, by=owner)
    r = _authed(friend).post(f"{BASE}/{pl.id}/collab-accept/")
    assert r.status_code == 200
    assert (
        PlaylistCollaborator.objects.get(playlist=pl, user=friend).status
        == PlaylistCollaborator.Status.ACCEPTED
    )
    assert Notification.objects.filter(
        recipient=owner, kind=Notification.Kind.PLAYLIST_INVITE_ACCEPT, actor=friend
    ).exists()


@pytest.mark.django_db
def test_collaborator_can_add_tracks_and_edit_fans_out_to_others_not_actor():
    owner, editor, other = UserFactory(), UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False)
    _join(owner, editor, pl)
    _join(owner, other, pl)
    t1, t2 = TrackFactory(), TrackFactory()

    r = _authed(editor).post(
        f"{BASE}/{pl.id}/add-tracks/",
        {"track_ids": [str(t1.id), str(t2.id)]},
        format="json",
    )
    assert r.status_code == 200 and r.data["added"] == 2
    assert pl.items.count() == 2

    # Fan-out: owner + the other collaborator are notified; the actor is not.
    kind = Notification.Kind.PLAYLIST_TRACKS
    assert Notification.objects.filter(recipient=owner, kind=kind).count() == 1
    assert Notification.objects.filter(recipient=other, kind=kind).count() == 1
    assert not Notification.objects.filter(recipient=editor, kind=kind).exists()
    # Audit log records who did what.
    assert PlaylistActivity.objects.filter(
        playlist=pl, actor=editor, action=PlaylistActivity.Action.TRACKS_ADDED
    ).exists()
    # The track row credits who added it, so collaborators can see each other.
    rows = _authed(owner).get(f"{BASE}/{pl.id}/tracks/").data["results"]
    assert all(r["added_by"] == editor.username for r in rows)


@pytest.mark.django_db
def test_add_tracks_skips_duplicates():
    owner = UserFactory()
    pl = PlaylistFactory(created_by=owner)
    t = TrackFactory()
    api = _authed(owner)
    api.post(f"{BASE}/{pl.id}/add-tracks/", {"track_ids": [str(t.id)]}, format="json")
    r = api.post(f"{BASE}/{pl.id}/add-tracks/", {"track_ids": [str(t.id)]}, format="json")
    assert r.data["added"] == 0
    assert pl.items.count() == 1


@pytest.mark.django_db
def test_collaborator_can_rename_but_not_change_visibility():
    owner, editor = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False, title="old")
    _join(owner, editor, pl)
    api = _authed(editor)

    assert api.patch(f"{BASE}/{pl.id}/", {"title": "new"}, format="json").status_code == 200
    pl.refresh_from_db()
    assert pl.title == "new"
    assert PlaylistActivity.objects.filter(
        playlist=pl, action=PlaylistActivity.Action.METADATA_EDITED
    ).exists()

    # Flipping visibility is owner-only — the serializer rejects it.
    r = api.patch(f"{BASE}/{pl.id}/", {"is_public": True}, format="json")
    assert r.status_code == 400
    pl.refresh_from_db()
    assert pl.is_public is False


@pytest.mark.django_db
def test_owner_can_change_visibility():
    owner = UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False)
    r = _authed(owner).patch(f"{BASE}/{pl.id}/", {"is_public": True}, format="json")
    assert r.status_code == 200
    pl.refresh_from_db()
    assert pl.is_public is True


@pytest.mark.django_db
def test_collaborator_cannot_delete_playlist():
    owner, editor = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner)
    _join(owner, editor, pl)
    assert _authed(editor).delete(f"{BASE}/{pl.id}/").status_code == 404
    assert Playlist.objects.filter(pk=pl.id).exists()


@pytest.mark.django_db
def test_retrieve_flags_and_shared_filter():
    owner, editor = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=False, title="Shared")
    _join(owner, editor, pl)
    api = _authed(editor)

    r = api.get(f"{BASE}/{pl.id}/")
    assert r.status_code == 200
    assert r.data["can_edit"] is True and r.data["is_owner"] is False

    shared = api.get(f"{BASE}/?filter=shared")
    assert any(p["id"] == str(pl.id) for p in shared.data["results"])
    mine = api.get(f"{BASE}/")  # default list is owned-only
    assert all(p["id"] != str(pl.id) for p in mine.data["results"])


@pytest.mark.django_db
def test_collaborator_can_leave_and_owner_can_remove():
    owner, editor = UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner)
    c = _join(owner, editor, pl)
    # editor leaves
    assert _authed(editor).delete(f"{BASE}/{pl.id}/collaborators/{editor.id}/").status_code == 204
    assert not PlaylistCollaborator.objects.filter(pk=c.id).exists()

    # owner removes
    c2 = _join(owner, editor, pl)
    assert _authed(owner).delete(f"{BASE}/{pl.id}/collaborators/{editor.id}/").status_code == 204
    assert not PlaylistCollaborator.objects.filter(pk=c2.id).exists()


@pytest.mark.django_db
def test_stranger_cannot_remove_collaborator():
    owner, editor, stranger = UserFactory(), UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner)
    _join(owner, editor, pl)
    r = _authed(stranger).delete(f"{BASE}/{pl.id}/collaborators/{editor.id}/")
    assert r.status_code == 403
    assert PlaylistCollaborator.objects.filter(playlist=pl, user=editor).exists()


@pytest.mark.django_db
def test_activity_visible_to_members_only():
    owner, editor, outsider = UserFactory(), UserFactory(), UserFactory()
    pl = PlaylistFactory(created_by=owner, is_public=True)  # public, but activity is member-only
    _join(owner, editor, pl)
    collab.record_track_edit(
        pl, owner, PlaylistActivity.Action.TRACKS_ADDED, summary="added a track", count=1
    )

    assert _authed(owner).get(f"{BASE}/{pl.id}/activity/").data["count"] >= 1
    assert _authed(editor).get(f"{BASE}/{pl.id}/activity/").status_code == 200
    # A non-member can't see the history even though the playlist is public.
    assert _authed(outsider).get(f"{BASE}/{pl.id}/activity/").status_code == 404
