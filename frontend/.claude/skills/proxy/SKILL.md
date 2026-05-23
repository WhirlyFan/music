---
name: frontend-proxy
description: The `proxy.ts` auth gate for the Next.js frontend — Next.js 16's renamed middleware, the order of operations in this repo's proxy (session refresh → public-path allowlist → deny-by-default → role checks), cookie handling, JWT validation via getClaims, the API-JSON-401-vs-page-307 rule, matcher anchoring foot-guns, and when *not* to rely on proxy for authorization. Use when editing `frontend/src/proxy.ts`, adding public routes, adding role-gated routes, debugging auth redirects, or migrating middleware patterns.
---

# Frontend Proxy (Auth Gate)

`frontend/src/proxy.ts` is the single server-side chokepoint that runs before every non-static request. In this repo it does four things: refresh the Supabase session, allow public paths through, reject unauthenticated requests, and do role checks for admin routes.

This skill covers what the file is, what it's allowed to do, what it must *not* be the only place checking, and the conventions for editing it safely.

## Related Skills

- `frontend-conventions` — error handling, PostHog capture (the proxy catches throw errors and returns JSON/redirects — no PostHog capture today; any logging improvements go through `getPostHogServer`)
- `frontend-routing-and-layouts` — layouts read session data *after* proxy has run; layouts are not a security boundary
- `frontend-state-management` — the `useUser()` / `useWorkspace()` React Query hooks read the authenticated session that proxy has refreshed

---

## 1. What `proxy.ts` is (and why it's not called `middleware.ts`)

Next.js 16 deprecated `middleware.ts` and renamed the file convention to `proxy.ts`. [Next.js renamed it](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) to make the mental model clearer: the file runs as a network-boundary proxy in front of the app, defaults to the Node.js runtime in v16, and is intentionally kept small.

This repo is on Next.js 16 and already uses `proxy.ts`. Never revert to `middleware.ts` — the file name is the convention.

### What proxy can do

- **Rewrite** a request to a different route (`NextResponse.rewrite`)
- **Redirect** to a different URL (`NextResponse.redirect`)
- **Respond directly** with JSON or HTML (`Response.json`, `NextResponse.json`, `Response`)
- **Set request / response headers and cookies**
- **Refresh Supabase session cookies** (this is what `updateSession()` does — `Set-Cookie` on the response)

### What proxy must NOT do

- **Be the only place you check authorization.** Next.js explicitly warns that proxy may run on a CDN edge, that matchers can regress silently, and that Server Functions (`'use server'`) are not separate routes in the execution chain — a matcher change or a Server Function move can drop proxy coverage. **Always verify auth inside each Server Component prefetch, Route Handler, and Server Function** as defense-in-depth. Proxy is the first gate, not the last.
- **Share modules or globals** across requests. Proxy is optimized to be deployable to the CDN; treat it as stateless. No module-level caches, no singletons you mutate.
- **Call heavy work.** Every non-static request in the whole app is going through this file. Sub-millisecond operations only. `getClaims()` (local JWT validation via cached JWKS) is fine; a full DB query on every request is not.
- **Set the `runtime` config.** Next.js 16 proxy does not accept `runtime` — it defaults to Node and throws if you try to force it.
- **Skip hooks, sign bypass, or use `--no-verify`.** Standard guardrails apply.

---

## 2. How this repo's proxy flows

```
1️⃣ updateSession(request)
     ↳ getClaims() — local JWT validation via JWKS (sub-ms, no network)
     ↳ If expired, fall back to getUser() to refresh
     ↳ Returns { response, user, supabase } — a response with refreshed cookies,
       a minimal user identity, and the authenticated client

2️⃣ Legacy /dashboard/* redirects — early 301

3️⃣ Public path allowlist (PUBLIC_PATH_PREFIXES) — return response, done

4️⃣ Deny-by-default if !user
     ↳ /api/*  → NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
     ↳ pages   → NextResponse.redirect('/login', 307)

5️⃣ Role checks
     ↳ /api/admin/*            → is_super_admin RPC, 403 JSON if not
     ↳ /workspaces/admin/...   → is_super_admin RPC, redirect '/workspaces' if not

6️⃣ Return response (carries refreshed Set-Cookie from step 1)
```

