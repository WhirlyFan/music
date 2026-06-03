---
name: frontend-state-management
description: State patterns for this Vite + React app — TanStack Query for server state (the default), useState for local, Zustand sparingly for shared client state, TanStack Form + Zod for forms. The query-key factory, the api client, cache-seeding mutations, and skipToken. Use when fetching data, mutating, caching, or deciding where a piece of state lives.
---

# Frontend State Management

Server state is the bulk of it, and **TanStack Query owns it.** See `docs/frontend.md` for the authoritative stack. No Redux, no Supabase, no broadcast layer; `nuqs` is a documented *future* (not installed).

## Where does this state go?

| State | Tool | Why |
| --- | --- | --- |
| API/DB data, loading/error | **TanStack Query** (`useQuery`) | Cached, deduped, refetched; one hook = one network call regardless of callers |
| Local UI (open, hover, input draft) | **`useState`** | Scoped to one component |
| URL-worthy (tab, filter, deep-link) | **TanStack Router search params** (`validateSearch` + `Route.useSearch()`) | Shareable; `nuqs` only if/when we adopt it |
| Shared client state (rare) | **Zustand** | Only the theme + overlay stores exist today — reach for it sparingly, prefer Query/`useState` first |
| Form values + validation | **TanStack Form + Zod** | See `frontend-forms` |
| Ephemeral overlay (modal/confirm) | `overlay.open()` (`@/lib/overlay`) | Imperative API over a private Zustand store — no open-flag state |

Default to Query + `useState`. If you think you need a store, check whether the data is really server state (→ Query) or belongs in the URL (→ search params) first.

## The query layer (`src/lib/query/`)

- **`client.ts`** — the `QueryClient`. Defaults: `staleTime: 2min`, `retry: 1`. Override per-query (tighter for near-real-time, looser for rarely-changing auth state).
- **`keys.ts`** — centralized key factories, one namespace per domain (`sessionKeys`, `noteKeys`, `playlistKeys`, `roomKeys`, …). Each has `all()` (broad prefix) + `list()`/`detail(id)` beneath it. **Every entry is a function**, even no-arg ones, for a uniform call shape. Invalidate the narrowest matching prefix.
- **`<domain>.ts`** — hooks (`catalog.ts`, `rooms.ts`, `notes.ts`). One module per domain; types come from `@/lib/api/types` (generated — `components['schemas']['Room']`).
- **`@/lib/api/client.ts`** — the typed `api<T>(path, opts)` fetch wrapper (same-origin, CSRF, credentials). It throws `ApiError` on non-2xx; **don't catch-and-swallow** in a `queryFn` — let it propagate so `isError` works.

## Patterns (from the codebase)

**Query hook:**
```ts
export function useRoom(enabled = true) {
  return useQuery({ queryKey: roomKeys.me(), queryFn: () => api<Room>('/rooms/me/'), enabled })
}
```

**Mutation that seeds the cache** — when the endpoint returns the fresh resource, `setQueryData` instead of invalidating (no extra round-trip). `rooms.ts` uses a small `useRoomMutation` helper that does `onSuccess: (room) => qc.setQueryData(roomKeys.me(), room)`. When the mutation affects *another* domain, `invalidateQueries({ queryKey: otherKeys.all() })` (e.g. matching a track invalidates both the room and the playlist).

**Nullable query params → `skipToken`**, never `enabled:false` + `!`:
```ts
import { skipToken, useQuery } from '@tanstack/react-query'
useQuery({ queryKey: keys.detail(id), queryFn: id ? () => api(`/x/${id}/`) : skipToken })
```
For mutations with a required-but-nullable arg, guard at the top of `mutationFn` (`if (!x) throw …`) — fail fast, don't cast.

**Fetch-on-arrival:** prefer a route `loader` over a `useEffect` (see `docs/frontend.md` / `frontend-routing-and-layouts`). Effects are for syncing with external systems, not data fetching — see `frontend-react-effects`.

## Zustand (sparingly)

Only for genuinely shared, non-server, non-URL client state. Today: `lib/theme/store.ts` (persisted theme, applied before mount) and `lib/overlay/store.ts` (private to the overlay system). Pattern: `create()` with `devtools`; keep stores small and hookless. Don't add a store for something one component owns (`useState`) or that the server owns (Query).
