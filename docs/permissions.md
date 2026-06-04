# Permissions

Who can do what. Django's permission system is the right primitive 90% of
the time; the other 10% is where it gets interesting.

## The three Django concepts

| Concept | Scope | Example |
|---|---|---|
| `is_active` | Account-level | `False` = locked out from logging in |
| `is_staff` | `/admin/` access gate | `True` = can reach `/admin/` IF they have model perms |
| `is_superuser` | Wildcard bypass | `True` = ignores all permission checks; sees everything in `/admin/` |
| **Groups** | Bundles of model perms | "Moderator" group: `view_note + change_note` |
| **Model permissions** | Per-action per-model | `notes.add_note`, `notes.change_note`, `notes.delete_note`, `notes.view_note` |

## `is_staff` vs `is_superuser` — the difference that trips people up

Both flags are independent. Combinations:

| `is_staff` | `is_superuser` | What they can do |
|---|---|---|
| ❌ | ❌ | Regular app user. No `/admin/` access. Normal SPA behavior. |
| ✅ | ❌ | Can log into `/admin/`. Sidebar shows ONLY models they have explicit perms for. Edit/Delete buttons gated by per-model perms. Cannot grant themselves staff/superuser (Django strips those checkboxes from the form). |
| ❌ | ✅ | Unusual combo. Bypasses permission checks in code, but can't reach `/admin/`. |
| ✅ | ✅ | Full admin. Sees every model in the sidebar. Can do anything to anyone. |

### In `/admin/`
| Action | Staff (not superuser) | Superuser |
|---|---|---|
| Log in | ✅ | ✅ |
| Sidebar shows | Only models with explicit perms | Every registered model |
| List/edit/delete buttons | Conditional on `has_perm("app.action_model")` | Always |
| Grant superuser to others | Field hidden | Allowed |

### In the app (the SPA + DRF API)
**Neither flag does anything by default.** A staff or superuser logged into
the SPA sees the same UI, same data scoping, same RLS-filtered playlists as a
regular user. To make staff/superuser-only features in the app, you'd
have to:
- Add `is_staff` to the serializer + `useSession()`
- Conditionally render UI based on the flag
- Add `permission_classes = [IsAdminUser]` (which checks `is_staff`) to admin-only endpoints

We haven't done any of that — by design. The flags are for `/admin/`, not
for the public app surface.

## RLS staff bypass

The one place we *do* care about `is_staff` in our code is the RLS escape
hatch: `is_staff` users hitting `/admin/` get `rls.bypass = 'true'` so the
admin sees every row. See [rls.md](rls.md) and
[`apps/core/rls_context.py`](../backend/apps/core/rls_context.py).

This is gated by `is_staff` (not `is_superuser`) so a Support group with
`view_note` perm can read every user's notes for support reasons, without
needing the full superuser footgun.

## MFA

MFA is **fully optional** — there is no staff/`/admin/` gate. Users enroll
voluntarily from Settings. See [auth.md](auth.md) and
[decisions.md → MFA policy](decisions.md#mfa-policy-fully-optional-opt-in-for-everyone).

## The conventional pattern

Most real apps end up with:

- **One or two superusers** — you, a co-founder, emergency-access only.
  Created via `python manage.py createsuperuser`.
- **A handful of staff users** organized into Groups: "Support", "Content
  moderator", "Billing". Each Group has the minimum permissions for that
  role.
- **Everyone else** — `is_staff=False, is_superuser=False`. Normal app users.

Promotions go: regular user → add to a Group + set `is_staff=True`. Never
hand out `is_superuser` casually.

## Object-level permissions (deferred)

Django's built-in permissions are **model-level**: "can edit Notes" applies
to all Notes. **Object-level** perms are per-row: "user X can edit Note
#42 but not Note #43."

### Why deferred

RLS already enforces owner isolation at the DB layer. For the current model
(every user sees only their own playlists), object-level perms add nothing
beyond a junction table and a join on every check.

The *trigger* to add them is a **sharing** feature: "share this playlist with
user Y" (beyond the `is_public` read flag). We don't have one yet. Premature.

### Decision matrix when we do add them

| Library | Model | Best for |
|---|---|---|
| **`django-guardian`** | Stores `(user, content_type, object_id, permission)` rows | **Dynamic grants** — sharing, per-row ACLs assigned at runtime via UI |
| **`django-rules`** | Predicates as code (no DB rows) | **Static rules** — perms derivable from object state ("user is the team lead of the team this note belongs to"). Cleaner, faster, no extra tables |

Both implement Django's object-permission interface, so DRF's
`DjangoObjectPermissions` works with either. They can coexist: rules for
static logic, guardian for grants.

### When we add it

1. Create a `shares` model with `(note, shared_with, permission)`
2. Extend the RLS policy:
   ```sql
   owner_id = current_setting('rls.user_id')::int
   OR EXISTS (
     SELECT 1 FROM shares
     WHERE note_id = id
     AND shared_with_id = current_setting('rls.user_id')::int
   )
   OR current_setting('rls.bypass') = 'true'
   ```
3. Install `django-guardian` (or `django-rules`) for the app-layer API
4. Add `DjangoObjectPermissions` to the viewset

RLS still enforces at the DB. Guardian/rules give ergonomic checks in
views (`request.user.has_perm("change_note", note)`).

Until then: `IsAuthenticated` + RLS owner isolation is the full story.

## See also

- [rls.md](rls.md) — DB-layer enforcement
- [auth.md](auth.md) — MFA staff gate