**Ordering matters.** Session refresh is first so all downstream steps see the fresh user. Public paths run before the deny-by-default gate so they're reachable when logged out. Legacy redirects run before public-path checks because they short-circuit to a new URL entirely.

---

## 3. Adding a new public path

Public paths live in one array and only one array:

```ts
const PUBLIC_PATH_PREFIXES = [
  '/login', '/signup', '/set-password',
  '/auth/',              // /auth/confirm, /auth/callback, /auth/sso-complete, ...
  '/oauth/consent',
  '/api/public/',
  '/docs-login', '/docs-access',
  '/opp/',               // public solicitation share links
  '/industry-days/',     // public industry day share links
];
```

### ✅ Correct: add to the array

```ts
const PUBLIC_PATH_PREFIXES = [
  // ...existing...
  '/my-new-public-route',
];
```

`isPublicPath()` matches either exact equality or `startsWith(prefix)`, so a trailing slash on the prefix restricts to children (`/auth/` matches `/auth/callback` but not `/authorize`). Pick based on intent.

### ❌ Wrong: edit the matcher

The matcher in `export const config` is a coarse inclusion filter — "run on almost everything except static files." It is **not** the public/private list. Editing the matcher to exclude a route silently bypasses *all* of proxy's logic (session refresh, role checks, legacy redirects), not just the auth gate. That's almost always a bug.

### ❌ Wrong: `startsWith('/api')` for unauth'd APIs

`/api/public/*` is the convention for public API routes. Don't mix unauthenticated endpoints into `/api/*` — the deny-by-default gate assumes `/api/*` requires a user.

### Security check after adding a public route

- Does the route leak any user-specific data? It shouldn't — public means public.
- Does the route query Supabase? Use the **anon key** with **RLS** enforced, not the service-role key.
- Is the route idempotent and safe for unauthenticated traffic? No writes except via explicit tokens.

---

## 4. Adding a role-gated route

Role checks sit *after* the deny-by-default gate, so `user` is already non-null. Reuse the `supabase` client returned by `updateSession()` — don't re-create one.

```ts
// ✅ correct — reuse the client, check the RPC, return the right error shape
if (pathname.startsWith('/api/finance/')) {
  const { data: isFinance } = await supabase.rpc('is_finance_member');
  if (!isFinance) {
    return NextResponse.json(
      { error: 'Unauthorized - requires finance role' },
      { status: 403 },
    );
  }
}
```

```ts
// ❌ wrong — creating a second client doubles the request cost and can
// get out of sync with the session refresh in step 1
const { supabase: anotherClient } = await updateSession(req);  // re-refreshes!
const { data } = await anotherClient.rpc('is_finance_member');
```

### Why reuse matters

There was a real bug in this codebase where `proxy.ts` duplicated `is_super_admin` RPC calls by not reusing the client from `updateSession()`. That bug was fixed by having `updateSession` return the supabase client. Keep it that way.

### Error shape per route type

| Route | If role check fails |
|---|---|
| `/api/*` | `NextResponse.json({ error: '...' }, { status: 403 })` |
| Page route | `NextResponse.redirect(new URL('/workspaces', url), 307)` — or `/login` if appropriate |

---

## 5. API routes return JSON, page routes redirect

The deny-by-default branch:

```ts
if (!user) {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', url), 307);
}
```

**Why this split is load-bearing:**

`fetch()` in the browser follows 307 redirects automatically. If an API route redirected to `/login`, the browser would follow, receive HTML, and the client's `response.json()` call would throw a `SyntaxError: Unexpected token <` — crashing the component that owns the call with an error message that has nothing to do with auth.

**Applies to every early exit.** If you add a new branch that returns early (role checks, rate limits, feature flags), branch on `pathname.startsWith('/api/')` first and choose the right shape. The catch block at the bottom of the proxy does this explicitly for the same reason.

---

## 6. Session refresh via `updateSession()`

The session refresh is isolated in `frontend/utils/supabase/middleware.ts` as `updateSession(request)`. Key properties:

### JWT is validated locally, not remotely

