# 0003 — django-allauth headless for auth (over djoser / dj-rest-auth)

**Status:** Accepted
**Date:** 2026-05-22

## Context

Django + DRF needs an auth layer for the SPA. Three patterns in
common use:

1. **`django-allauth` (headless mode)** — modern unified replacement for
   the old "allauth + dj-rest-auth" combo. Covers password, email, social,
   MFA, password reset. Has both browser/v1 (session cookies) and
   app/v1 (token) endpoints.
2. **`djoser`** — DRF-native auth endpoints. Smaller surface, simpler to
   start, but less feature-rich.
3. **Custom DRF views on top of `django.contrib.auth`** — full control,
   max work.

Our needs:
- Email + username login
- Password reset via email
- Email verification
- Social login (Google, future)
- MFA (TOTP, recovery codes, WebAuthn)
- Sessions (not JWT) — same auth as `/admin/`

allauth covers all of these as standard modules. djoser would require
plugging in additional libraries for social + MFA, with less coherence.
Custom is a rewrite of what allauth already maintains.

## Decision

Use `django-allauth` with the **headless** add-on. SPA hits
`/_allauth/browser/v1/*` which sets standard Django session cookies +
CSRF cookies — same auth state DRF SessionAuthentication consumes.

Settings:
```python
HEADLESS_ONLY = True
ACCOUNT_LOGIN_METHODS = {"email", "username"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
```

## Consequences

### What we gain
- One library handles password, social, MFA, email flows — coherent design
- Same session cookie powers `/admin/`, allauth, and DRF — single source of truth
- Active maintenance (April 2026 release with both email + username login support)
- MFA is a config switch away (`allauth.mfa` + `[mfa]` extra)

### What we give up
- More moving parts than djoser if we only ever wanted password login
- Headless mode requires version ≥ 65.16 for the both-login-methods feature
- `AccountMiddleware` ordering matters (after Auth + Messages, before XFrame)

### What now becomes easier
- Adding "Sign in with Google" later — just configure `SOCIALACCOUNT_PROVIDERS`
- Adding 2FA — already done in Phase 1 (see ADR 0006)
- Eventually adding SAML — allauth has a SAML extension; backends append cleanly

## Notes / future work
- See [auth.md](../auth.md) for endpoint shape, CSRF handling, error parsing.
- Use the **browser/v1** flavor, NOT app/v1. app/v1 returns a token in
  JSON which DRF SessionAuthentication wouldn't see — easy mistake.
