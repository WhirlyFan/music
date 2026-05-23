---
name: frontend-conventions
description: Core frontend conventions for the Next.js app. Covers import rules, tool responsibilities, quick decision tables for choosing the right tool (React Query vs Zustand vs nuqs vs useState), and links to other frontend-* skills. Use for any general frontend work.
---

# Frontend Conventions

Core conventions and quick-reference for the Next.js frontend (`frontend/`).

## Related Skills

- `frontend-routing-and-layouts` — App Router conventions: route groups, nested layouts, special files, typed route helpers, server/client layout split, active-segment detection, Suspense-in-layout
- `frontend-proxy` — `proxy.ts` auth gate: session refresh, public-path allowlist, deny-by-default, role checks, matcher foot-guns, API-401-vs-page-307 rule
- `frontend-state-management` — React Query, Zustand, nuqs, broadcast, forms, TanStack Virtual
- `frontend-component-design` — shadcn/ui, CVA variants, DataTable, virtualization, data attributes
- `frontend-motion` — Motion tokens (2 easings, 3 durations), no framer-motion, reduced-motion handling, `@starting-style`
- `frontend-composition` — Compound components, asChild/polymorphism, React 19 APIs, TypeScript patterns
- `frontend-accessibility` — ARIA, keyboard nav, focus management, component patterns
- `frontend-performance` — Async waterfalls, bundle optimization, re-render prevention, JS performance
- `frontend-documentation` — Internal component documentation standards

## Linting

Pre-push hooks run ESLint and TypeScript checks on changed files. **Always fix all lint errors in files you touch before pushing — even if the errors are pre-existing.** The hook blocks the push regardless of who introduced the error. When fixing, make real fixes that address the underlying issue — don't just silence the linter with `_` prefixes, `// eslint-disable`, or other workarounds.

## Dependencies

Dependencies in `frontend/package.json` are **exact-pinned** — no `^` or `~` prefixes. `frontend/.npmrc` sets `save-exact=true` so `pnpm add <pkg>` writes the exact version. Upgrades come in via Dependabot PRs (grouped by react/next/typescript/linting to keep noise tractable); review and merge those rather than running `pnpm update`. CI must always install with `--frozen-lockfile`. Context: ENG-2436 (supply-chain hardening after the 2026-05-11 `@tanstack/router*` incident).

## Import Rules

- Always use `@/*` path aliases — never relative imports (`./`, `../`)
- `@/*` maps to `frontend/*` (project root)
- Examples: `@/components/ui/button`, `@/lib/hooks/queries/useInboxRecommendations`, `@/lib/stores/useInboxStore`

## The Stack — Each Tool Owns Its Lane

| Concern | Tool | Notes |
|---|---|---|
| API/server data | TanStack Query (`useQuery`) | Cached, deduped, auto-refetched |
| URL-persisted state (tabs, filters, sort, pagination) | nuqs (`useQueryState`) | Shareable, bookmarkable |
| Shared client state (not URL-worthy) | Zustand store | Import directly, no prop drilling |
| Ephemeral local state (hover, focus) | `useState` | Scoped to one component |
| Form state + validation | TanStack Form + Zod | Schema-driven, type-safe |
| Styled markup | shadcn/ui (`components/ui/`) | HTML + Tailwind. No logic. You own the code. |
| Variant logic | CVA (`class-variance-authority`) | Predefined style props. No raw Tailwind for primitives. |
| Class merging | `cn()` = `twMerge(clsx(...))` | Always wrap in `cn()` so consumer overrides win. |
| Table state | TanStack Table | Headless sorting, pagination, filtering, selection. |
| Virtualization | TanStack Virtual | Only renders visible DOM nodes for 50+ item lists. |
| Motion (transitions, indicators, fades) | CSS + `--ease-*` / `--duration-*` tokens | No `framer-motion`. See `frontend-motion`. |

## Quick Decision Table

