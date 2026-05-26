# Row-Level Security

Access control enforced at the database layer, not just in views. A
forgotten `.filter(owner=user)` can't leak data across users — the
Postgres role we connect as cannot escape its policies.

ADR: [decisions/0001-rls-day-one.md](decisions/0001-rls-day-one.md).

## The architecture

```
              ┌──────────────────────────────────────────┐
              │ Django request                            │
              │   request.user.id = 42                    │
              │                                           │
              │   RLSContextMiddleware:                   │
              │     SET LOCAL rls.user_id = '42'          │
              └─────────────────┬─────────────────────────┘
                                │ runs every query on this conn
                                ▼
              ┌──────────────────────────────────────────┐
              │ Postgres — running as `app_user` role     │
              │   (NO BYPASSRLS)                          │
              │                                           │
              │   SELECT * FROM notes_note                │
              │   WHERE owner_id = 42                     │  ← RLS policy adds this
              │     OR current_setting('rls.bypass')      │     transparently
              │       = 'true'                            │
              └──────────────────────────────────────────┘

              Migrations + seed run as `app_admin` (BYPASSRLS)
              so cross-user fixture setup works.
```

## Two-role Postgres

| Role | BYPASSRLS | Used for |
|---|---|---|
| `app_user` | No | Runtime app traffic. **Cannot escape policies.** |
| `app_admin` | Yes | Migrations, seed, admin shell, fixtures, RLS table ownership |

Created on first Postgres boot by [`postgres/init.sql`](../postgres/init.sql).
The split is the whole point — if the app role could BYPASSRLS, a query
bug could silently leak rows.

Env vars:

| Variable | Role | When |
|---|---|---|
| `DATABASE_URL` | `app_user` | Web + worker processes |
| `DATABASE_URL_ADMIN` | `app_admin` | Migrations on container start; `make migrate` / `make seed` |

**In Render Phase A** (see [ops/deploy-render.md](ops/deploy-render.md)),
both env vars point to the same privileged Render-managed role. RLS
policies still apply but the runtime role can technically bypass. Phase B
restores the split via a migration that `CREATE ROLE app_user`.

## The shared policy

All RLS-scoped models use the helper in
[`apps/core/rls.py`](../backend/apps/core/rls.py):

```python
def owner_scoped_policy(user_field="owner", *, name="owner_isolation"):
    return CustomPolicy(
        name=name,
        expression=(
            f"{user_field}_id = "
            f"NULLIF(current_setting('rls.user_id', true), '')::integer "
            f"OR current_setting('rls.bypass', true) = 'true'"
        ),
    )
```

Two clauses:
- `owner_id = current_setting('rls.user_id')::int` — the normal case
- `OR current_setting('rls.bypass') = 'true'` — the staff `/admin/` escape hatch

Models declare:

```python
class Note(RLSModel):
    owner = models.ForeignKey(...)
    ...
    class Meta:
        rls_policies = [owner_scoped_policy("owner")]
```

That's it. `makemigrations` picks up `Meta.rls_policies` and emits
`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` SQL.

## Middleware

[`django_rls.middleware.RLSContextMiddleware`](../backend/config/settings/base.py)
runs after `AuthenticationMiddleware` (needs `request.user`) and calls every
processor in `RLS_CONTEXT_PROCESSORS` to build the per-request session vars.

We have **one** processor —
[`apps/core/rls_context.py::set_admin_bypass`](../backend/apps/core/rls_context.py)
— which sets `rls.bypass = 'true'` for `is_staff` users hitting `/admin/`.
That's how the Django admin sees every row even with RLS on.

```python
def set_admin_bypass(request) -> dict:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated and user.is_staff):
        return {}
    if not request.path.startswith("/admin/"):
        return {}
    return {"bypass": "true"}
```

Scoped to `/admin/` deliberately — staff users hitting the *API* still
see only their own rows. The bypass is for the admin surface specifically.

## Testing pattern

[`apps/notes/tests/test_rls.py`](../backend/apps/notes/tests/test_rls.py)
is the load-bearing proof. The pattern:

1. pytest connects as `app_admin` (BYPASSRLS) so fixtures can insert
   across owners
2. Each test that *verifies* enforcement uses an `as_app_user(user_id)`
   context manager:
   ```python
   with connection.cursor() as cur:
       cur.execute("SET LOCAL ROLE app_user")
       cur.execute("SELECT set_config('rls.user_id', %s, true)", [str(user_id)])
   ```
3. Inside the block, RLS applies normally — same as production traffic

Six tests cover the matrix:

| Test | What it proves |
|---|---|
| `test_rls_policy_is_present_on_table` | Migration enabled RLS + the policy |
| `test_anonymous_bypass_returns_zero_rows` | No session var + non-BYPASSRLS role → zero rows (not an error) |
| `test_user_isolation` | User A sees A's rows; switching the session var alone switches visibility |
| `test_viewset_without_app_layer_filter_still_safe` | Deliberately broken viewset still doesn't leak |
| `test_admin_bypass_shows_all_rows` | `rls.bypass='true'` makes everything visible |
| `test_bypass_off_means_user_scoped` | Sanity: the bypass flag is what flipped behavior |

## Footguns

| Failure mode | How to avoid |
|---|---|
| Forgetting to set `rls.user_id` → queries silently return zero rows | `RLSContextMiddleware` is the chokepoint; tests assert it's installed |
| Using the admin role in app code → silently bypasses all policies | `prod.py` should assert connection role != admin (TODO) |
| Running `loaddata` or `seed` as `app_user` → fixture insert fails | Both Makefile targets inject `DATABASE_URL_ADMIN` |
| Adding a new RLS-scoped model and forgetting `rls_policies = [...]` | The model is unprotected. Code review + a "RLS coverage" test on `__subclasses__(RLSModel)` would catch it |
| Raw SQL bypassing the ORM | RLS still applies — the policy is at the DB layer. Raw SQL is *more* protected than the ORM, not less |

## Performance

RLS adds a `WHERE` clause to every query. Indexes on the columns the
policy references (here, `owner_id`) keep the cost negligible — the
policy expression is the same as `WHERE owner_id = X`, which you'd have
written by hand anyway.

The `current_setting()` call is in-process and cheap (no IPC).

## Extending the policy

Common extensions, in rough order of likelihood:

| Need | Policy change |
|---|---|
| Org/tenant scoping | Add `org_id = current_setting('rls.org_id')::int` |
| Sharing — "user X can see Y's note" | `OR EXISTS (SELECT 1 FROM shares WHERE note_id = id AND shared_with_id = current_setting('rls.user_id')::int)` |
| Public posts | `OR is_public = true` |
| Soft delete invisibility | `AND deleted_at IS NULL` |

For sharing specifically — see [permissions.md](permissions.md) for the
guardian-vs-rules decision matrix on the *app* layer that pairs with the
DB-layer RLS change.

## See also

- [permissions.md](permissions.md) — `is_staff` bypass, future object-level perms
- [auth.md](auth.md) — how `request.user.id` flows in
- [decisions/0001-rls-day-one.md](decisions/0001-rls-day-one.md) — original decision
