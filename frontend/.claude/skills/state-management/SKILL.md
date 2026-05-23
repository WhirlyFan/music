---
name: frontend-state-management
description: Frontend state management patterns for React Query (server state), Zustand (client state), nuqs (URL state), Supabase broadcast (cross-client invalidation), TanStack Form + Zod (forms), and TanStack Virtual (virtualization). Use when working with data fetching, caching, mutations, URL params, stores, forms, or virtualized lists.
---
# Frontend State Management: Zustand + TanStack Query + nuqs

This skill covers **frontend-only** state management in the Next.js app (`frontend/`).

**TanStack Query for server state**, **nuqs for URL state**, **Zustand for shared client state**, **`useState` for local component state**.

## The Golden Rule: NEVER Prop-Drill Server Data

If a child needs server data, it calls the React Query hook directly. React Query deduplicates via query keys — multiple components calling the same hook = single network request.

## Quick Reference

| Data | Where | Why |
|---|---|---|
| API responses, DB rows | React Query (`useQuery`) | Cached, deduped, auto-refetched |
| Loading/error states for API calls | React Query (built-in) | Comes free with the query |
| Active tab, sort mode, filter, pagination | nuqs (`useQueryState`) | URL-persisted, shareable, bookmarkable |
| UI state not worth putting in URL | Zustand store | Shared across components but not URL-worthy |
| Deep-linkable overlay (`?open=<id>`) | nuqs | Survives refresh, shareable URL |
| Ephemeral overlay (modal, confirm, drawer, sheet) | `overlay.open` (see `frontend-overlays`) | Imperative API over a private Zustand store — no open-flag state, no Provider |
| Toasts / snackbars | `sonner` `toast()` global API | Same imperative pattern, specialized for auto-dismiss + stacking |
| Anchored popups (tooltip, popover, dropdown) | Radix primitives (shadcn `<Tooltip>`, `<Popover>`, `<DropdownMenu>`) | Anchored positioning belongs in Floating UI / Radix, not this pattern |
| Expanded rows, hover state | `useState` | Scoped to one component |
| Form input values | TanStack Form + Zod | Schema-driven validation, type-safe fields |
| Optimistic updates after mutation | React Query (`setQueryData`) | Keep cache as source of truth |

## File Organization

```
frontend/lib/hooks/
  queries/           # React Query hooks (server state)
    query-keys.ts    # Centralized query key factory
    use*.ts          # One hook per data concern
  mutations/         # React Query mutations
    use*.ts          # One hook per mutation concern
frontend/lib/stores/ # Zustand stores (client state)
  use*Store.ts       # One store per UI concern
frontend/src/app/api/_lib/
  broadcast.ts       # Central broadcast utility for cross-client invalidation
```

## React Query Rules

1. **Query keys**: Always use a centralized factory — never ad-hoc string arrays
2. **staleTime**: 1-2min for data with broadcast invalidation
3. **gcTime**: 5-30min to keep cache warm through navigation
4. **No manual listeners**: Don't add `visibilitychange`/`online` listeners — React Query handles `refetchOnWindowFocus` and `refetchOnReconnect` natively
5. **Specific invalidation**: `invalidateQueries({ queryKey: keys.specific(...) })` not `invalidateQueries()`
6. **Optimistic updates**: Synchronous in `onMutate` — NEVER use `setTimeout`
7. **Prefetch on hover**: `queryClient.prefetchQuery(...)` on mouseEnter for instant navigation
8. **`.maybeSingle()` vs `.single()`**: Use `.single()` when 0 rows is a bug, `.maybeSingle()` when 0 rows is valid
9. **Parallelize**: Use `Promise.all` for independent queries, never sequential `await`
10. **Server-side prefetching**: Prefetch in page.tsx server components to eliminate client waterfalls — see below

## Server-Side Prefetching (HydrationBoundary)

