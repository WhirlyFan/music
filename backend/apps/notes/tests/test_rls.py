"""RLS enforcement tests for the Note model.

These tests are the load-bearing proof that:

1. The Note table has Postgres RLS enabled with a policy filtering by
   `rls.user_id`.
2. App code running as the `app_user` Postgres role cannot see another
   user's rows — even when the viewset omits an application-layer
   `.filter(owner=request.user)`.
3. Anonymous traffic (no `rls.user_id` set) sees zero rows.

Test mechanics:
- pytest connects as `app_admin` (BYPASSRLS) so it can set up cross-user
  fixtures. Each test that wants to *verify* enforcement uses the
  `as_app_user` context manager, which issues `SET LOCAL ROLE app_user`
  inside a transaction. Inside that block, RLS applies normally.
- `as_app_user(user_id)` also sets `rls.user_id` to match the policy.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest
from django.contrib.auth import get_user_model
from django.db import connection, transaction

from apps.notes.models import Note

User = get_user_model()


@contextmanager
def as_app_user(user_id: int | None, *, bypass: bool = False):
    """Run a block as the non-superuser `app_user` Postgres role with
    `rls.user_id` set. SET LOCAL ROLE is bounded by the surrounding
    transaction, so role state never leaks out.

    Pass bypass=True to also set `rls.bypass='true'` — the same flag the
    admin middleware sets for is_staff users on /admin/."""
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
def two_users_with_notes(db):
    """Seed two users, each with one note. Setup runs as admin (BYPASSRLS)."""
    a = User.objects.create_user(email="a@example.com", username="alice", password="pw")
    b = User.objects.create_user(email="b@example.com", username="bob", password="pw")
    Note.objects.create(owner=a, title="A's note", body="alpha")
    Note.objects.create(owner=b, title="B's note", body="beta")
    return a, b


@pytest.mark.django_db(transaction=True)
def test_rls_policy_is_present_on_table():
    """Sanity check: the migration enabled RLS + the owner_isolation policy."""
    with connection.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'notes_note'"
        )
        rowsec, forcerls = cur.fetchone()
        assert rowsec is True, "RLS not enabled on notes_note"
        assert forcerls is True, "FORCE RLS not enabled on notes_note"

        cur.execute("SELECT polname FROM pg_policy WHERE polrelid = 'notes_note'::regclass")
        names = {row[0] for row in cur.fetchall()}
        assert "owner_isolation" in names


@pytest.mark.django_db(transaction=True)
def test_anonymous_bypass_returns_zero_rows(two_users_with_notes):
    """No `rls.user_id` set + non-BYPASSRLS role → zero rows."""
    with as_app_user(user_id=None):
        # Even though both notes exist in the table, the app_user role
        # with no rls.user_id sees nothing.
        assert Note.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_user_isolation(two_users_with_notes):
    """User A sees only A's note; user B sees only B's. Switching the
    session var alone is enough to switch which rows are visible."""
    a, b = two_users_with_notes

    with as_app_user(user_id=a.id):
        titles = list(Note.objects.values_list("title", flat=True))
        assert titles == ["A's note"]

    with as_app_user(user_id=b.id):
        titles = list(Note.objects.values_list("title", flat=True))
        assert titles == ["B's note"]


@pytest.mark.django_db(transaction=True)
def test_admin_bypass_shows_all_rows(two_users_with_notes):
    """`rls.bypass='true'` (set by RLSContextMiddleware for is_staff users
    on /admin/) makes the app_user role see every row. Without bypass,
    same setup would only show one user's notes."""
    a, _b = two_users_with_notes

    with as_app_user(user_id=a.id, bypass=True):
        titles = set(Note.objects.values_list("title", flat=True))
        assert titles == {"A's note", "B's note"}


@pytest.mark.django_db(transaction=True)
def test_bypass_off_means_user_scoped(two_users_with_notes):
    """Sanity check the bypass flag is what flipped the behavior — same
    user, bypass=False, only own row visible."""
    a, _b = two_users_with_notes

    with as_app_user(user_id=a.id, bypass=False):
        titles = list(Note.objects.values_list("title", flat=True))
        assert titles == ["A's note"]


@pytest.mark.django_db(transaction=True)
def test_viewset_without_app_layer_filter_still_safe(two_users_with_notes, client):
    """The NoteViewSet returns `Note.objects.all()` with NO owner filter.
    RLS at the DB layer must still prevent cross-user leakage.

    NOTE: Django's test client uses the default connection (app_admin in
    our setup), so it bypasses RLS. To prove the production path is
    safe, this test issues raw queries as `app_user` after the middleware
    would have set rls.user_id."""
    a, b = two_users_with_notes

    # Simulate what the RLSContextMiddleware does for a request from user A,
    # then run the same ORM call the viewset's get_queryset() makes.
    with as_app_user(user_id=a.id):
        visible = list(Note.objects.values_list("title", flat=True))
        # Even though get_queryset returned .objects.all(), only A's rows came back
        assert visible == ["A's note"]
        assert "B's note" not in visible
