---
name: frontend-routing-and-layouts
description: Next.js App Router patterns for this repo — route groups, nested layouts, special files (loading/error/not-found/template), typed route helpers, server-vs-client layout split, active-segment detection, and Suspense-in-layout. Use when creating or restructuring routes, adding layouts, or choosing where to put shared chrome.
---

# Frontend Routing & Layouts

App Router conventions for `frontend/src/app/` (Next.js 16, React 19). This skill codifies the structural rules that surfaced during the ENG-2224 refactor: **route groups express layout intent**, **shared chrome lives in nested layouts**, and **App Router special files (`loading`/`error`/`not-found`/`template`) are the Next-native way to handle states we're currently hand-rolling**.

## Related Skills

- `frontend-conventions` — import rules, tool ownership, error handling, React Compiler
- `frontend-proxy` — `proxy.ts` auth gate that runs **before** layouts; layouts read session data after proxy has refreshed it, layouts are not a security boundary
- `frontend-state-management` — React Query, Zustand, nuqs, prefetch patterns
- `frontend-performance` — async waterfalls, server-side prefetch rules
- `frontend-composition` — compound components, server/client boundaries

---

## 1. Route groups describe **layout intent**, not content

Route groups are folders wrapped in parentheses — e.g. `(sidebar)`, `(fullscreen)`. They **do not affect the URL**. Their only job is to let sibling pages share a layout without sharing a URL prefix.

**Rule:** Name the group after the chrome its children share, not after what those pages are about.

| ✅ Layout-intent names                                                         | ❌ Content-category names                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `(sidebar)` — everything under this renders inside the workspace sidebar shell | `(dashboard)` — "dashboard" is a page type, not a layout       |
| `(fullscreen)` — no chrome, edge-to-edge (onboarding, proposal-writer editor)  | `(inbox)` — "inbox" is a feature, not a chrome style           |
| `(auth)` — centered-card layout for login/signup/oauth                         | `(contracts)` — "contracts" is a domain                        |
| `(app)` — authenticated root shell with providers                              | `(marketing)` — only works if marketing pages share one layout |

**Why it matters:** When the group name describes content, the next engineer can't tell which chrome applies without opening the folder. When it describes intent, the folder tree is self-documenting and new routes slot in without a pathname regex.

**Content grouping is fine as a secondary pattern** — e.g. `(sidebar)/(inbox)/` where `(sidebar)` is the real layout boundary and `(inbox)` is a code-organization group that _also_ happens to carry a nested layout for tab chrome. Just don't let `(inbox)` be the _only_ group when what you really mean is "these share the sidebar."

---

## 2. Hoist shared chrome into nested layouts — never into sibling pages

If two or more sibling routes render the same header, tab bar, filter row, or action strip, that chrome belongs in a `layout.tsx` at their common parent — **not duplicated in each page**, not extracted into a shared component that each page mounts.

### Why

- `layout.tsx` **persists across navigation between its children**. Duplicated-component chrome re-mounts on every tab switch: state is lost, animations restart, data is re-fetched.
- React Query cache seeding belongs in the layout once, not in each page.
- Leaving chrome in pages forces URL/tab state into component state, which defeats the point of having separate routes.

### Example — the inbox tabs

Two routes share the same tab bar, filter row, bulk toolbar, and saved-views dropdown:

```
(sidebar)/(inbox)/
├── layout.tsx               ← tab bar + InboxFilters + bulk toolbar + saved views
├── active-inbox/page.tsx    ← just the list + empty state
└── forecast-inbox/page.tsx  ← just the list + empty state
```

Switching tabs now keeps the chrome mounted; only the `page.tsx` content re-renders. Filter state, selection state, and saved-views data survive the navigation.

### Example — contract detail shell

```
(sidebar)/(contracts)/[type]/[id]/
├── layout.tsx   ← back button, title, status badges, action strip
├── page.tsx     ← detail body
└── chat/page.tsx ← chat view (same header)
```

### When NOT to hoist

- The chrome only renders on **one** route. Don't create a layout for a single child — it adds indirection for no benefit.
- The chrome depends on **route params or search params** that only exist at the page level. Layouts don't re-render on param changes (see §3); pages do.
- The sibling pages actually want **different** chrome. Use separate route groups with separate layouts instead.

---

## 3. Layout constraints (what layouts CANNOT do)