Prefetch data in server components to eliminate client-side waterfalls. The server queries the DB directly (no API route hop), seeds the React Query cache, and the client reads from cache instantly on mount.

### What to prefetch

- Data that **unblocks dependent client queries** (e.g., node info that provides IDs needed by downstream queries)
- Data needed for the **initial visible content** (above the fold)
- Small, fast queries that would otherwise create sequential waterfalls

### What NOT to prefetch

- **Large/slow data** — blocks SSR streaming. Let it load client-side with a spinner.
- **Data behind tabs/interactions** — not visible on initial render
- **Data needing client context** — auth tokens, client-side state

### Pattern

```typescript
// page.tsx (server component)
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';

export default async function Page({ params }) {
  const queryClient = new QueryClient();
  const data = await prefetchSomeData(id); // direct DB query, no API route
  if (data) {
    queryClient.setQueryData(someKeys.detail(id), data);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ClientComponent id={id} />
    </HydrationBoundary>
  );
}
```

### Rules

1. Prefetch functions go in `frontend/lib/hooks/queries/prefetch-*.ts`
2. Return data in the **exact same shape** as the client hook's `queryFn` — same types, same transformations
3. Use the **same query key** as the client hook so React Query deduplicates
4. Query Supabase/DB directly — never call your own API routes from server components
5. Always guard: `if (data) queryClient.setQueryData(...)` — don't seed null/undefined
6. Run prefetch **after** auth gate — don't fetch data for unauthenticated users

### Codebase examples

Look for `prefetch-*.ts` files in `frontend/lib/hooks/queries/` and `HydrationBoundary` usage in page/layout server components.

## Zustand Rules

1. **Selectors**: `const tab = useStore((s) => s.activeTab)` — never destructure the whole store
2. **Immutable updates**: `set((s) => ({ items: [...s.items, item] }))` — never `get().items.push(item)`
3. **Small stores**: One store per concern, not one god store
4. **Never store server data**: If it came from an API, it belongs in React Query

## URL State: nuqs

Use nuqs for any state that should be **shareable via URL**, **bookmarkable**, or **preserved on back/forward navigation**. This includes tabs, filters, sort order, pagination, search queries, and open detail panels.

Primary pattern: **nuqs (client) → React Query keys → automatic refetch**. All data fetching goes through React Query — nuqs owns the URL params that drive the query keys.

### Core APIs

**Single param:**

```typescript
const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('date'));
```

**Multiple related params** (batched into one URL update):

```typescript
const [params, setParams] = useQueryStates({
  sort: parseAsString.withDefault('date'),
  page: parseAsInteger.withDefault(1),
  filter: parseAsStringEnum(['all', 'active', 'archived']).withDefault('all'),
});

// Reset page when sort changes — single URL update
setParams({ sort: 'name', page: 1 });
```

### The Primary Pattern: nuqs → React Query

nuqs params as React Query keys. When the URL changes, the query key changes, React Query refetches automatically:

```typescript
const [params] = useQueryStates({
  sort: parseAsString.withDefault('date'),
  page: parseAsInteger.withDefault(1),
});

const { data } = useQuery({
  queryKey: entityKeys.list(scopeId, params),
  queryFn: () => fetchEntities({ scopeId, ...params }),
  staleTime: 2 * 60 * 1000,
});
```

### Rules

1. **Always use typed parsers** — `parseAsInteger`, `parseAsBoolean`, `parseAsStringEnum`, etc.
2. **Always use `.withDefault()`** — non-nullable return type, clean URLs (defaults omitted via `clearOnDefault`).
3. **Use `useQueryStates`** for related params — batches into a single URL update. Reset dependent params together.
4. **Debounce text inputs** — `parseAsString.withOptions({ limitUrlUpdates: debounce(300) })`.
5. **`shallow: true` (default)** — React Query handles data fetching client-side. Only use `shallow: false` if server components need the new params.
6. **Choose `history` per param, don't rely on the default.** nuqs defaults to `'replace'`, which is wrong for anything a user expects the back button to revert. Rule of thumb: **navigation-worthy changes use `'push'`** (tab switches, opened detail drawer, applied/removed filter, committed sort). **Incidental toggles use `'replace'`** (rapid slider scrubs, collapsed/expanded UI chrome, local preferences the user wouldn't expect in history). Getting this wrong is how back buttons silently break — see `lib/nuqs/active-inbox.ts` for a real example with mixed modes.

