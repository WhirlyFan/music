# 0004 — TanStack Router over React Router

**Status:** Accepted
**Date:** 2026-05-22

## Context

The frontend stack already uses TanStack Query, Form, and Table. Routing
choices boil down to:

1. **TanStack Router** — typed routes, file-based or code-based, first-party
   integration with the rest of TanStack
2. **React Router** — the incumbent; massive ecosystem
3. **Next.js App Router** — would also force us into Next.js (different framework)

Our needs:
- Type-safe `Link`, `useParams`, `useSearch` — fail at compile time, not runtime
- File-based routes to match component co-location patterns
- Per-route metadata (page titles via `<head>`)
- Loaders + integration with TanStack Query (data prefetch on hover, etc.)

TanStack Router is genuinely better at these specifically. The whole
point of the typed-routes design is "rename a route → TypeScript flags
every `Link` that pointed there." React Router has hand-written types
that drift.

The downside is community size — React Router has more Stack Overflow
answers and more third-party libraries that assume it.

## Decision

Use TanStack Router with the file-based routing plugin
(`@tanstack/router-plugin`). Routes live under `frontend/src/routes/`,
codegen produces `routeTree.gen.ts` at build time.

## Consequences

### What we gain
- Renaming `/notes` → `/posts` flags every `<Link to="/notes">` in tsc
- Per-route `head` API for page titles, OpenGraph, etc.
- Consistent ecosystem feel with Query / Form / Table — same authors,
  same conventions, intentional design
- Search-param parsing is type-safe via Zod validators
- Excellent Devtools

### What we give up
- Smaller community than React Router
- Some third-party libs assume React Router (rare; usually trivial to adapt)
- `tsr generate` build step; lockfile-style `routeTree.gen.ts` file in
  source control

### What this enables
- nuqs-style URL-state patterns when we add filters / shared tabs
- Hover-to-prefetch with TanStack Query

## Notes / future work
- See [frontend.md](../frontend.md) for the routing patterns we use.
- The codegen file is checked in; we don't gitignore it.
- File-based routes for nested paths use directories: `routes/account/2fa/totp.tsx`.
