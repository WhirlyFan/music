---
name: frontend-conventions
description: Core conventions for this Vite + React 19 frontend — import aliases, the tool-per-lane stack table, dependency pinning, lint discipline, the React Compiler rules, and error-handling principles. Use for any general frontend work; links out to the focused frontend-* skills.
---

# Frontend Conventions

Core quick-reference for the **Vite + React 19** frontend (`frontend/`). Not Next.js — no `app/` dir, server components, API routes, or `next.config`. Data comes from the Django backend via the typed API client. The authoritative stack + file-layout reference is **`docs/frontend.md`** — align with it.

## Related skills

- `frontend-routing-and-layouts` — TanStack Router file routes, `__root.tsx`, params/search, `routeTree.gen.ts`
- `frontend-auth-gating` — the `__root` verified-email gate + the rule that the backend is the real authz boundary
- `frontend-state-management` — TanStack Query (server state), `useState`, Zustand (sparingly), TanStack Form + Zod
- `frontend-component-design` — shadcn/ui, CVA variants, `cn()`, data attributes
- `frontend-motion` — motion philosophy + tokens (HeroUI cadence, no animation lib)
- `frontend-composition`, `frontend-accessibility`, `frontend-performance` — as named

## Import rules

- Always use the `@/*` alias — never relative `../`. **`@/*` maps to `frontend/src/*`** (see `tsconfig.app.json` / `vite.config.ts`).
- Examples: `@/components/ui/button`, `@/lib/query/rooms`, `@/lib/auth/hooks`.

## The stack — each tool owns its lane

| Concern | Tool | Notes |
| --- | --- | --- |
| Server/API data | TanStack Query (`useQuery`) | Cached, deduped; keys in `src/lib/query/keys.ts` |
| URL state (tabs, filters) | TanStack Router search params (`validateSearch` + `Route.useSearch()`) | `nuqs` is a documented *future* option (`docs/frontend.md`), not installed |
| Shared client state | Zustand | Used **sparingly** — only the theme + overlay stores today |
| Local UI state | `useState` | Scoped to one component |
| Forms + validation | TanStack Form + Zod | See `frontend-forms` |
| Ephemeral overlays | `overlay.open()` (`@/lib/overlay`) | Imperative; renderer mounted in `main.tsx` |
| Styled markup | shadcn/ui (`components/ui/`) | HTML + Tailwind; you own the code |
| Variant logic | CVA | No raw Tailwind for primitives |
| Class merging | `cn()` = `twMerge(clsx(...))` | Always wrap so consumer overrides win |
| User-facing errors | `sonner` (`toast.error(...)`) | Render errors bubble to `RootErrorBoundary`; `@sentry/react` is planned (docs) but not yet installed — no PostHog |
| Motion | CSS + `--ease-*` / `animate-*` tokens | No `framer-motion`. See `frontend-motion` |

The API client (`@/lib/api/client.ts`) throws `ApiError` on non-2xx; types are generated from the backend OpenAPI schema via `pnpm gen:api` — **don't hand-edit `src/lib/api/types.ts`**.

## Dependencies — pinned (supply-chain)

Direct deps in `package.json` are **exact-pinned** (no `^`/`~`). `.npmrc` sets `save-exact=true` (so `pnpm add` writes exact) and `minimum-release-age=7d` (won't install a release younger than 7 days — defends against a freshly-published compromised version). The lockfile pins the full transitive tree with integrity hashes; **CI, Dockerfile, and `render.yaml` all install with `--frozen-lockfile`**. To bump a dep, change it deliberately and commit the lockfile.

## Lint discipline

`.githooks/pre-push` runs ESLint + `tsc` on push. **Fix every lint error in files you touch, even pre-existing ones** — and fix the underlying issue, don't silence it (`// eslint-disable`, `_`-prefix, `?? ''`). `no-console` is an **error** — surface problems to the user via a `toast` and let real errors throw (uncaught render errors hit `RootErrorBoundary`).

## React Compiler (enabled)

`babel-plugin-react-compiler` runs at build (lint: `eslint-plugin-react-compiler`). It auto-memoizes, so:

- **Don't write `useMemo` / `useCallback` / `React.memo`** — the compiler handles it. (`useEffect` deps are still required — effects aren't memoization.)
- **Follow the Rules of React** or the compiler bails (and the lint errors): no mutation during render, no reading refs in the component body, no side effects in render. Disabling a react-hooks lint to "fix" something triggers the `react-compiler` error — restructure instead.

## Error-handling principles

1. **Fix at the root, not the callee** — bad input → fix the caller; don't add masking fallbacks.
2. **Fail fast, fail loud** — let errors throw/propagate so React Query's `error`/`isError` works; a visible failure beats a hidden one.
3. **No silent fallbacks** — never `?? ''` / `?? 0` / `!` to dodge a missing required value; guard and fail. Fallback display values belong in the UI layer.
4. **Nullable query params:** use `@tanstack/react-query`'s `skipToken` (not `enabled:false` + `!`), so TS narrows the type in the active branch.
5. **User-facing failures** → `toast.error(...)` with a clear message (e.g. the player's "No YouTube match — skipping").

## Security basics

- **URL checks:** never `.includes('domain')` on raw URLs — use `new URL(url).hostname` + `.endsWith('.domain')`, in try/catch for untrusted input.
- **Email domain:** `email.split('@')[1]?.endsWith('domain')`, not `.includes`.
- Remember the real boundary is the backend (DRF permissions + RLS); frontend checks are UX.

## File organization

```
src/lib/query/    # TanStack Query hooks + keys.ts + client.ts (API)
src/lib/api/      # fetch client + generated types (gen:api)
src/lib/auth/     # allauth session/email hooks
src/lib/overlay/  # imperative overlay system (Zustand-backed)
src/components/ui/        # shadcn primitives
src/components/<feature>/ # composed components (layout, player, …)
src/routes/       # TanStack Router file routes
```