```ts
// utils/supabase/middleware.ts
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
```

`getClaims()` validates the JWT via JWKS (ES256, cached). **Sub-millisecond, no network call, no token refresh.** This matters because:

1. **No race condition with the browser client.** If middleware and the browser client both tried to refresh the same token simultaneously, Supabase's refresh-token-reuse detection would revoke the session entirely. Local validation side-steps the race.
2. **Every request is hot-path fast.** Remote validation would put every navigation on a network round-trip to Supabase.

### Three branches: valid JWT, no session, expired JWT

`getClaims()` returns one of three states. The logic has to fork on `claimsData` **first**, then on `claimsError`. Skipping the `claimsData` guard would return `user: null` for every authenticated user with a valid session.

```ts
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

if (claimsData) {
  // 1. Valid JWT — extract identity from claims (sub-ms, no network)
  const user: MiddlewareUser = {
    id: claimsData.claims.sub,
    email: claimsData.claims.email as string | undefined,
  };
  return { response, user, supabase };
}

if (!claimsError) {
  // 2. getClaims returned { data: null, error: null } — no session cookie at all (anonymous visitor)
  return { response, user: null, supabase };
}

// 3. claimsError set — JWT exists but is expired/invalid. Fall back to network refresh.
const { data } = await supabase.auth.getUser();
const user: MiddlewareUser | null = data.user
  ? { id: data.user.id, email: data.user.email }
  : null;
return { response, user, supabase };
```

The third branch only fires for returning users whose session has actually expired. No race condition because the browser client hasn't loaded yet — the page hasn't started rendering, so there's nobody to collide with on a refresh.

### Cookies

The session cookies are set inside `createServerClient`'s `setAll` callback. It:

1. Writes to `request.cookies` so downstream code in this same request sees the new value
2. Rebuilds `response = NextResponse.next({ request: { headers: request.headers } })` to propagate the updated request headers
3. Writes to `response.cookies` so the browser's `Set-Cookie` header goes out

You should not need to touch this pattern. If you do, the Supabase SSR guide has the canonical shape and this file matches it.

### Type signature — what `updateSession` returns

```ts
{
  response: NextResponse;                          // use this as the base response
  user: { id: string; email?: string } | null;    // minimal identity for auth gating
  supabase: SupabaseClient<MakeSenseDatabase>;    // reuse for role checks
}
```

Proxy code should only read `user.id` and `user.email` for auth decisions. Richer user data belongs in layouts / React Query, not the proxy — proxy runs on every request.

---

## 7. The matcher — what it matches and the foot-guns

```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|ingest(?:/|$)|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
```

**Intent:** run proxy on everything except Next internals, static assets, and the PostHog `/ingest` rewrite.

### Foot-gun: anchoring `/ingest`

The `/ingest` exclusion is anchored with `(?:/|$)` — so only `/ingest` and `/ingest/...` bypass. Without the anchor, future routes like `/ingestion` or `/ingester-admin` would **silently bypass auth**. This kind of matcher regression is the reason the Next.js docs tell you to verify auth inside each route handler too.

**Rule:** if you add an exclusion to the matcher, anchor it with `(?:/|$)` or a terminating pattern. Never add a bare prefix.

### Foot-gun: matcher exclusions are proxy-wide

Anything excluded from the matcher doesn't just skip the auth gate — it skips session refresh, legacy redirects, and role checks. That's why `/ingest` is only excluded because it's already unauthenticated telemetry rewritten to PostHog. Don't use matcher exclusions to make a route public; add it to `PUBLIC_PATH_PREFIXES` instead.

### Good to know (from Next.js docs)

- Matcher values **must be constants** — evaluated at build time. Variables are ignored.
- `_next/data` routes **always run proxy** even when excluded by pattern. This is intentional — Next.js prevents you from protecting a page while accidentally leaving its data route open.
- Server Functions (`'use server'`) run as POST requests to the page route where they're used. A matcher exclusion on that page also skips proxy for its Server Functions. **Always check auth inside Server Functions.**

---

## 8. Error handling — the catch block