### Centralized Module Pattern (`lib/nuqs/<feature>.ts`)

Once a feature has more than ~3 URL params, or any URL ↔ domain conversion beyond what a parser can express, **centralize it in `frontend/lib/nuqs/<feature>.ts`**. Hooks, `<Link>` serializers, and server-side caches all import from the same module — one source of truth for a route's URL shape.

Canonical example: `frontend/lib/nuqs/active-inbox.ts` (Active Inbox route).

**Feature module vs. shared parser.** Two kinds of file live in `lib/nuqs/`:

| | Shared parser (`parse-<thing>.ts`) | Feature module (`<feature>.ts`) |
|---|---|---|
| Encodes | one value's wire format | a route's full URL shape |
| Main export | `parseAsX` from `createParser` | `xSearchParams` config + `urlTo*` / `*ToUrl` helpers |
| Imports | `nuqs`, primitive/shared utils | parsers + the route's domain types |
| Reusable across routes? | yes — that's the point | no — one route owns it |

**Litmus test:** could a second route import this file and be useful as-is? If yes → parser. If it'd have to ignore half the exports or rewrite the helpers → feature module, and any reusable piece should be extracted into its own `parse-*.ts`.

Concrete: `parse-date-range.ts` encodes `OP:DATE` / `BETWEEN:START:END` and is reusable by any route with date filtering. `active-inbox.ts` decides that *this route* exposes `dueDate`/`recDate` as `history: 'push'` params and folds them into `ContractFilter[]` via `urlToFilters` — none of that is reusable by forecast inbox because forecast has different filter types and history decisions. It imports the parser and composes its own feature module.

**Shape of a feature module:**

```typescript
// 1. Param config — pass straight to useQueryStates
export const activeInboxSearchParams = {
  tab: parseAsString.withOptions({ history: 'push' }),
  agency: parseAsArrayOf(parseAsString)
    .withDefault([])
    .withOptions({ history: 'push', clearOnDefault: true }),
  // incidental toggle — not navigation-worthy
  baaCso: parseAsBoolean.withDefault(true).withOptions({ history: 'replace', clearOnDefault: true }),
  // ...
} as const;

// 2. Shared types — derived from the config
export type ActiveInboxUrlState = inferParserType<typeof activeInboxSearchParams>;
export type ActiveInboxUrlPatch = {
  -readonly [K in keyof ActiveInboxUrlState]?: ActiveInboxUrlState[K] | null;
};

// 3. Directional URL ↔ domain helpers (only when a parser can't express the mapping)
export function urlToFilters(url, ...deps): ContractFilter[] { /* ... */ }
export function filtersToUrl(filters): { urlPatch: ActiveInboxUrlPatch; pendingTypes: Set<...> } { /* ... */ }
export function urlToSortMode(url): InboxSortMode { /* ... */ }
export function sortModeToUrl(mode): ActiveInboxUrlPatch { /* ... */ }

// 4. Reset patches — pre-built for common clear actions
export const CLEAR_FILTERS_PATCH: ActiveInboxUrlPatch = { agency: null, /* ... */ };
```

**Consumer code collapses to one hook call plus direct helper invocations:**

```typescript
const [urlState, setUrlState] = useQueryStates(activeInboxSearchParams);
const filters = urlToFilters(urlState, products, pendingTypes);
const sortMode = urlToSortMode(urlState);

// Handlers are one-liners
const handleFiltersChange = (next: ContractFilter[]) => {
  const { urlPatch, pendingTypes: p } = filtersToUrl(next);
  setPendingTypes(p);
  setUrlState(urlPatch);
};
```

