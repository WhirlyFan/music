"""Shared RLS policy helpers.

The standard owner-scoped policy with an `rls.bypass` escape hatch for
Django admin views. Future RLSModel subclasses should call
`owner_scoped_policy("owner")` instead of building a UserPolicy directly
— that way the bypass clause stays in one place.
"""
from __future__ import annotations

from django_rls.policies import CustomPolicy


def owner_scoped_policy(user_field: str = "owner", *, name: str = "owner_isolation") -> CustomPolicy:
    """RLS policy: row is visible if you own it OR `rls.bypass = 'true'`.

    The bypass flag is set by `apps.core.rls_context.set_admin_bypass`
    (registered as an RLS_CONTEXT_PROCESSOR) for staff users on /admin/.
    Normal API requests never set it, so RLS still scopes the runtime path.

    The `_id` suffix is added automatically — pass the field name without it.
    """
    return CustomPolicy(
        name=name,
        expression=(
            f"{user_field}_id = "
            f"NULLIF(current_setting('rls.user_id', true), '')::integer "
            f"OR current_setting('rls.bypass', true) = 'true'"
        ),
    )
