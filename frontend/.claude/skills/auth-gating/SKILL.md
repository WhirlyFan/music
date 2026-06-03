---
name: frontend-auth-gating
description: How route protection works in this Vite + TanStack Router app — the __root.tsx beforeLoad verified-email gate, the allauth session/email queries it reads, the api client's 403 handling, and the rule that frontend gating is UX only (the Django backend is the real authorization boundary). Use when adding public/protected routes, debugging auth redirects, or reasoning about access control.
---

# Frontend Auth Gating

**There is no middleware/proxy here.** This is a Vite SPA — auth gating is client-side UX in TanStack Router, and the **real authorization is the Django backend** (DRF `IsAuthenticated` + row-level security). The frontend gate just avoids showing pages a user can't use; it is never the security boundary.

## The gate — `src/routes/__root.tsx` `beforeLoad`

Runs before every navigation (cheap — both queries are cached 5 min):

1. If the path starts with a `VERIFY_EXEMPT_PREFIXES` entry (`/login`, `/signup`, `/account/verify-email`, `/account/logout`, `/docs`) → allow through. These mirror the backend's `_VERIFIED_EMAIL_EXEMPT_PREFIXES` in `apps/core/middleware.py` — **keep the two lists in sync.**
2. Fetch the allauth session (`sessionKeys`, via `auth.session()`). Not authenticated → return (let the route render; downstream handles login).
3. Authenticated → fetch the email list (`emailKeys`); if no verified primary email → `throw redirect({ to: '/account/verify-email' })`.

allauth's session response doesn't expose verification status, so we read `/account/email` — same source of truth as the backend's `RequireVerifiedEmailMiddleware`. Both queries are reset by login/signup/logout/verify mutations, so navigation usually costs zero network.

## Belt-and-suspenders — `src/lib/api/client.ts`

The fetch wrapper hard-redirects to `/account/verify-email` on a `403 { detail: 'email_verification_required' }`. This catches the edge case where a previously-verified session is unverified mid-session (e.g. admin action) — the root guard catches the load-time case.

## Adding routes

- **Public route** (reachable while logged-out or unverified): add its prefix to `VERIFY_EXEMPT_PREFIXES` **and** the backend's exempt list.
- **Authenticated route:** nothing to do — the gate covers everything not exempt. The route's data still comes from authed API calls, so an unauthenticated user gets 401s and the UI shows the empty/login state.

## The rule

Frontend gating is **UX, not authorization.** Per-resource access ("user A can see playlist X") and "is this user authenticated at all" are answered by the backend on every request (DRF permissions + RLS). Never rely on a hidden route or a `beforeLoad` check to protect data — always confirm the endpoint enforces it server-side.

## References

- TanStack Router [`beforeLoad`](https://tanstack.com/router/latest/docs/framework/react/guide/route-loading) / [authenticated routes](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes)
- allauth browser session endpoints (`/_allauth/browser/v1/auth/session`, `/account/email`)
- Backend mirror: `apps/core/middleware.py` (`RequireVerifiedEmailMiddleware`, `_VERIFIED_EMAIL_EXEMPT_PREFIXES`)