**Naming convention** (directional, symmetric):

| Purpose | Name |
|---|---|
| Config object | `<feature>SearchParams` |
| State type | `<Feature>UrlState` |
| Patch type (optional, mutable, nullable) | `<Feature>UrlPatch` |
| URL → domain | `urlTo<Concept>(url, ...deps)` |
| Domain → URL patch | `<concept>ToUrl(value, ...)` |
| Pre-built reset | `CLEAR_<CONCEPT>_PATCH` |

Adding a new URL param is then one line in the config object. Derivation that can't live in a parser (cache rehydration, multi-param ↔ single-value bridging, cross-field dependencies) goes in a named directional helper — never inline in a component.

**Why `ActiveInboxUrlPatch` is wider than `Partial<ActiveInboxUrlState>`:** `Partial<>` inherits `readonly` and forbids `null` on `.withDefault()`-ed keys. `setUrlState` accepts `null` to clear to default and needs mutable keys. The `-readonly` mapped type pattern above is the canonical fix.

### Server-Side and `<Link>` Integration

The same parser config powers three places — don't re-declare parsers:

- **Client hooks**: `useQueryStates(activeInboxSearchParams)`
- **Server components**: `createSearchParamsCache(activeInboxSearchParams)` — read URL params in a server component before render
- **Typed links**: `createSerializer(activeInboxSearchParams)` — build `href` strings from a patch object, type-checked against the config

Reach for these when a server component needs to pre-filter data, or when building shareable links to a specific URL state.

### When to Use nuqs vs Zustand vs useState

| Question | If yes → |
|---|---|
| Should this state survive a page refresh or be shareable via URL? | **nuqs** |
| Do multiple components need this but it's not URL-worthy? | **Zustand** |
| Is it scoped to one component and ephemeral? | **`useState`** |

### Gotchas

- `clearOnDefault` is `true` by default — setting a param to its default removes it from the URL.
- **`history` defaults to `'replace'`**, not `'push'`. If you want back to revert the action, set `history: 'push'` explicitly. This is the single most common nuqs bug.
- `JSON.stringify`-based equality is property-order-sensitive; don't use it to compare URL states. Compare per-field or use `useQueryStates` to batch so you don't need to.
- Writing `setOpenId('')` or similar "empty but not null" values still adds a history entry. Use `null` to clear, and consider `{ history: 'replace' }` for the clear-to-default action so closing a drawer doesn't push a no-op entry.

## Supabase Broadcast (Cross-Client Invalidation)

Use **broadcast** (not `postgres_changes`) — many tables aren't in the realtime publication and `postgres_changes` silently fails.

- **Channel naming**: `{scope}-{scopeId}-{entityType}` for lists, `{entity}-{entityId}-{scopeId}` for detail

### Channel Naming Convention

All Supabase channels MUST include their scope identifier in the channel name. Supabase deduplicates channels by name — if two components subscribe to the same name with different filters, only the first filter applies.

**Format:** `{scope}-{scopeId}-{entity}[-{entityId}]`

Segments are ordered broadest → narrowest. The scope ID always comes immediately after the scope label so channels for the same workspace/user sort together and are easy to grep.

| Scope | Pattern | Example |
|---|---|---|
| Workspace list | `workspace-${workspaceId}-{entity}` | `workspace-${workspaceId}-inbox-solicitation` |
| Workspace detail | `workspace-${workspaceId}-{entity}-${entityId}` | `workspace-${workspaceId}-sol-detail-${contractId}` |
| User | `user-${userId}-{entity}` | `user-${userId}-profile` |
| Global (shared config) | `global-{entity}` | `global-solicitation-sources` |

Rules:

