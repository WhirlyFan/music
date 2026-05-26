---
name: frontend-react-effects
description: Decide when `useEffect` is the right tool. Use whenever writing or reviewing one.
---

# React Effects

`useEffect` is for synchronizing with **external systems** (network, browser APIs, third-party widgets, the DOM). Anything else has a better tool.

## Decision tree

```
Is this synchronizing with an external system?
├─ YES → useEffect. See "What counts as external" below.
│
└─ NO → pick the right tool:
    │
    ├─ Transforming data for render (filter/sort/map/group) ─→ inline at top of render
    ├─ "Expensive" calculation                                ─→ inline at top of render
    ├─ User event (click/submit/keypress)                     ─→ event handler
    ├─ Resetting child state when a prop changes              ─→ <Child key={...} />
    ├─ Adjusting state from a prop                            ─→ inline; it's not state
    ├─ Notifying a parent of a change                         ─→ call callback in handler
    ├─ Subscribing to a shared app store                      ─→ Zustand
    ├─ Subscribing to a raw browser/DOM store                 ─→ useSyncExternalStore
    └─ Fetching data                                          ─→ useQuery
```

The default for any in-render computation is **write it inline, no `useMemo`**. The React Compiler memoizes for you. `useMemo` / `useCallback` / `React.memo` are off-limits per `CLAUDE.md` "React Compiler". Three rare exceptions: file has `'use no memo'`, value goes into an effect dep array and needs stable identity, or profiler shows real cost.

## What counts as external

| External system                             | Pattern                                               | Where to find it                 |
| ------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| Supabase realtime broadcast                 | `.channel(...).subscribe()` + `removeChannel` cleanup | grep `supabase.channel(`         |
| PostHog one-shot capture on mount           | `posthog.capture(...)` with empty deps                | analytics hooks                  |
| DOM measurement after render                | `ref.current.getBoundingClientRect()`                 | virtualizer, popover positioning |
| Window/document event listeners             | `keydown`, `resize`, `visibilitychange`               | grep `window.addEventListener`   |
| Focus management                            | `inputRef.current?.focus()`                           | dialog open → focus first field  |
| Third-party widget setup/teardown           | imperative library APIs (Mapbox, Stripe Elements)     | rare                             |
| Syncing imperative non-React state to React | no React API for it                                   | rare; usually a smell            |

If "what external system?" answers as "the rest of the app" / "the URL" / "the cache", it's not external — go back to the decision tree.

## React Compiler rules (apply everywhere, especially in effects)

- No `useMemo` / `useCallback` / `React.memo` — compiler handles memoization.
- No mutation during render — no `.push`, `.splice`, `.pop`, `delete`, `ref.current = ...`. Use `.filter`, `.map`, spread, `.toSorted`.
- No `ref.current` reads during render — only in effects or event handlers. If needed during render, use `useState`.
- `'use no memo'` opts one file out — use only when the compiler is provably the problem.

Consequence: `useEffect(() => setX(deriveFromY(y)), [y])` has zero valid uses here. Compute `x` inline.

## Anti-patterns

| Anti-pattern                                                            | Replace with                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `useEffect` + `setState` from props/state                               | Inline computation                                     |
| `useEffect` to filter/sort/group                                        | Inline computation                                     |
| `useEffect` for click/submit handlers                                   | Event handler                                          |
| `useEffect` calling `onChange`/`onSelect` to notify parent              | Call callback in the handler that caused the change    |
| `useEffect` with empty deps to "init" data                              | React Query, server prefetch, or module-level constant |
| `useEffect(() => fetch(...).then(setData), [])`                         | `useQuery`                                             |
| `useEffect` mirroring URL params into local state                       | Read nuqs directly                                     |
| `useEffect` mirroring server state into Zustand                         | Read React Query directly                              |
| `useEffect(() => { ref.current = ... })` to read during render          | `useState`                                             |
| `useEffect` resetting child state on prop change                        | `<Child key={...} />`                                  |
| `useEffect` + `setInterval` polling server                              | `refetchInterval` on the query                         |
| `useEffect` adding `visibilitychange`/`online` listeners to refetch     | `refetchOnWindowFocus` / `refetchOnReconnect`          |
| `useEffect` syncing query string with `useSearchParams` + `router.push` | nuqs                                                   |

## Cleanup

Every effect that subscribes, listens, sets a timer, or starts a fetch returns a cleanup. It runs before the next effect, on unmount, and twice in dev under Strict Mode (the second run surfaces missing cleanups as bugs).

```typescript
useEffect(() => {
  const channel = supabase.channel(name).subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}, [name])
```

Non-React Query fetches need an `ignore` flag in cleanup to avoid race conditions on rapid prop changes.

## Pre-commit checklist

1. Names a real external system (network / browser API / DOM / third-party).
2. Has a cleanup function, or a one-line comment saying why none is needed.
3. Dependency array is exhaustive.
4. Doesn't `setState` from other state/props.
5. Doesn't fetch data.
6. Doesn't mirror URL or server state.

If any fails, the effect is wrong.

## See also

- `frontend-state-management` — React Query, Zustand, nuqs.
- `frontend-performance` — what to consider once an effect is justified.
- `CLAUDE.md` § "React Compiler (Enabled)" — authoritative compiler rules.