| Data | Where | Why |
|---|---|---|
| API responses | React Query (`useQuery`) | Cached, deduped, auto-refetched |
| Active tab, sort, filter, pagination | nuqs (`useQueryState`) | URL-persisted, shareable |
| UI state not in URL | Zustand store | Shared across components |
| Ephemeral UI (hover, focus) | `useState` | Scoped to one component |
| Form input values | TanStack Form + Zod | Schema-driven validation |
| Static table display | shadcn `<Table>` | No interactivity needed |
| Table with sort/filter/paginate | `<DataTable>` (TanStack Table) | Headless state management |
| Long scrollable list (50+) | TanStack Virtual | Only renders visible DOM |
| Styled primitive | shadcn component + CVA variant | Consumer never writes raw Tailwind |

## Server-Side Prefetching

Prefetch in page.tsx to eliminate client waterfalls — but only for data that **unblocks dependent queries** or is needed for **initial visible content**. Do NOT prefetch large/slow data (blocks SSR streaming) or data behind tabs.

See `frontend-state-management` skill for full pattern and rules.

## Error Handling

### Principles

1. **Fix at the root, not the callee** — If a caller provides bad data, fix the caller. Never add defensive fallbacks in the callee that mask the real bug.
2. **Fail fast, fail loudly** — Errors should surface immediately, not be silently swallowed. A visible crash is better than a hidden bug that corrupts data or produces wrong results.
3. **No silent fallbacks** — Don't add "fallback" code paths that hide upstream bugs. If `workspaceId` is required and missing, throw or log an error — don't query without it.
4. **Always capture errors via PostHog** — All errors must be sent to PostHog for triage. Never use `console.error` — it's not captured and violates `no-console`.

   **Server-side (API routes):**
   ```typescript
   import { getDistinctIdFromRequest, getPostHogServer } from '@/src/lib/posthog-server';

   const posthog = getPostHogServer(); // module-level — singleton, one instance per process

   export async function POST(request: NextRequest) {
     try {
       // ...
     } catch (error) {
       const distinctId = getDistinctIdFromRequest(request);
       posthog.captureException(error instanceof Error ? error : new Error(String(error)), distinctId);
       return NextResponse.json({ error: 'Failed' }, { status: 500 });
     }
   }
   ```

   **Client-side (components, hooks):**
   ```typescript
   import posthog from 'posthog-js';

   posthog.captureException(error, { source: 'descriptive_label' });
   ```

   **Rules:**
   - Initialize the server client at **module level** (`const posthog = getPostHogServer()`), not inline per call
   - Always pass `distinctId` from `getDistinctIdFromRequest(request)` so errors are tied to the user in PostHog
   - Client-side always include a `source` label for triage context
   - `getPostHogServer()` returns a singleton from `@/src/lib/posthog-server` (`posthog-node`) — safe to call at module level
   - `getDistinctIdFromRequest()` extracts the PostHog `distinct_id` from the request cookie — returns `undefined` if not found
5. **Graceful degradation only at boundaries** — Server layouts that prefetch data should wrap in try/catch and degrade (e.g., show public view) rather than crash the page with a 500. But within a prefetch function, individual query failures should be logged, not swallowed.

### React Query error handling

- **`Promise.allSettled`** for server-side prefetch — individual queries can fail without killing the entire prefetch. Log failures, return null/defaults for failed fields.
- **`Promise.all`** for client-side queryFn when all data is required — if any query fails, the whole query errors and React Query shows the error state.
- **Never catch and silently return empty data** in a queryFn — let the error propagate so React Query's `error` / `isError` state works. Consumers should handle error states.

### React Query nullable parameters — use `skipToken`, not assertions

When a hook accepts a nullable parameter (e.g. `workspaceId: string | null`) but the queryFn needs it non-null, use `skipToken` with a ternary. TypeScript narrows the type naturally in the truthy branch — no `!`, no `as`, no `?? ''`.