- **kebab-case** for all segments
- Scope ID always immediately follows its scope label: `workspace-${workspaceId}-...`, `user-${userId}-...`
- Workspace-scoped channels MUST include `${workspaceId}`
- User-scoped channels MUST include `${userId}`
- Only truly global reference data (e.g., shared source config) may omit a scope ID — prefix with `global-`
- **Senders**: API routes call broadcast utilities after DB writes
- **Server side**: Use `.httpSend()` (stateless HTTP POST) — never `.subscribe()` + `.send()` in API routes
- **Client side**: Use `.subscribe()` in useEffect with 2-second debounce before `invalidateQueries`
- **Scope invalidation**: List broadcasts invalidate list caches only. Detail broadcasts invalidate the specific detail cache. Never blanket-invalidate detail caches from list broadcasts.
- **Targets**: Only signal channels that actually changed — don't broadcast to inbox for a pipeline-only change

## Form State: TanStack Form + Zod

Forms use TanStack Form with Zod validation. Zod is the single source of truth — same schema shared between client forms and API routes.

### Why TanStack Form

- Eliminates scattered `useState` per field — one form instance manages all state
- Type-safe field paths — TS catches typos at compile time
- Completes the TanStack ecosystem (Query, Table, Virtual, Form)
- shadcn officially supports it

### Form → Mutation Flow

```typescript
const form = useForm({
  defaultValues: { email: '', name: '' },
  validators: { onChange: UserSchema },  // Zod schema
  onSubmit: async ({ value }) => {
    await mutation.mutateAsync(value);    // TanStack Query mutation
    // invalidateQueries happens in mutation's onSettled
  },
});
```

See `frontend-design` skill for component styling, CVA variants, and DataTable patterns.

## TanStack Virtual

### Architecture (Three-Part Structure)

1. **Scroll container** — fixed-height div with `overflow: auto`, passed to `getScrollElement`
2. **Spacer** — inner div using `getTotalSize()` for total list height (creates scrollbar illusion)
3. **Virtual items** — only visible elements, absolutely positioned via `transform: translateY()`

### Configuration Rules

1. **`overscan`** — buffer items above/below viewport (8 is a good default) to reduce blank flashes during fast scrolling
2. **`getItemKey`** — always provide stable keys from data IDs (`(index) => items[index]?.id ?? index`). Required when list order can change (sorting, filtering, optimistic removes)
3. **`estimateSize`** — provide best-guess heights per item type. Closer estimates = less layout shifting
4. **`measureElement`** — use `ref={virtualizer.measureElement}` + `data-index={virtualItem.index}` on each row for dynamic measurement after render
5. **`gap`** — use the `gap` option instead of CSS margin between items (margins confuse offset calculations)

### Callback Refs for Remountable Scroll Containers

When the scroll container can unmount/remount (Radix tabs, conditional rendering, dialogs), use a **callback ref + state** instead of `useRef`. A fresh `useRef` starts as `null` and mutating it doesn't trigger a re-render, so the virtualizer sees no scroll element and renders 0 items. Setting state forces the re-render.

```typescript
const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
const scrollRef = useCallback((node: HTMLDivElement | null) => { setScrollElement(node); }, []);
// <div ref={scrollRef}> ... getScrollElement: () => scrollElement
```

Pass `HTMLDivElement | null` as the prop type — not `RefObject`.

### Gotchas

- **Row state loss**: Virtualized rows mount/unmount as you scroll. Never store critical state inside row components — lift state by ID (Zustand or parent)
- **Focus loss**: If a focused input is in a row that unmounts, focus disappears. Plan focus restoration for interactive rows
- **Image scroll jumps**: Reserve fixed heights or aspect ratios for images/async content to prevent scroll position shifts
- **No CSS margins on rows**: Use the `gap` virtualizer option. CSS margins on absolutely-positioned items cause measurement drift

## Anti-Patterns

