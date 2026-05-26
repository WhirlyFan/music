# 0008 — Email verification: `optional` mode + middleware gate (not `mandatory`)

**Status:** Accepted
**Date:** 2026-05-26
**Supersedes (partially):** the earlier `mandatory` choice documented in
`auth.md` history.

## Context

allauth offers three verification modes via `ACCOUNT_EMAIL_VERIFICATION`:
`"none"`, `"optional"`, `"mandatory"`. The natural-looking pick is
`"mandatory"` — "they can't log in until they verify."

Trying that in practice surfaced several footguns:

1. **No real session until verification.** `mandatory` does not create an
   authenticated Django session at signup. allauth instead returns a 401
   response carrying a `verify_email` flow tied to the in-flight signup
   request. There's no persistent session for the user to come back to.
2. **Resend stops working if the tab closes.** `PUT /auth/email/verify`
   relies on that in-flight flow. Close the tab between signup and
   clicking the email link → the flow is gone → the resend endpoint
   returns "no such flow." The user has no path to recovery beyond
   asking support.
3. **The verification link is single-use.** Combined with #1 and #2, a
   user who clicks the link a second time (curiosity, mail client
   pre-fetcher, browser back button) hits `invalid_or_expired_key` and
   has no obvious way to re-request.
4. **No standard signal that "you're authenticated but not verified."**
   `allauth` makes `is_authenticated = False` until verification. Every
   frontend gate has to know the difference between "anonymous" and
   "authenticated-but-unverified-and-stuck-in-the-flow." Two states,
   one boolean.

## Decision

Use `ACCOUNT_EMAIL_VERIFICATION = "optional"` and enforce verification
via middleware + a frontend route guard:

- `apps/core/middleware.py::RequireVerifiedEmailMiddleware` returns
  `403 {"detail": "email_verification_required"}` for `/api/*` when
  `request.user.is_authenticated and not user.emailaddress_set.filter(verified=True).exists()`.
- `frontend/src/routes/__root.tsx` `beforeLoad` reads the user's email
  list (`GET /_allauth/browser/v1/account/email`); if no verified entry,
  it `throw redirect({ to: '/account/verify-email' })`.
- `frontend/src/lib/api/client.ts` catches `403 email_verification_required`
  responses as belt-and-suspenders for the case where a session is verified
  at page-load and the backend unverifies it mid-session.

Exempt paths must stay in sync between the backend
(`_VERIFIED_EMAIL_EXEMPT_PREFIXES`) and frontend (`VERIFY_EXEMPT_PREFIXES`).

## Consequences

### What we gain

- **A real session at signup.** `useResendEmailVerification` keeps working
  across browser restarts because the user has a persistent session
  cookie, not a flow tied to one HTTP request.
- **One source of truth for "are you verified."** Both the backend
  middleware and the frontend guard check
  `EmailAddress.objects.filter(user=user, verified=True).exists()` — same
  query, same answer, no flow-state to interpret.
- **Verification links are idempotent UX.** Clicking a stale link (already
  verified, or expired) lands on the holding page, which can resend. No
  dead-end error screen.
- **Symmetric with the staff/MFA gate.** `RequireMfaForStaffMiddleware`
  uses the same pattern (allauth permits the action; we gate it via
  middleware). One mental model for both factors.
- **Cleaner state in the frontend.** `is_authenticated` is now an
  honest boolean. Verification is a separate signal read from a separate
  endpoint.

### What we give up

- **Backend code we have to maintain.** ~40 lines of middleware + tests
  vs. zero lines for `mandatory`. We own this forever.
- **Two enforcement layers can drift.** The exempt-path lists live in
  two files (frontend guard + backend middleware). If they go out of sync
  the symptom is a redirect loop on signup. Keep them in sync — there's
  a comment in each list pointing to the other.
- **Slightly more spec to understand for new contributors.** A reader
  trying to figure out "why is the email-list endpoint the source of
  truth instead of the session response" has to read both
  `RequireVerifiedEmailMiddleware` and the root `beforeLoad`. The
  payoff is the clean two-state model above.

### What changes for users

Signup → home, with an interstitial holding page until they click the
email link. Clicking the link in the same browser → straight to home.
Clicking from a different browser / incognito → "Email verified, log in
to continue" with a Login CTA (allauth no longer auto-logs in on
verification clicks since their 2024 release, regardless of mode).

## Sources

- [allauth Configuration — `ACCOUNT_EMAIL_VERIFICATION`](https://docs.allauth.org/en/dev/account/configuration.html)
- [allauth release notes — auto-login on verification disabled (2024)](https://docs.allauth.org/en/dev/release-notes/2024.html)
- [Better email verification workflows — Aryan Iyappan](https://aryaniyaps.medium.com/better-email-verification-workflows-13500ce042c7)
- [Keycloak forum — cross-browser verification](https://forum.keycloak.org/t/automatic-login-after-email-verification-open-in-another-browser/19443) (same pattern outside Django)
