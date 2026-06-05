---
name: frontend-routing-and-layouts
description: Routing & layouts for this Vite app — TanStack Router with file-based routes (NOT Next.js App Router). The auto-generated routeTree.gen.ts, file conventions (__root, index, $param, $splat, nested dirs), createFileRoute, the root layout, params/search/navigation hooks, head/meta for titles, and preloading. Use when adding a route, a dynamic segment, a layout, or wiring navigation.
---

# Frontend Routing & Layouts

**TanStack Router, file-based.** Not Next.js — there is no `app/` dir, no server components, no special `layout.tsx`/`page.tsx`. Routes live in `src/routes/`; the `@tanstack/router-plugin/vite` plugin (`vite.config.ts`, `autoCodeSplitting: true`) generates **`src/routeTree.gen.ts`** on the fly.

> **Never edit `routeTree.gen.ts`** — it's generated. Add/rename files in `src/routes/` and the tree regenerates.

The router is created in `src/main.tsx`: `createRouter({ routeTree, defaultPreload: 'intent', context: { queryClient } })`, mounted via `<RouterProvider>` (with `<OverlayRenderer>` as a sibling).

## File conventions (`src/routes/`)

| File | Route |
| --- | --- |
| `__root.tsx` | Root layout + shared context; wraps everything |
| `index.tsx` | `/` |
| `login.tsx` | `/login` |
| `playlists/index.tsx` | `/playlists` |
| `playlists/$playlistId.tsx` | `/playlists/:playlistId` (dynamic) |
| `docs/$.tsx` | `/docs/*` (splat / catch-all) |
| `account/mfa.tsx` + `account/mfa/…` | nested layout + children |

Nested directories = nested paths. A file at a directory's level (e.g. `account/mfa.tsx` alongside `account/mfa/`) acts as a **layout route** — it renders `<Outlet />` for its children.

## Defining a route

```tsx
export const Route = createFileRoute('/playlists/$playlistId')({
  component: PlaylistDetailPage,
  head: () => ({ meta: [{ title: 'Playlist — music' }] }), // page <title>
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()       // typed params
  // const search = Route.useSearch()             // typed search params (URL state)
  // const navigate = useNavigate()
}
```

- **Params:** `Route.useParams()`. **Search/URL state:** `validateSearch` + `Route.useSearch()` — this is our URL-state tool (no `nuqs`).
- **Links:** `<Link to="/playlists/$playlistId" params={{ playlistId: id }}>`; programmatic `useNavigate()`.
- **Titles:** `head: () => ({ meta: [{ title }] })` (root sets the default).
- **Preloading:** `defaultPreload: 'intent'` preloads on hover/touch — usually nothing to do per-route.

## The root layout — `__root.tsx`

`createRootRouteWithContext<{ queryClient: QueryClient }>()`. It:
- runs the verified-email **`beforeLoad`** gate (see `frontend-auth-gating`),
- renders the app shell: skip-link → `<AppHeader>` → `<main><Outlet /></main>` → `<NowPlayingBar>` → `<Toaster>`.

Add a nested layout by creating a layout-route file that renders `<Outlet />`; children inherit it.

## Don'ts

- Don't reach for Next.js patterns (route groups `(group)`, `layout.tsx`, server/client split, `'use client'`) — none apply.
- Don't hand-maintain the route tree or import from anything but `./routeTree.gen`.

## References

- [TanStack Router — file-based routing](https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing), [route trees](https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts), [search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- Auth gate: `frontend-auth-gating`
