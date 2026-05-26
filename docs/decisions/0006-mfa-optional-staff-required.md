# 0006 — 2FA optional for users; required for `/admin/` access

**Status:** Accepted
**Date:** 2026-05-26

## Context

The template needs a position on MFA enforcement. Three viable policies:

1. **Required for everyone** (`MFA_REQUIRED=True`) — hostile UX, especially
   on signup. Most consumer products don't do this.
2. **Optional for everyone** — what most products do. Users opt in.
3. **Required for `is_staff` users, optional for everyone else** — protects
   the highest-blast-radius surface (`/admin/`) without nagging regular users.

Plus an orthogonal question: when SAML lands later, does the app *also*
enforce its own MFA on top of the IdP's MFA policy?

The textbook answer to that orthogonal question is **no** — re-prompting
in-app after IdP MFA is the "duplicate MFA" SSO anti-pattern. The IdP
(Okta, Azure AD, etc.) is the single source of truth for the customer's
auth policy; your app trusts the SAML `AuthnContextClassRef` if anything.

## Decision

- **Global policy: `MFA_REQUIRED = False`.** 2FA is opt-in for everyone.
- **`/admin/` gate: every `is_staff` user must have at least one enrolled
  Authenticator** (TOTP, recovery codes, or WebAuthn). Enforced by
  `apps.core.middleware.RequireMfaForStaffMiddleware`. Redirects to
  `/account/mfa?required=true&next=/admin/` with a banner explaining why.
- **The gate fires regardless of auth method** — password, social, eventual
  SAML. It's a role-scoped policy, not an auth-method policy.
- **When SAML lands: app-level MFA stays opt-in.** The customer's IdP
  enforces their MFA policy; our app trusts the assertion. Staff/admin
  users at customers using SAML still need to enroll an app-side TOTP
  *once* for `/admin/` because admin actions are higher-blast-radius and
  worth the extra paranoia.

Implementation invariants for future-SAML compatibility:
- Frontend `useSession()` exposes `is_authenticated` + `mfa_enrolled`, NOT
  "how did they log in"
- Adapter seam in `apps/users/social_adapter.py` (placeholder) — domain
  restriction, JIT provisioning live here, not in views
- `AUTHENTICATION_BACKENDS` is a list — SAML backend appends cleanly

## Consequences

### What we gain
- Friendly default for new signups (no forced enrollment)
- Highest-blast-radius surface (`/admin/`) is protected at all times
- Per-customer IdP policies (when SAML lands) aren't second-guessed by our
  app — clean SSO citizenship
- One middleware, ~30 lines, fully testable

### What we give up
- Most regular users won't enable 2FA — the password is their only factor
- Staff users get one extra step on first `/admin/` visit
- Recovery code regen requires recent reauth (allauth design) — UI doesn't
  yet handle this case (logged as future work)

### What this rules out
- Mandatory app-level MFA for everyone (would be `MFA_REQUIRED=True`,
  considered + rejected)
- Auth-method-dependent MFA policies ("Google users skip, password users
  required") — too clever, hard to reason about

## Notes / future work
- See [auth.md](../auth.md) for the runtime flow + endpoint shape.
- Local dev: `admin@example.com` is seeded with a fixed TOTP secret so
  `/admin/` isn't gated after every `make seed`. Guarded: the seed
  command refuses to run when `DJANGO_DEBUG=False`.
- WebAuthn enrollment UI is a stub today; TOTP + recovery codes are the
  shipping path. Build the WebAuthn flow when a user asks.
