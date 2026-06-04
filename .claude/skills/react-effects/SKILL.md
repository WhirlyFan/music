---
name: react-effects
description: Decide when `useEffect` is the right tool in this frontend. Use whenever writing or reviewing one. Stack is Vite + React 19 (React Compiler on) + TanStack Query + TanStack Router.
---

# React Effects

`useEffect` is for synchronizing with **external systems** (network, browser APIs,
third-party widgets, the DOM, the `<audio>` element). Anything else has a better tool.

## Decision tree

```
Is this synchronizing with an external system?
├─ YES → useEffect. See "What counts as external" below.
│
└─ NO → pick the right tool:
    ├─ Transforming data for render (filter/sort/map/group) ─→ inline at top of render
    ├─ "Expensive" calculation                              ─→ inline at top of render
    ├─ User event (click/submit/keypress)                   ─→ event handler
    ├─ Resetting child state when a prop changes            ─→ <Child key={...} />
    ├─ Adjusting state from a prop                          ─→ inline; it's not state
    ├─ Notifying a parent of a change                       ─→ call the callback in the handler
    ├─ Subscribing to a raw browser/DOM store               ─→ useSyncExternalStore
    ├─ Fetching / mutating server data                      ─→ TanStack Query (useQuery/useMutation)
    └─ Sharing UI state across components                   ─→ lift state, or a TanStack Query
                                                               UI cache key (we have no global store)
```

The default for in-render computation is **write it inline, no `useMemo`** — the
React Compiler memoizes for you (see [docs/frontend.md → React conventions](../../../docs/frontend.md)).

## What counts as external (effects ARE correct here)

| External system | Pattern |
|---|---|
| The `<audio>` element / media events | wire handlers, read/write `audioRef.current` |
| DOM measurement after render | `ResizeObserver`, `getBoundingClientRect()` |
| Intersection / scroll | `IntersectionObserver` (infinite scroll sentinel) |
| `requestAnimationFrame` loops | visualizer, the cover-wall inertia loop |
| Window/document listeners | `keydown` (Esc), `pointerdown` (click-outside) |
| Timers | the search debounce `setTimeout` |
| Focus management | `inputRef.current?.focus()` |

If "what external system?" answers as "the rest of the app" / "the cache" / "the
URL", it's **not** external — go back to the decision tree.

## React Compiler rules (the compiler is enabled; eslint enforces them)

- No `useMemo` / `useCallback` / `React.memo` — the compiler handles memoization.
  (Exceptions: a value feeds an effect dep array and needs stable identity, or a
  profile proves real cost.)
- No mutation during render — use `.map`/`.filter`/spread/`.toSorted`, not `.push`/`.splice`.
- No `ref.current` reads during render — only in effects/handlers. Need it in render? use state.
- **No module-level mutable state read during render.** A `let`/mutable object at
  module scope that's read in the component body trips the compiler — read/write it
  only inside effects/handlers (e.g. the player's `playIntent` flag).

Consequence: `useEffect(() => setX(deriveFromY(y)), [y])` has **zero** valid uses —
compute `x` inline.

## Anti-patterns → replacement

| Anti-pattern | Replace with |
|---|---|
| `useEffect` + `setState` from props/state | inline computation |
| `useEffect` to filter/sort/group | inline computation |
| `useEffect` for click/submit handling | event handler |
| `useEffect` calling a parent callback to "notify" | call it in the handler that caused the change |
| `useEffect(() => fetch().then(setData), [])` | `useQuery` |
| `useEffect` + `setInterval` polling the server | `refetchInterval` on the query |
| `useEffect` adding focus/online listeners to refetch | `refetchOnWindowFocus` / `refetchOnReconnect` |
| `useEffect` mirroring server state into local state | read the query directly (no prop-drilling) |
| `useEffect` resetting child state on prop change | `<Child key={...} />` |
| `useEffect(() => { ref.current = ... })` to read in render | `useState` |

## Cleanup

Every effect that subscribes, listens, sets a timer, observes, or starts a loop
returns a cleanup — it runs before the next effect, on unmount, and twice in dev
under StrictMode (the second run surfaces missing cleanups).

```ts
useEffect(() => {
  const io = new IntersectionObserver(cb)
  io.observe(el)
  return () => io.disconnect()
}, [el])
```

## Pre-commit checklist

1. Names a real external system (network / browser API / DOM / `<audio>` / observer).
2. Has a cleanup, or a one-line comment saying why none is needed.
3. Dependency array is exhaustive.
4. Doesn't `setState` from other state/props.
5. Doesn't fetch/mutate server data (that's TanStack Query).
6. Doesn't read module-mutable state or `ref.current` during render.

If any fails, the effect is wrong.

## State, briefly

- **Server state** (room, playlists, tracks) → TanStack Query. It's the single
  source of truth; components call the hook directly, never prop-drill it.
- **Local UI state** → `useState` (incl. the `<audio>` element's transient
  loading/playing — that's DOM state, not server state).
- **Shared UI state** across components → lift it, or a tiny TanStack Query UI cache
  key (`uiKeys`) used as a client store. We deliberately have no Zustand/Redux.