- Storing API data in `useState` or Zustand (use React Query)
- Storing ephemeral overlay open/close state in Zustand or `useState` when triggered from one place — use the `overlay.open` pattern (see `frontend-overlays`)
- Mirroring overlay open state into Zustand alongside `overlay.open` — two sources of truth
- Not including variables in query keys (cache won't update when filters change)
- Over-invalidating (don't nuke the entire cache — be specific)
- Blanket-invalidating detail caches from list broadcasts (use per-entity detail broadcast channels)
- Using `useContext` for new state management (use Zustand or React Query instead)
- `useEffect` + `useState` for data fetching (use `useQuery`)
- Manual `visibilitychange`/`online` listeners (React Query handles this)
- `setTimeout` in optimistic updates (race condition with `onSettled`)
- Duplicating Zod schemas between client and API route (share one schema)
- Using raw `useState` per field for forms (use TanStack Form)
- Manual `useSearchParams` + `URLSearchParams` + `router.push()` for URL state (use nuqs)
- Storing URL-worthy state (tabs, filters, sort, pagination) in Zustand instead of nuqs
- **Mirroring URL state into local/Zustand state** — URL is the single source of truth; bidirectional sync causes races and stale reads
- Relying on the default `history: 'replace'` for navigation-worthy URL changes — back button won't revert them
- Re-declaring nuqs parsers in multiple places for the same route — centralize in `lib/nuqs/<feature>.ts` and share with `createSearchParamsCache` / `createSerializer`
- Writing inline URL ↔ domain conversion in components — put it in a directional helper (`urlTo*` / `*ToUrl`) in the feature module
- Updating URL on every keystroke without debounce (use `limitUrlUpdates: debounce(300)`)
- Using `useRef` for virtualizer scroll containers that can unmount/remount (use callback ref + state)

## When useEffect IS Still Appropriate

- Realtime subscriptions (Supabase broadcast channels) — setup/teardown lifecycle
- One-time side effects (PostHog tracking, analytics)
- DOM interactions (scroll position, focus management)
- Event listeners (keyboard shortcuts, resize)

**Rule**: If your useEffect calls `fetch()` or `setState()` with server data, it should be a React Query hook. If it sets up a subscription/listener needing cleanup, useEffect is correct.

## Codebase Examples

Refer to these files as working references for each pattern:

| Pattern | File(s) |
|---|---|
| Query key factory | `frontend/lib/hooks/queries/query-keys.ts` |
| Standalone React Query hook | `useInboxCounts.ts`, `useSolDetail.ts` |
| Consolidated multi-fetch endpoint | `useSolDetail.ts` • `sol-detail/route.ts` |
| Optimistic mutation + rollback | `useInboxMutations.ts` |
| Broadcast sender (server) | `frontend/src/app/api/_lib/broadcast.ts` |
| List broadcast listener (client) | `useInboxRecommendations.ts` |
| Per-entity detail broadcast | `useSolDetail.ts` (subscriber), API status routes (senders) |
| Focused Zustand store | `useInboxStore.ts`, `useInboxBulkStore.ts` |
| Callback ref + virtualizer | `ActiveInboxContent.tsx` → `ContractList.tsx` |
| Server-side prefetch (HydrationBoundary) | `prefetch-*.ts` files + page/layout server components |
| Centralized nuqs feature module | `frontend/lib/nuqs/active-inbox.ts` (consumed by `ActiveInbox.tsx`) |
| Custom nuqs parser | `frontend/lib/nuqs/parse-date-range.ts` (`createParser` with compact string encoding) |

NOTE: The Notion doc also has a very long "Detailed Reference" section after the main content with full code examples for React Query Patterns, Zustand Patterns, nuqs Patterns, Supabase Broadcast Full Flow, Form State patterns, TanStack Virtual patterns, and more codebase examples. However, the codebase SKILL.md already has this detailed reference section. Read the current file first and keep the detailed reference section if it exists. If the current file already has the detailed content, just ensure the summary sections above match exactly.