```ts
} catch (e) {
  // eslint-disable-next-line no-console -- middleware has no structured logger
  console.error('[proxy] Unhandled middleware error:', e);
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  return NextResponse.redirect(new URL('/login', req.url), 307);
}
```

- **Fail-closed.** If session refresh or an RPC throws, we treat the request as unauthenticated and either return 500 JSON (API) or bounce to `/login` (pages). We do **not** swallow the error and pretend the user is authenticated.
- **The `no-console` disable is intentional.** Proxy runs before providers are mounted; the normal `getPostHogServer()` path isn't available here the same way it is in API routes. If you need structured logging, the right move is to extract a proxy-safe logger, not to plumb PostHog in.
- **The redirect targets `/login`.** That's correct for unauthenticated crashes but could loop if `/login` itself throws. Keep `/login` in `PUBLIC_PATH_PREFIXES` and keep it simple.

---

## 9. Testing the proxy

Next.js 15.1+ ships `next/experimental/testing/server` utilities. `unstable_doesProxyMatch` asserts whether proxy runs for a URL; you can also invoke the proxy function directly and assert on rewrite/redirect/response shape.

```ts
import { unstable_doesProxyMatch } from 'next/experimental/testing/server';
import { proxy, config } from '@/proxy';
import nextConfig from '../next.config.mjs';

// Matcher coverage
expect(unstable_doesProxyMatch({ config, nextConfig, url: '/ingest/e/' })).toBe(false);
expect(unstable_doesProxyMatch({ config, nextConfig, url: '/workspaces' })).toBe(true);

// Public path allowlist
const req = new NextRequest('https://x/login');
const res = await proxy(req);
expect(res.status).toBe(200);

// API 401 shape for unauth'd /api/*
const apiReq = new NextRequest('https://x/api/workspace');
const apiRes = await proxy(apiReq);
expect(apiRes.status).toBe(401);
expect(await apiRes.json()).toEqual({ error: 'Unauthorized' });
```

Any non-trivial change to `PUBLIC_PATH_PREFIXES` or the matcher should add a test. Matcher regressions are the most common class of proxy bug and they ship silently.

---

## 10. When to reach for proxy, and when not to

### Use proxy for

- **Global auth gating** — one deny-by-default rule that covers the whole app
- **Legacy URL redirects** — short-circuit before routing (`/dashboard/*` → `/*`)
- **Role-based access** that applies to whole route prefixes (e.g. `/api/admin/*`)
- **Session refresh** that must happen before every request renders

### Don't use proxy for

- **Per-resource authorization.** "User A can view workspace X" is row-level authorization that only the DB / RLS / the page's server component can answer. Proxy checks route prefixes, not resource ownership.
- **Feature flags that affect rendering.** Feature-gate inside the layout or page so React Query / PostHog client SDK is loaded. Proxy can flag-gate *access* (return 403) but not UI.
- **A/B test assignment that needs analytics identity.** Do it in a Route Handler or client-side so PostHog distinct_id is already known.
- **Expensive DB queries per request.** Use a layout's prefetch (server-component `await`) instead — that runs once per navigation into the segment, not on every asset request.
- **Anything that must run only for the HTML request, not RSC.** Next strips flight headers from `request.headers` in proxy (see below); proxy can't distinguish RSC from HTML reliably.

### The defense-in-depth rule

> Every Server Component prefetch, Route Handler, and Server Function must verify auth itself. Proxy is the first gate, not the last.

This matters because:

1. CDN caching of the proxy layer vs. the app layer can get out of sync.
2. Matcher exclusions can regress silently.
3. Server Functions run as POSTs to the page route — a matcher change or Server Function move can drop proxy coverage with no test failure.

Follow the `frontend-routing-and-layouts` §4 pattern (server-component layouts wrap client shells): the server layout does `await auth.getUser()` (or `getCachedUserData()`) before handing off to the client shell, and Route Handlers pull `user` fresh. Yes, it's duplicated with proxy. Yes, it's on purpose.

---

## 11. RSC requests and proxy

During React Server Component requests, Next strips Flight headers (`rsc`, `next-router-state-tree`, `next-router-prefetch`) from `request.headers` as seen by proxy. This is intentional — it keeps proxy from treating the RSC request differently from the HTML request, which would desync the two responses.

