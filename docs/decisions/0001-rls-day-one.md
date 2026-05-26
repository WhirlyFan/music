# 0001 — Row-Level Security enforced at the database layer, day one

**Status:** Accepted
**Date:** 2026-05-22

## Context

The template ships with a full auth + permissions + RLS story from day
one. Our "vertical slice" model (`Note`) is a multi-tenant artifact —
every user owns their own.

Three patterns to enforce isolation:

1. **ORM-only `.filter(owner=request.user)`** in every viewset
2. **Schema-per-tenant** — one Postgres schema per user/org
3. **Row-Level Security policies** on the table, enforced by Postgres

Option 1 is the default Django pattern. The failure mode is *a forgotten
filter*: a new endpoint, a raw SQL query, a `loaddata` import, or an
overly broad `Prefetch` quietly leaks rows across users. The bug is
silent — there's no error, just wrong data.

Option 2 doesn't scale to per-user tenancy and complicates migrations.

Option 3 enforces the rule at the place farthest from human error: the DB.
A forgotten ORM filter or a raw SQL call still can't escape, because the
runtime Postgres role lacks BYPASSRLS.

## Decision

Wire `django-rls` and the two-role Postgres setup from day one. Every
multi-tenant model inherits `RLSModel` and declares
`rls_policies = [owner_scoped_policy("owner")]`. App connects as
`app_user` (no BYPASSRLS); migrations + seed connect as `app_admin`
(BYPASSRLS). `RLSContextMiddleware` sets `rls.user_id` per request.

## Consequences

### What we gain
- Forgotten filters can't leak data
- Raw SQL queries are *more* protected than the ORM, not less
- New devs can't introduce a regression by writing a normal-looking ORM call
- DB-level audit + RLS combine to give "who did what" + "what they could see" at the data layer

### What we give up
- Slightly more setup complexity — two roles, init.sql, middleware
- Tests must use a fixture to bypass RLS for cross-user setup
- Managed Postgres providers that give one role (Render) need accommodation — we collapse the two roles in Phase A deploy

### What now becomes harder
- Admin debugging of cross-user data — solved by the `is_staff` `/admin/` bypass via `rls.bypass` session var
- Future sharing features (object-level perms) — require extending the policy expression

## Notes / future work
- See [rls.md](../rls.md) for the runtime mechanics.
- Sharing features (decision deferred — see Object-Level Permissions
  section of the Notion plan) will extend the policy with an EXISTS
  subquery against a `shares` table.
- Multi-tenancy via Organizations will add `org_id` alongside `user_id`
  in the session vars + policy expression.
