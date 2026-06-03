---
name: frontend-performance
description: Frontend performance for this Vite + React 19 app — the React Compiler's effect on memoization, eliminating async waterfalls (TanStack Query / route loaders), code-splitting & bundle size, re-render/render/JS micro-optimizations. Use when optimizing performance, fixing waterfalls, or trimming bundle size.
---

# Frontend Performance

**Vite + React 19** SPA. Principles adapted from Vercel Engineering's React Best Practices, translated to our stack (no Next.js — no Server Components, `next/dynamic`, `next/image`, or API routes). Ordered by impact.

## 0. React Compiler changes the rules — read first

`babel-plugin-react-compiler` auto-memoizes components/hooks/expressions at build (`docs/frontend.md`). So:

- **Don't add `useMemo` / `useCallback` / `React.memo`** — the compiler does it. Manual memoization is noise and can fight the compiler.
- It only works if you **follow the Rules of React** (no mutation/refs/side-effects during render). Breaking them makes the compiler bail (and trips `eslint-plugin-react-compiler`). Fix the violation, don't disable the lint.
- `useEffect` dependency arrays are still required — effects aren't memoization.

Most "re-render optimization" below is therefore about **not creating the problem** (derive during render, narrow what you read), not about hand-memoizing.

## 1. Eliminate waterfalls — CRITICAL

Each sequential `await` adds a full round-trip. Fire independent work together.

```ts
// ❌ sequential — second waits on the first for no reason
const tracks = await api('/playlists/x/')
const room = await api('/rooms/me/')
// ✅ parallel
const [tracks, room] = await Promise.all([api('/playlists/x/'), api('/rooms/me/')])
```

In our stack the waterfalls to watch are:
- **In a `queryFn`** that makes >1 call → `Promise.all`. Never `await` unrelated calls in series.
- **Fetch-on-arrival** → prefer a TanStack Router **`loader`** over `useEffect`; the router can run loaders in parallel with rendering (and preloads on intent — see §3).
- **Across hooks** — independent `useQuery`s already run in parallel; a *dependent* query uses `skipToken` until its input is ready (see `frontend-state-management`), it doesn't manually chain awaits.
- The backend owns its own query parallelism (DRF) — don't push N+1s to the client to "parallelize."

## 2. Code-splitting & bundle size — CRITICAL

The router plugin (`autoCodeSplitting: true`) already splits **per route**, and pulls heavy deps (the markdown renderer) into their own chunks. Today: ~693 KB raw / ~222 KB gzipped, well inside budget; `vite.config.ts` keeps a 1 MB raw warning as a tripwire.

- **Heavy, rarely-used components** (charts, editors, the markdown viewer) → `React.lazy(() => import(...))` + `<Suspense fallback>`. (No `next/dynamic` here.)
- **Inspect the bundle** by reading `vite build`'s per-chunk output, or add `rollup-plugin-visualizer` temporarily. (No `@next/bundle-analyzer`.)
- **Tree-shake imports** — named imports only:
  ```ts
  import { Search, Plus } from 'lucide-react'   // ✅ tree-shaken
  import * as Icons from 'lucide-react'          // ❌ pulls everything
  ```
- **Defer non-critical third-party libs** to after first render (dynamic `import()` in an effect).
- A new **eagerly-imported** heavy dep is the usual cause of regressions — lazy-load it or confirm it chunks.

## 3. Data fetching — MEDIUM-HIGH

- **TanStack Query dedupes** — multiple components calling the same `useQuery` hook share one request + cache entry. Don't lift fetching to a parent to "avoid duplicate calls."
- **Stale-while-revalidate** — `staleTime` (fresh window) is 2 min by default (`client.ts`); raise for rarely-changing data, lower for near-real-time. `gcTime` controls memory retention.
- **Preload on intent** — `defaultPreload: 'intent'` already preloads routes on hover/touch. For data, prefetch on hover:
  ```tsx
  <Link to="/playlists/$playlistId" params={{ playlistId: id }}
        onMouseEnter={() => queryClient.prefetchQuery({ queryKey: playlistKeys.detail(id), queryFn })} />
  ```
- **Don't hand-add `visibilitychange`/`online` refetch listeners** — use `refetchOnWindowFocus` / `refetchOnReconnect`. Don't poll with `setInterval` — use `refetchInterval`.
- **Passive scroll listeners** when you must listen: `addEventListener('scroll', h, { passive: true })`.

## 4. Re-render optimization — MEDIUM

(With the compiler, this is mostly "don't manufacture re-renders.")

- **Derive during render**, don't `useState` + `useEffect`:
  ```tsx
  const filtered = items.filter((i) => i.status === status)   // ✅
  ```
- **Subscribe narrowly** — `useStore((s) => s.activeTab)`, React Query `select`, not the whole store/object.
- **Functional `setState`** (`setX(prev => …)`) and **lazy init** (`useState(() => expensive())`).
- **`useDeferredValue` / `useTransition`** for non-urgent updates (e.g. filtering a list while typing) to keep input responsive.
- **`useRef` for transient values** that change but shouldn't render.
- **Extract non-primitive default values to module constants** so identity is stable.

## 5. Rendering & JS micro-perf — MEDIUM / LOW

- **Hoist static JSX** outside the component if it doesn't depend on props/state.
- **Explicit conditional rendering** (`{cond && <X/>}`) over `display:none` toggling.
- **Build `Map`/`Set` for repeated lookups** (O(1) vs `.find()` O(n) each render).
- **Single pass** over arrays instead of chained `.filter().map().sort()` when hot.
- **`toSorted()` / `toReversed()`** (immutable) over `sort()`/`reverse()` — mutating is a Rules-of-React violation the compiler punishes (we already use `[...history].reverse()` patterns — prefer `toReversed()`).
- **Hoist `RegExp` creation** out of loops/render.
- **Avoid layout thrashing** — batch DOM reads then writes.

## 6. Advanced — LOW

- **Initialize once**, not per mount (module-level guard, or do it in `main.tsx` like `applyInitialTheme()`).
- **`useEffectEvent`** (React 19) for a callback that reads latest state without being a dependency.

## Images

We **don't store or serve images** (only `video_id` references; audio is proxied). If images appear later: plain `<img loading="lazy">` with explicit `width`/`height` to avoid layout shift (CLS). There is no `next/image`.

## Monitoring

- Render errors bubble to **`RootErrorBoundary`** (`src/components/layout/`). `@sentry/react` is planned (`docs/frontend.md`) but **not yet installed** — when it lands, its console integration captures errors without a direct import.
- Use **React DevTools Profiler** to find unnecessary re-renders. `web-vitals` isn't installed; add it if you need field LCP/INP/CLS numbers. Targets: LCP < 2.5s, INP < 200ms, CLS < 0.1.