These are rules from the [Next.js `layout.js` API reference](https://nextjs.org/docs/app/api-reference/file-conventions/layout). Violating them either silently breaks navigation or throws at build.

### 3.1 Layouts **cannot** pass data to children via props

There is no `{ children, data }` prop — only `{ children, params }` (and parallel-route slots). If two children need the same server data, flow it through **either**:

- `HydrationBoundary` → React Query cache (our existing pattern for workspace prefetch), **or**
- React `cache()` wrapping the server function, so layout + page both call it without double-fetching (see §9)

### 3.2 Layouts **do not re-render on navigation** between their children

This means inside a `layout.tsx` file you **cannot rely on** runtime path/query data:

- ❌ `usePathname()` / `useSearchParams()` directly in `layout.tsx` — the value is captured once and goes stale on navigation
- ❌ `cookies()` / `headers()` as "runtime data" — layouts cache across children, so reads get stamped into the first render
- ❌ Reading URL-derived state to decide which chrome to show

The correct pattern is to render a **client component inside the layout** that reads the URL via hooks. Today's `LayoutContent.tsx` is an example — keep that shape, just move the decision from pathname regex to route groups (§1) or `useSelectedLayoutSegment` (§7).

### 3.3 No `<head>` tags in layouts

Use the [Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata):

```tsx
// app/(app)/workspace/[workspaceId]/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { template: '%s — Usul', default: 'Usul' },
}
```

Or `generateMetadata(props)` when you need async/dynamic data.

### 3.4 `params` is a Promise — always `await`

Next.js 16 makes `params` and `searchParams` async. Never destructure them synchronously:

```tsx
// ❌ breaks at runtime
export default function Layout({ params }: { params: { workspaceId: string } }) {
  const { workspaceId } = params
}

// ✅
export default async function Layout(props: LayoutProps<'/workspace/[workspaceId]'>) {
  const { workspaceId } = await props.params
}
```

### 3.5 Multiple root layouts trigger a full page reload on cross-group navigation

If `(auth)/layout.tsx` and `(app)/layout.tsx` are both root layouts (each owns `<html>` and `<body>`), navigating between them reloads the page. That's **fine and often desired** for login↔app — cold start clears stale providers, auth state, and analytics sessions. Don't make auth and app share a root layout just to avoid the reload.

---

## 4. Server-component layouts wrap client shells

Default every `layout.tsx` to a **server component**. Only the inner shell that needs hooks, event handlers, or client-only state should be `'use client'`.

### Pattern

```tsx
// app/(app)/workspace/[workspaceId]/(sidebar)/layout.tsx — SERVER
import { SidebarShell } from './SidebarShell'

export default function Layout({ children }: LayoutProps<'/workspace/[workspaceId]/(sidebar)'>) {
  return <SidebarShell>{children}</SidebarShell>
}
```

```tsx
// app/(app)/workspace/[workspaceId]/(sidebar)/SidebarShell.tsx — CLIENT
'use client'
import { MainSidebar } from '@/components/MainSidebar'
import { AppShell } from '@/components/AppShell'

export function SidebarShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell sidebar={<MainSidebar />} footer={<MobileFooter />}>
      {children}
    </AppShell>
  )
}
```

### Why

- The server layout file can `await` database calls, read cookies server-side, do auth gating, and seed React Query — **none of which work inside a `'use client'` file**.
- The client shell still owns interactive state (`useSelectedLayoutSegment`, sidebar collapse state, sheet open state).
- Server-component boundary shrinks client JS: the layout file itself ships zero bytes to the browser.

### Anti-pattern

Marking the layout file itself `'use client'`. Once you do, you lose async-ness, you can't do server prefetch in the layout, and the entire subtree inherits client-component constraints for no reason. We do this today in `(dashboard)/workspace/[workspaceId]/LayoutContent.tsx` because the file owns both concerns — split it during the ENG-2224 refactor.

---

## 5. Special files cheat sheet

Drop these next to `page.tsx` in any segment. Next.js wires them up automatically.

| File               | When it fires                                                          | Must be client? | Notes                                                        |
| ------------------ | ---------------------------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| `layout.tsx`       | Wraps the segment + all children                                       | No              | Persists across child navigation                             |
| `page.tsx`         | Leaf route — renders at the segment's URL                              | No              | `params` is a Promise                                        |
| `loading.tsx`      | Renders as `<Suspense fallback>` while the segment's `page.tsx` loads  | No              | See Cache-Components gotcha below                            |
| `error.tsx`        | Catches render errors thrown in the segment's `page.tsx` / children    | **Yes**         | Receives `{ error, reset }` — `reset` retries the segment    |
| `global-error.tsx` | Catches errors in the **root** layout itself (where `error.tsx` can't) | **Yes**         | Must render its own `<html><body>`                           |
| `not-found.tsx`    | Renders when `notFound()` is called from the segment or a child        | No              | Root `not-found.tsx` also handles unmatched URLs             |
| `template.tsx`     | Like layout, but **re-mounts** on every navigation between children    | No              | Use for per-nav animations / resetting state — rarely needed |
| `default.tsx`      | Fallback for unmatched parallel-route slots                            | No              | Only needed with `@slot` parallel routes                     |
| `route.ts`         | Route handler (GET/POST/etc) — API endpoint                            | No              | Server-only, no UI                                           |

### 5.1 Cache Components × `loading.tsx` gotcha

> Under Cache Components (`next.config.ts: cacheComponents: true`, which this repo uses), `loading.tsx` **does NOT** cover **runtime data awaited directly in the sibling `layout.tsx`**.

The layout boundary is hoisted above the `loading.tsx` Suspense boundary Next inserts. So if your layout does:

```tsx
// ❌ uncached awaits in layout — loading.tsx does not cover these
export default async function Layout(props: LayoutProps<'/workspace/[workspaceId]'>) {
  const { workspaceId } = await props.params
  const workspace = await prefetchWorkspace(workspaceId) // uncached
  const members = await prefetchMembers(workspaceId) // uncached
  return <SidebarShell>{children}</SidebarShell>
}
```

…the page blocks on all three prefetches before **anything** renders, and no skeleton appears.

**Fix: wrap the prefetches in their own `<Suspense>` inside the layout.** The static shell streams immediately; the prefetch stream fills in behind the boundary.

```tsx
// ✅
export default async function Layout(props: LayoutProps<'/workspace/[workspaceId]'>) {
  const { workspaceId } = await props.params
  return (
    <Suspense fallback={<WorkspaceShellSkeleton />}>
      <WorkspacePrefetch workspaceId={workspaceId}>{props.children}</WorkspacePrefetch>
    </Suspense>
  )
}

// WorkspacePrefetch.tsx — async server component
async function WorkspacePrefetch({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  const qc = new QueryClient()
  await Promise.allSettled([
    qc.prefetchQuery({
      queryKey: ['workspace', workspaceId],
      queryFn: () => getWorkspace(workspaceId),
    }),
    qc.prefetchQuery({
      queryKey: ['members', workspaceId],
      queryFn: () => getMembers(workspaceId),
    }),
  ])
  return <HydrationBoundary state={dehydrate(qc)}>{children}</HydrationBoundary>
}
```

If the prefetch is small and fast and you want it to block (so children never see a loading state), skip the Suspense — but then skip `loading.tsx` too, because it won't fire.

### 5.2 `error.tsx` must be a client component

```tsx
// app/(app)/workspace/[workspaceId]/error.tsx
'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    posthog.captureException(error, { source: 'workspace_layout_error', digest: error.digest })
  }, [error])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h2 className="text-lg font-medium">Something went wrong loading this workspace.</h2>
      <button onClick={reset} className="bg-primary text-primary-foreground rounded px-4 py-2">
        Try again
      </button>
    </div>
  )
}
```

Always call `posthog.captureException` with a `source` label (per `frontend-conventions`). The `digest` is useful for cross-referencing server logs. `reset()` re-renders the segment — it doesn't refetch server data; if the error was a failed fetch, pair `reset` with `router.refresh()` or a `queryClient.resetQueries` call.

### 5.3 Where to put them

At minimum, ENG-2224 adds:

- Root `error.tsx`, `not-found.tsx`
- `(app)/workspace/[workspaceId]/loading.tsx` + `error.tsx` — the workspace shell skeleton + scoped fallback
- `(app)/workspaces/loading.tsx` + `error.tsx` — workspaces picker
- `(sidebar)/(inbox)/loading.tsx` — list skeleton (the shared chrome stays mounted from the layout)
- `(sidebar)/(contracts)/[type]/[id]/loading.tsx` + `error.tsx`

---

## 6. Typed route helpers — `LayoutProps<>` / `PageProps<>`

Next.js 16.2+ generates `LayoutProps<'/path/with/[param]'>` and `PageProps<'/path'>` from the filesystem at `next dev` / `next build`. No import needed — they're globals.

```tsx
// ✅ auto-typed from the folder structure; params/searchParams validated against [workspaceId]
export default async function Layout(props: LayoutProps<'/workspace/[workspaceId]'>) {
  const { workspaceId } = await props.params
  return props.children
}

export default async function Page(props: PageProps<'/workspace/[workspaceId]/opp/[id]'>) {
  const { workspaceId, id } = await props.params
  const { tab } = await props.searchParams
  // ...
}
```

### Why

- **Single source of truth** — if you rename `[workspaceId]` → `[wsId]` the path string in `LayoutProps<'...'>` now doesn't match and TS errors at the callsite. Manual `{ params: Promise<{ workspaceId: string }> }` has no such check.
- **No imports, no duplication** — every file that uses the helper looks identical.
- **Parallel route slots are typed automatically** — `LayoutProps<'/'>['modal']` has the right shape.

### Migration

Mechanical find-replace when a folder is restructured:

```tsx
// before
{
  params: Promise<{ workspaceId: string }>
  children: React.ReactNode
}

// after
LayoutProps<'/workspace/[workspaceId]'>
```

**All new code uses these helpers.** Only fall back to hand-typed props if the file isn't under `app/` (e.g. a shared helper that happens to receive layout-shaped props — type it explicitly there).

---

## 7. Active-segment detection via `useSelectedLayoutSegment`

Never parse `usePathname()` to figure out which nav item is active. `useSelectedLayoutSegment()` returns the child segment of the _current_ layout — typed, idiomatic, and survives restructures.

```tsx
'use client'
import { useSelectedLayoutSegment } from 'next/navigation'

export function MainSidebar() {
  const segment = useSelectedLayoutSegment()
  // segment is one of: 'pipeline' | 'chat' | 'search' | 'settings' | 'active-inbox' | 'forecast-inbox' | null | ...

  return (
    <nav>
      <NavLink href="pipeline" isActive={segment === 'pipeline'}>
        Pipeline
      </NavLink>
      <NavLink href="active-inbox" isActive={segment === 'active-inbox'}>
        Inbox
      </NavLink>
    </nav>
  )
}
```

For deeper nesting use `useSelectedLayoutSegments()` — it returns the array of segments below the layout. E.g. inside `(inbox)/layout.tsx`, `useSelectedLayoutSegments()` returns `['active-inbox']` or `['forecast-inbox']`.

### What this replaces

```tsx
// ❌ fragile — re-matches on every pathname change, breaks if we move routes
const pathname = usePathname()
const isPipeline = pathname?.startsWith(`/workspace/${workspaceId}/pipeline`)
```

```tsx
// ❌ the same regex hack ENG-2224 is tearing out
const isProposalWriterEditorPage = pathname?.match(/\/proposal-writer\/[^/]+$/)
```

Route groups (§1) plus `useSelectedLayoutSegment` together make both of these obsolete.

---

## 8. Suspense-in-layout for runtime data

Layouts run once per navigation into a subtree. If the layout awaits data directly, that await blocks the whole subtree's first paint — even the static parts.

**Rule:** Wrap every uncached `await` in `layout.tsx` in its own `<Suspense fallback>`.

This is the Cache-Components gotcha from §5.1, stated as a positive rule. Two shapes:

### 8.1 Streaming static shell + dynamic children

```tsx
export default function Layout({ children }: LayoutProps<'/workspace/[workspaceId]'>) {
  return (
    <div className="flex h-screen">
      <aside>{/* static sidebar chrome — renders instantly */}</aside>
      <main>
        <Suspense fallback={<WorkspaceBodySkeleton />}>
          <WorkspacePrefetch>{children}</WorkspacePrefetch>
        </Suspense>
      </main>
    </div>
  )
}
```

The `<aside>` paints immediately. The prefetch streams in behind the `<Suspense>`.

### 8.2 Parallel prefetches with shared fallback

```tsx
;<Suspense fallback={<Skeleton />}>
  <ParallelPrefetch>{children}</ParallelPrefetch>
</Suspense>

async function ParallelPrefetch({ children }: { children: React.ReactNode }) {
  const [workspace, members, onboarding] = await Promise.all([
    getWorkspace(id),
    getMembers(id),
    getOnboarding(id),
  ])
  // seed query cache, return children
}
```

`Promise.all` inside one async component is **much better than three sequential `await`s** — even without Suspense, it halves the latency.

### 8.3 Partial Pre-rendering (opt-in, v16)

If a route has a static shell and a dynamic pocket, you can opt into PPR to pre-render the shell at build and stream the pocket at request time:

```tsx
export const experimental_ppr = true

export default function Page() {
  return (
    <>
      <StaticHeader /> {/* pre-rendered */}
      <Suspense fallback={<Skeleton />}>
        <DynamicBody /> {/* streamed */}
      </Suspense>
    </>
  )
}
```

Enable in `next.config.ts`: `experimental: { ppr: 'incremental' }`. Only adopt this per-route — don't flip it globally until we've measured.

---

## 9. React `cache()` for server-side dedup

`fetch()` in server components dedupes automatically within a request. **Supabase client calls do not.** If a layout and its page both call `getWorkspace(id)`, you get two round-trips.

Wrap the getter in `cache()` from `react`:

```tsx
// frontend/lib/server/workspace.ts
import { cache } from 'react'
import { createClient } from '@/utils/supabase/server'

export const getWorkspace = cache(async (id: string) => {
  const supabase = await createClient()
  const { data, error } = await supabase.from('workspaces').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
})
```

Now `getWorkspace(id)` from the layout and `getWorkspace(id)` from the page share one result for the duration of the request. No need to pass data through props (which layouts can't do anyway — §3.1).

### When to reach for it

- Same server function called from `layout.tsx` + `page.tsx` (workspace, user, membership, onboarding status)
- Same getter called from multiple `generateMetadata` functions + the page body
- A server util that wraps a non-`fetch` data source (Supabase, Neon, internal HTTP client that doesn't set cache keys)

### When NOT to reach for it

- The underlying call is already `fetch()` — already deduped
- The value is memoized in React Query — client-side cache handles it
- You only call it once per request anyway

### `cache()` vs `use cache` directive

- `cache()` — **per-request** memoization. Same request = shared result. New request = new call. Use this for request-scoped dedup.
- `'use cache'` directive — **cross-request** caching (see `frontend-state-management` / Next.js docs). Use for expensive queries you want to share across users. Different tool, different problem.

---

## 10. Anti-patterns

Do not introduce these. When you find them, migrate per the section noted.

| Anti-pattern                                                                                   | Fix                                                                           | See      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Pathname regex to decide which chrome to show (`pathname?.match(/\/proposal-writer\/[^/]+$/)`) | Route groups (`(sidebar)` vs `(fullscreen)`)                                  | §1       |
| Shared chrome duplicated across sibling pages                                                  | Hoist into nested `layout.tsx`                                                | §2       |
| `'use client'` at every `layout.tsx`                                                           | Server layout wrapping a client shell                                         | §4       |
| `usePathname()` or `useSearchParams()` directly in `layout.tsx`                                | Move to a client child; or use `useSelectedLayoutSegment`                     | §3.2, §7 |
| `{ params: Promise<{ workspaceId: string }> }` hand-typed everywhere                           | `LayoutProps<'/workspace/[workspaceId]'>` / `PageProps<>`                     | §6       |
| Awaiting prefetches directly in `layout.tsx` with no Suspense                                  | Wrap in `<Suspense fallback>` inside the layout                               | §5.1, §8 |
| Sequential `await` for unrelated prefetches                                                    | `Promise.all` inside one async server component                               | §8.2     |
| Same Supabase call from layout + page                                                          | `cache()` the getter                                                          | §9       |
| `getServerSideProps` / `getStaticProps`                                                        | Not supported in App Router — fetch in the server component                   | —        |
| `<head>` tags in layouts / `next/head` import                                                  | `export const metadata` or `generateMetadata`                                 | §3.3     |
| Naming a route group for its content (`(inbox)`, `(contracts)`) as the **only** group          | Pair with an outer layout-intent group (`(sidebar)/(inbox)`)                  | §1       |
| Passing server data through layout props to children                                           | React Query `HydrationBoundary` or `cache()`                                  | §3.1, §9 |
| Manual active-nav detection via `pathname.startsWith(...)`                                     | `useSelectedLayoutSegment()`                                                  | §7       |
| Single `error.tsx` at root trying to catch everything                                          | One per meaningful segment boundary — workspace, workspaces, contracts detail | §5.3     |

---

## 11. Target project structure (ENG-2224)

The structure this skill codifies. ENG-2224 does the mechanical restructure; this skill is the "why" for future routes.

```
frontend/src/app/
├── layout.tsx                    # root: <html>, theme, providers, Metadata
├── error.tsx                     # root error boundary
├── not-found.tsx                 # branded 404
│
├── (auth)/                       # own root layout; full reload on cross-group nav (OK at login)
│   ├── layout.tsx                # centered-card chrome
│   ├── login/ signup/ set-password/ oauth/ docs-access/ docs-login/
│
├── (app)/                        # authenticated shell (renamed from (dashboard))
│   ├── layout.tsx                # session check, QueryClient, nuqs adapter
│   │
│   ├── (fullscreen)/             # auth'd, no sidebar
│   │   ├── onboarding/ multi-workspace-join/
│   │
│   ├── workspaces/               # picker
│   │   ├── layout.tsx            # AppShell + WorkspacesSidebar
│   │   ├── loading.tsx  error.tsx
│   │   ├── team/ my-account/ admin/
│   │   └── page.tsx
│   │
│   └── workspace/[workspaceId]/
│       ├── layout.tsx            # SERVER: auth gate, prefetch in <Suspense>, HydrationBoundary
│       ├── loading.tsx           # sidebar+content skeleton
│       ├── error.tsx             # workspace-scoped fallback
│       │
│       ├── (sidebar)/            # MainSidebar routes
│       │   ├── layout.tsx        # SERVER wrapping <SidebarShell> ('use client')
│       │   │
│       │   ├── (inbox)/          # nested layout for tab chrome
│       │   │   ├── layout.tsx    # tab bar + filters + bulk toolbar + saved views
│       │   │   ├── active-inbox/page.tsx
│       │   │   └── forecast-inbox/page.tsx
│       │   │
│       │   ├── (contracts)/
│       │   │   ├── [type]/[id]/layout.tsx  # back button, header, status, action strip
│       │   │   └── opp/ sam/ sbir/ forecasts/ delivery-orders/
│       │   │
│       │   ├── (intel)/          # code-grouping only; no nested layout
│       │   ├── pipeline/ chat/ search/ settings/ company-profile/
│       │   └── proposal-writer/  # list page only
│       │
│       └── (fullscreen)/         # no sidebar, same workspace context
│           └── proposal-writer-editor/[id]/
│
└── api/
```

### Key moves

- **Layout intent, not content** — `(sidebar)` and `(fullscreen)` live inside the workspace, so a route can opt out of chrome without leaving workspace context. `(inbox)` and `(contracts)` are content groupings _inside_ `(sidebar)`.
- **Auth split** — `(auth)` has its own root layout; cross-group navigation to `(app)` triggers a full reload (desired at login/logout).
- **Nested layouts do real work** — `(inbox)/layout.tsx` owns the tab bar so tab-switching doesn't re-mount chrome; `(contracts)/[type]/[id]/layout.tsx` owns the detail shell so chat/page navigation doesn't re-render the header.
- **Server layouts, client shells** — `(sidebar)/layout.tsx` is a server file that imports and renders `<SidebarShell>` (`'use client'`). Server-side data (session, prefetch) stays in the layout file; client hooks stay in the shell.
- **Unified `<AppShell>`** — `frontend/components/AppShell.tsx` is the one `flex h-screen + aside + main + footer` primitive. Both workspace shell and workspaces-picker shell compose it.

---

## References

- [Next.js `layout.js` API reference](https://nextjs.org/docs/app/api-reference/file-conventions/layout)
- [Next.js route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js parallel routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes)
- [Next.js intercepting routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes)
- [Next.js `loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading)
- [Next.js `error.js`](https://nextjs.org/docs/app/api-reference/file-conventions/error)
- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js `useSelectedLayoutSegment`](https://nextjs.org/docs/app/api-reference/functions/use-selected-layout-segment)
- [React `cache()`](https://react.dev/reference/react/cache)
- ENG-2224 — the accompanying refactor this skill codifies conventions for