**Implication:** don't try to branch proxy on "is this an RSC request?" Whatever you decide for the HTML request has to hold for the RSC payload too.

`NextResponse.rewrite()` automatically re-propagates the RSC headers upstream. Custom rewrite logic with `fetch()` has to forward them manually — and if you need the raw URL shape, enable `skipProxyUrlNormalize` in `next.config.mjs`. We don't do custom rewrites today; don't introduce one without a very specific reason.

---

## 12. Execution order (where proxy sits in the pipeline)

From the Next.js docs, in order:

1. `headers` from `next.config.mjs` — CSP and security headers applied first (see `next.config.mjs`)
2. `redirects` from `next.config.mjs`
3. **Proxy** (rewrites, redirects, deny-by-default, role checks)
4. `beforeFiles` rewrites
5. Filesystem routes (`public/`, `_next/static/`, `app/`, etc.)
6. `afterFiles` rewrites — **this is where `/ingest/*` → PostHog rewrite lives**
7. Dynamic routes (`/blog/[slug]`)
8. `fallback` rewrites

**Why this matters here:** the `/ingest` matcher exclusion in proxy works with the `afterFiles` rewrite in `next.config.mjs`. Proxy skips `/ingest/*`, then the rewrite forwards `/ingest/*` to `us.i.posthog.com`. Change one without the other and you either lose events (proxy 307s them to `/login`) or leak telemetry through the app runtime.

---

## 13. Migrating from `middleware.ts` (historical)

This repo is already on `proxy.ts`. For reference: Next.js 16 renamed the convention and ships a codemod:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

The codemod renames the file and the exported function. Everything else (matcher, runtime, request/response APIs) is unchanged. If you see `middleware.ts` anywhere in this repo, rename it to `proxy.ts` — the name is the convention.

---

## 14. Anti-patterns

| Anti-pattern | Fix | See |
|---|---|---|
| Adding a public route by editing `config.matcher` to exclude it | Add to `PUBLIC_PATH_PREFIXES` | §3 |
| Re-creating a Supabase client for a role check instead of reusing the one from `updateSession` | Destructure `supabase` from `updateSession(req)` and reuse | §4 |
| `/api/*` branch returning a redirect instead of JSON | Branch on `pathname.startsWith('/api/')`, return `NextResponse.json` | §5 |
| Unanchored matcher exclusions (e.g. bare `/ingest`) | Anchor with `(?:/|$)` | §7 |
| Using `auth.getUser()` in the proxy hot path (forces a network round-trip on every request) | Rely on `getClaims()` in `updateSession`; `getUser()` is the fallback it already does | §6 |
| Only checking auth in proxy, assuming Server Components are covered | Verify auth inside each layout prefetch, Route Handler, and Server Function | §10 |
| Setting `runtime: 'edge'` or `runtime: 'nodejs'` in proxy's config | Remove it — Next.js 16 proxy rejects the option (defaults to Node) | §1 |
| Module-level caches or singletons in `proxy.ts` | Keep proxy stateless — it may run on a CDN edge | §1 |
| Swallowing errors and returning `NextResponse.next()` on failure | Fail closed — 500 JSON for `/api/*`, redirect to `/login` for pages | §8 |
| Adding new auth logic directly in `proxy.ts` instead of inside `updateSession` | If it's about the session, put it in `updateSession`; proxy is for routing decisions | §6 |
| `console.log` for proxy debugging left in | Remove before merge; `no-console` is enforced and proxy runs on every request | `frontend-conventions` |

---

## References

- [Next.js `proxy.js` API reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js `NextRequest`](https://nextjs.org/docs/app/api-reference/functions/next-request)
- [Next.js `NextResponse`](https://nextjs.org/docs/app/api-reference/functions/next-response)
- [Next.js Data Security guide](https://nextjs.org/docs/app/guides/data-security) — "authentication and authorization" patterns and the defense-in-depth rule
- [Supabase SSR — `createServerClient` with Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) — the source of `updateSession`'s cookie pattern
- `frontend/src/proxy.ts` — this repo's proxy
- `frontend/utils/supabase/middleware.ts` — `updateSession()` implementation
