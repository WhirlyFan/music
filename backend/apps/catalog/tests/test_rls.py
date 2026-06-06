"""RLS enforcement tests for the Playlist model.

Playlist is the one owner-isolated table in the catalog. These tests are the
load-bearing proof that:

1. `catalog_playlist` has Postgres RLS enabled with the `owner_isolation`
   (ALL) + `public_readable` (SELECT) policies.
2. App code running as the `app_user` role can't see another user's private
   rows — even if a viewset omits its `.filter(created_by=request.user)`.
3. Anonymous traffic (no `rls.user_id`) sees zero rows.
4. `is_public` rows are readable cross-user but NOT writable.

Mechanics: pytest connects as `app_admin` (BYPASSRLS) to set up cross-user
fixtures; `as_app_user` issues `SET LOCAL ROLE app_user` + sets `rls.user_id`
inside a transaction so enforcement applies and never leaks out.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest
from django.contrib.auth import get_user_model
from django.db import connection, transaction

from apps.catalog.models import Playlist, PlaylistCollaborator

User = get_user_model()


@contextmanager
def as_app_user(user_id: int | None, *, bypass: bool = False):
    """Run a block as the non-superuser `app_user` role with `rls.user_id` set.
    `SET LOCAL ROLE` is bounded by the surrounding transaction. Pass
    bypass=True to set `rls.bypass='true'` (what the admin middleware sets for
    is_staff users on /admin/)."""
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute("SET LOCAL ROLE app_user")
            cur.execute(
                "SELECT set_config('rls.user_id', %s, true)",
                [str(user_id) if user_id is not None else ""],
            )
            cur.execute(
                "SELECT set_config('rls.bypass', %s, true)",
                ["true" if bypass else ""],
            )
        try:
            yield
        finally:
            with connection.cursor() as cur:
                cur.execute("RESET ROLE")


@pytest.fixture
def two_users(db):
    """Two users, each with one private playlist. Setup runs as admin (BYPASSRLS)."""
    a = User.objects.create_user(email="a@example.com", username="alice", password="pw")
    b = User.objects.create_user(email="b@example.com", username="bob", password="pw")
    Playlist.objects.create(created_by=a, title="A's playlist")
    Playlist.objects.create(created_by=b, title="B's playlist")
    return a, b


@pytest.mark.django_db(transaction=True)
def test_rls_policy_is_present_on_table():
    with connection.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity, relforcerowsecurity "
            "FROM pg_class WHERE relname = 'catalog_playlist'"
        )
        rowsec, forcerls = cur.fetchone()
        assert rowsec is True, "RLS not enabled on catalog_playlist"
        assert forcerls is True, "FORCE RLS not enabled on catalog_playlist"

        cur.execute("SELECT polname FROM pg_policy WHERE polrelid = 'catalog_playlist'::regclass")
        names = {row[0] for row in cur.fetchall()}
        assert {
            "owner_isolation",
            "public_readable",
            "collaborator_readable",
            "collaborator_writable",
        } <= names


@pytest.mark.django_db(transaction=True)
def test_anonymous_returns_zero_rows(two_users):
    """No `rls.user_id` + non-BYPASSRLS role → zero rows."""
    with as_app_user(user_id=None):
        assert Playlist.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_user_isolation(two_users):
    a, b = two_users
    with as_app_user(user_id=a.id):
        assert list(Playlist.objects.values_list("title", flat=True)) == ["A's playlist"]
    with as_app_user(user_id=b.id):
        assert list(Playlist.objects.values_list("title", flat=True)) == ["B's playlist"]


@pytest.mark.django_db(transaction=True)
def test_admin_bypass_shows_all_rows(two_users):
    a, _b = two_users
    with as_app_user(user_id=a.id, bypass=True):
        assert set(Playlist.objects.values_list("title", flat=True)) == {
            "A's playlist",
            "B's playlist",
        }


@pytest.mark.django_db(transaction=True)
def test_viewset_without_app_layer_filter_still_safe(two_users):
    """Even an unfiltered `Playlist.objects.all()` can't leak across users at
    the DB layer — the backstop under the viewset's created_by filter."""
    a, _b = two_users
    with as_app_user(user_id=a.id):
        assert list(Playlist.objects.values_list("title", flat=True)) == ["A's playlist"]


@pytest.mark.django_db(transaction=True)
def test_public_playlist_readable_cross_user_but_not_writable(two_users):
    """`is_public` rows are visible to other users (reads), but writes stay
    owner-only — A can SELECT B's public playlist yet cannot modify it."""
    a, b = two_users
    pub = Playlist.objects.create(created_by=b, title="B public", is_public=True)

    with as_app_user(user_id=a.id):
        titles = set(Playlist.objects.values_list("title", flat=True))
        assert "B public" in titles  # public → readable cross-user
        assert "B's playlist" not in titles  # private → still hidden
        # Writes are owner-only: the public row isn't visible to A for UPDATE.
        assert Playlist.objects.filter(pk=pub.pk).update(title="hijacked") == 0

    pub.refresh_from_db()
    assert pub.title == "B public"


@pytest.mark.django_db(transaction=True)
def test_accepted_collaborator_can_read_and_update_private_playlist(two_users):
    """An accepted collaborator sees + can UPDATE a private playlist at the DB layer
    (collaborator_readable + collaborator_writable), even though they don't own it."""
    a, b = two_users
    pl = Playlist.objects.create(created_by=b, title="B collab", is_public=False)
    PlaylistCollaborator.objects.create(
        playlist=pl, user=a, status=PlaylistCollaborator.Status.ACCEPTED
    )
    with as_app_user(user_id=a.id):
        assert "B collab" in set(Playlist.objects.values_list("title", flat=True))
        assert Playlist.objects.filter(pk=pl.pk).update(title="edited by collaborator") == 1
    pl.refresh_from_db()
    assert pl.title == "edited by collaborator"


@pytest.mark.django_db(transaction=True)
def test_pending_collaborator_can_read_but_not_update(two_users):
    """A pending invitee may preview the playlist (read) but can't edit it until they
    accept — collaborator_readable includes pending; collaborator_writable doesn't."""
    a, b = two_users
    pl = Playlist.objects.create(created_by=b, title="B pending", is_public=False)
    PlaylistCollaborator.objects.create(
        playlist=pl, user=a, status=PlaylistCollaborator.Status.PENDING
    )
    with as_app_user(user_id=a.id):
        assert "B pending" in set(Playlist.objects.values_list("title", flat=True))
        assert Playlist.objects.filter(pk=pl.pk).update(title="nope") == 0
    pl.refresh_from_db()
    assert pl.title == "B pending"


@pytest.mark.django_db(transaction=True)
def test_non_collaborator_cannot_see_private_playlist(two_users):
    a, b = two_users
    Playlist.objects.create(created_by=b, title="B secret", is_public=False)
    with as_app_user(user_id=a.id):
        assert "B secret" not in set(Playlist.objects.values_list("title", flat=True))
