"""Post-migrate hooks that:

1. Enable RLS + create policies for every RLSModel. (django-rls's own
   post_migrate handler silently no-ops when an app's dotted name like
   `apps.catalog` doesn't match its label `catalog` — so we do it ourselves.)
2. Grant `app_user` table-level CRUD on every table that admin just
   created. RLS policies still apply on top — app_user can act on rows
   only where the policy permits. This makes the dev DB *and* every
   pytest test DB usable as `app_user` without manual SQL.
"""

from __future__ import annotations

import logging

from django.apps import apps
from django.conf import settings
from django.db import connection
from django.db.models.signals import post_migrate
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_migrate)
def ensure_rls_policies(sender, **kwargs):
    from django_rls.models import RLSModel

    for model in apps.get_models():
        if not issubclass(model, RLSModel):
            continue
        if not getattr(model, "_rls_policies", None):
            continue
        try:
            model.enable_rls()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to enable RLS for %s", model._meta.label)


@receiver(post_migrate)
def grant_app_user_table_access(sender, **kwargs):
    """Grant table CRUD + sequence USAGE to `app_user` after every migration.

    This runs only when the current connection is the BYPASSRLS admin role
    (i.e. migrations / management commands / pytest). It is idempotent —
    repeated GRANTs are no-ops in Postgres.
    """
    if connection.vendor != "postgresql":
        return
    if not getattr(settings, "GRANT_APP_USER_AFTER_MIGRATE", True):
        return

    # Only run grants when connected as an admin-class role; running as
    # app_user would fail with "permission denied".
    with connection.cursor() as cur:
        cur.execute("SELECT current_user")
        current_role = cur.fetchone()[0]
        if "admin" not in current_role and current_role != "postgres":
            return

        cur.execute(
            """
            GRANT USAGE ON SCHEMA public TO app_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT USAGE, SELECT ON SEQUENCES TO app_user;
            """
        )
