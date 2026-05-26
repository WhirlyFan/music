"""RLS context processor — registered in settings.RLS_CONTEXT_PROCESSORS.

django-rls's middleware calls every processor on each request and merges
the returned dict into Postgres session vars (set as `rls.<key>`). We use
this to set `rls.bypass = 'true'` for staff users hitting /admin/ so the
Django admin can see + edit data across owners.

Keep this scoped to /admin/ only — we don't want API endpoints to bypass
RLS even for staff users, otherwise admin users' /api/notes/ requests
would return everyone's notes (different from what other users see).
"""

from __future__ import annotations


def set_admin_bypass(request) -> dict:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated and user.is_staff):
        return {}
    path = getattr(request, "path", "") or ""
    if not path.startswith("/admin/"):
        return {}
    return {"bypass": "true"}
