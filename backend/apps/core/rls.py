"""Shared RLS policy helpers.

The standard owner-scoped policy with an `rls.bypass` escape hatch for
Django admin views. Future RLSModel subclasses should call
`owner_scoped_policy("owner")` instead of building a UserPolicy directly
— that way the bypass clause stays in one place.
"""

from __future__ import annotations

from django_rls.policies import CustomPolicy


def owner_scoped_policy(
    user_field: str = "owner", *, name: str = "owner_isolation"
) -> CustomPolicy:
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
            f"NULLIF(current_setting('rls.user_id', true), '')::uuid "
            f"OR current_setting('rls.bypass', true) = 'true'"
        ),
    )


def public_readable_policy(*, name: str = "public_readable") -> CustomPolicy:
    """SELECT-only policy: a row is *additionally* readable when `is_public`.

    Postgres ORs permissive policies for the same command, so pairing this with
    `owner_scoped_policy` gives reads = "owner OR is_public OR bypass" while
    writes (covered only by the owner policy) stay "owner OR bypass". The model
    must have a boolean `is_public` column.
    """
    return CustomPolicy(name=name, expression="is_public", operation="SELECT")


# Collaborator membership test for a catalog_playlist row, evaluated against the
# request's `rls.user_id`. The playlist id MUST be qualified as `catalog_playlist.id`
# — `catalog_playlistcollaborator` has its own `id` column, so an unqualified `id`
# inside the subquery would resolve to the collaborator row, not the playlist.
# READ allows a pending OR accepted invitee (so you can preview a playlist you've
# been invited to, and accept it); WRITE requires an accepted membership.
def _collaborator_expression(statuses: str) -> str:
    return (
        "EXISTS (SELECT 1 FROM catalog_playlistcollaborator c "
        "WHERE c.playlist_id = catalog_playlist.id "
        "AND c.user_id = NULLIF(current_setting('rls.user_id', true), '')::uuid "
        f"AND c.status IN ({statuses}))"
    )


def collaborator_readable_policy(*, name: str = "collaborator_readable") -> CustomPolicy:
    """SELECT: a pending OR accepted collaborator may read a playlist they're on.

    OR'd with the owner + public policies, so reads become "owner OR public OR
    invited-collaborator OR bypass". Pending is included so an invitee can preview
    the playlist (and load it to accept) before joining.
    """
    return CustomPolicy(
        name=name, expression=_collaborator_expression("'accepted', 'pending'"), operation="SELECT"
    )


def collaborator_writable_policy(*, name: str = "collaborator_writable") -> CustomPolicy:
    """UPDATE: an ACCEPTED collaborator may update a playlist they co-edit.

    INSERT and DELETE are deliberately NOT granted — creating and *deleting* a
    playlist stay the owner's privilege (the owner ALL-policy is the only one
    covering those commands). RLS is row-level, so it can't stop a collaborator
    from changing a specific column (e.g. `is_public`); that guard lives in the
    app layer (PlaylistUpdateSerializer).
    """
    return CustomPolicy(
        name=name, expression=_collaborator_expression("'accepted'"), operation="UPDATE"
    )
