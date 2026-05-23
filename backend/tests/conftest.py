"""Shared pytest fixtures.

set_rls_user is the canonical way to scope a test's queries to a specific user
via the same `app.current_user_id` session variable that production uses."""
from collections.abc import Generator
from contextlib import contextmanager

import pytest
from django.db import connection


@contextmanager
def _rls_user(user_id: int | None):
    with connection.cursor() as cur:
        if user_id is None:
            cur.execute("SELECT set_config('rls.user_id', '', true)")
        else:
            cur.execute(
                "SELECT set_config('rls.user_id', %s, true)",
                [str(user_id)],
            )
        yield


@pytest.fixture
def set_rls_user() -> Generator:
    """Yield a callable that sets the RLS user id for the current connection."""
    yield _rls_user