```typescript
import { skipToken, useQuery } from '@tanstack/react-query';

// GOOD — skipToken disables the query, ternary narrows workspaceId to string
export function useTrackedStatus(nodeId: string, workspaceId: string | null) {
  return useQuery({
    queryKey: keys.tracked(nodeId, workspaceId),
    queryFn: workspaceId
      ? async () => {
          // TypeScript knows workspaceId is string here
          const { data } = await supabase
            .from('table')
            .eq('workspace_id', workspaceId)
            .single();
          return data;
        }
      : skipToken,
  });
}

// BAD — non-null assertion hides the problem
queryKey: keys.tracked(nodeId, workspaceId!),
queryFn: async () => { ... },
enabled: !!workspaceId,

// BAD — ?? '' creates a semantically wrong query key
queryKey: keys.tracked(nodeId, workspaceId ?? ''),
```

**Rules:**
- Query key factories should accept `string | null` when callers pass nullable values — don't force callers to cast
- `skipToken` replaces `enabled: false` and gives TypeScript proper narrowing
- For mutations with nullable params, guard with `if (!param) throw new Error('...')` at the top of `mutationFn` — fail fast, don't cast

### Supabase query patterns

```typescript
// Good — log the error, return null to signal failure
const { data, error } = await supabase.from("table").select("*").eq("id", id).single();
if (error) {
  console.error("[functionName] query failed:", error);
  return null;
}

// Bad — silently swallow error, return empty data that looks like success
const { data } = await supabase.from("table").select("*").eq("id", id).single();
return data ?? {};  // caller can't distinguish "no data" from "query failed"
```

### Nullable parameters in `.eq()` — guard before, never fallback inside

```typescript
// GOOD — guard before the query, fail fast if required param is missing
if (!profile?.team_id) return null; // or redirect, or return error response
const { data } = await supabase.from("teams").select("*").eq("id", profile.team_id);

// BAD — ?? '' silently queries WHERE id = '' → returns 0 rows, hides the bug
const { data } = await supabase.from("teams").select("*").eq("id", profile?.team_id ?? '');

// BAD — ! assertion crashes at runtime if value is actually null
const { data } = await supabase.from("teams").select("*").eq("id", profile?.team_id!);

// For optional IDs in loops (e.g. after insert returns ids):
for (const item of items) {
  if (item.id == null) continue; // skip items without IDs
  await supabase.from("table").update(data).eq("id", item.id);
}
```

**Rule**: Never use `?? ''`, `?? 0`, or `!` inside `.eq()`, `.in()`, `.neq()`, or any Supabase filter method. Always validate the value exists BEFORE constructing the query.

### Nullability in types — match the data source, don't convert

```typescript
// GOOD — type matches what the DB actually returns
interface Campaign {
  project_id: number | null;  // DB column is nullable → use | null
}
// Consumer reads it directly:
setRetryingCampaign({ focusAreaId: campaign.project_id }); // null is valid

// BAD — converting null → undefined to satisfy a lying type
interface RetryState {
  focusAreaId?: number;  // pretends null doesn't exist
}
setRetryingCampaign({ focusAreaId: campaign.project_id ?? undefined }); // hides the null
```

**Rules:**
- **`T | null`** — use for DB/API response fields that are present but may have no value. This is the truth about the data.
- **`T?` (optional)** — use only for fields that may genuinely not exist on the object (e.g. enrichment fields added conditionally, config options with defaults).
- **Never `?? undefined`** — if you need this, the receiving type is wrong. Fix the type to accept `null`, don't convert at the call site.
- **Never `?? ''` or `?? 0` to satisfy types** — same principle. If the data is null, the type should say so. Fallback values belong in the UI layer (display logic), not in data passing.

### Server component / layout patterns

```typescript
// Good — try/catch at the layout boundary, degrade gracefully
let userData = null;
try {
  userData = await getCachedUserData();
} catch (e) {
  console.error("[dashboard layout] prefetchUserData failed:", e);
}
// Continue with userData possibly null — renders public view

// Bad — no error handling, layout crashes with 500
const userData = await getCachedUserData(); // throws → 500 page
```

### Anti-patterns

- `.eq('id', value ?? '')` or `.eq('id', value!)` — guard BEFORE the query, not inside filter methods
- `?? undefined` to convert null to undefined — fix the receiving type to accept `| null` instead
- `Number(param)` repeated inside a hook — convert once at the call site, type the hook param correctly
- Bare `string` for DB columns with fixed values — use string literal unions (`'relevant' | 'exact'`) for compile-time safety
- `as any` or `as unknown as T` to suppress Supabase type errors — fix the interface or use `.overrideTypes<T>()` instead
- `?? ''` to satisfy types — only valid at DB insert boundaries for NOT NULL columns (add a comment explaining why)
- Fallback queries that hide missing required parameters (see CLAUDE.md "Fallbacks" section)
- `catch(() => {})` anywhere — always send errors to PostHog (client: `posthog.captureException(err, { source: 'label' })`, server: `getPostHogServer().captureException(err)`)
- `console.error` in API routes or client code — use PostHog instead (`no-console` lint rule enforced)
- Returning `{}` or `[]` from a failed fetch without logging — makes debugging impossible
- Swallowing errors in mutations — the user should know their action failed

## Pre-Push Linting

The `.githooks/pre-push` hook auto-lints all changed files on push (ESLint + tsc for frontend, ruff for Python). If a developer asks to skip linting on specific files, use the `LINT_SKIP` env var with a regex pattern:

```bash
# Skip specific files (regex matched against file paths)
LINT_SKIP="ActiveInboxContent|SomeLegacyFile" git push

# Skip all linting entirely
git push --no-verify
```

**Note:** `LINT_SKIP` only skips files from ESLint and ruff. The TypeScript type-check (`tsc --noEmit`) runs on the full project and cannot be scoped to individual files. To skip tsc as well, use `--no-verify`.

## Security Conventions

1. **URL domain checks** — Never use `.includes('domain')` on raw URL strings. Use `new URL(url).hostname` and check with `.endsWith('.domain')` or exact match. Wrap in try/catch for untrusted input.
2. **Email domain checks** — Never use `.includes('domain')` on email strings. Extract the domain after `@`: `email.split('@')[1]?.endsWith('domain')`.
3. **No debug console.logs in production** — Remove `console.log` statements used for debugging before merging. Use structured logging or conditional dev-only logging.

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
frontend/components/
  ui/                # Atomic shadcn primitives (generic building blocks only)
  data-tables/       # TanStack Table infrastructure
  [feature]/         # Domain-specific composed components
frontend/src/app/api/_lib/
  broadcast.ts       # Central broadcast utility for cross-client invalidation
```

## React Compiler (Enabled)

The React Compiler is enabled globally (`reactCompiler: true` in `next.config.mjs`). It auto-memoizes components, hooks, and expressions at build time.

### What this means for new code

- **Do NOT write `useMemo`, `useCallback`, or `React.memo`** — the compiler handles memoization automatically
- **Do NOT write manual dependency arrays for memoization** — the compiler understands data flow
- You still need `useEffect` dependency arrays (effects are not memoization)

### Rules of React (strictly enforced by compiler)

1. **Never mutate during render** — no `.push()`, `.splice()`, `.pop()`, `delete`, or `obj.key = val` on arrays/objects during render. Always use immutable operations (`.filter()`, `.map()`, spread, `.slice()`)
2. **Never read refs during render** — `ref.current` must only be read inside `useEffect` or event handlers, never in the component body. If you need a value during render, use `useState`
3. **No side effects during render** — no API calls, DOM manipulation, or logging in the component body
4. **No module-level mutable state read during render** — if a file uses `let` at module scope that's mutated and read during render, add `"use no memo"` at the top of the file

### Opting out

If a component breaks with the compiler, add this directive at the top:

```typescript
export default function BrokenComponent() {
  'use no memo'
  // ...
}
```

### Files currently opted out

- `components/ui/use-toast.tsx` — module-level mutable state (shadcn default pattern)
