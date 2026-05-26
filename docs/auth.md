# Authentication

How users sign in, how the SPA stays authenticated, how 2FA works, and how
brute-force is blocked.

## Stack

| Concern | Library | Notes |
|---|---|---|
| Identity + flows | `django-allauth` (headless mode) | login, signup, email verification, password reset, social, MFA — all in one |
| API session | DRF `SessionAuthentication` | Same cookie as `/admin/` and allauth — one source of truth |
| 2FA | `allauth.mfa` (`[mfa]` + `fido2`) | TOTP, recovery codes, WebAuthn passkeys |
| Brute-force | `django-axes` | Lockout per (username + IP) after 5 fails / hour |
| Rate limit | `django-ratelimit` | Per-IP / per-user; apply per-view |
| Password screening | `pwned-passwords-django` | k-anonymity HIBP lookup at signup + change |

## Endpoint shape

allauth's **browser/v1** flavor (not `app/v1`) — sets a Django session
cookie + CSRF cookie, which matches DRF SessionAuthentication. Same auth
state for `/_allauth/*` and `/api/*` under one origin.

The `app/v1` flavor is for native mobile clients (returns a token in JSON).
Using it from the SPA means DRF never sees the user as authenticated.

```
POST   /_allauth/browser/v1/auth/login            email/username + password
POST   /_allauth/browser/v1/auth/signup           email + username + password
DELETE /_allauth/browser/v1/auth/session          logout
GET    /_allauth/browser/v1/auth/session          current session info
POST   /_allauth/browser/v1/auth/2fa/authenticate post-password MFA code
GET    /_allauth/browser/v1/account/authenticators              list enrolled methods
GET    /_allauth/browser/v1/account/authenticators/totp         start TOTP enrollment
POST   /_allauth/browser/v1/account/authenticators/totp         confirm TOTP enrollment
GET    /_allauth/browser/v1/account/authenticators/recovery-codes
POST   /_allauth/browser/v1/account/authenticators/recovery-codes  regenerate (requires recent reauth)
```

Frontend wrapper: [`frontend/src/lib/auth/api.ts`](../frontend/src/lib/auth/api.ts).

## Login methods

```python
# config/settings/base.py
ACCOUNT_LOGIN_METHODS = {"email", "username"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
```

The frontend's `useLogin` wrapper detects `@` in the identifier and submits
`email=` or `username=` accordingly. Both routes hit the same endpoint.

> ⚠️ Requires `django-allauth >= 65.16`. Earlier versions had a 400 bug when
> both methods were enabled in headless mode.

## Email verification (mandatory)

`ACCOUNT_EMAIL_VERIFICATION = "mandatory"` in `config/settings/base.py` —
new signups MUST verify their email before they can log in.

### Flow

1. User submits signup form → `POST /_allauth/browser/v1/auth/signup`
2. allauth creates the user (unverified), sends a verification email, returns:
   ```json
   { "status": 401, "data": { "flows": [..., { "id": "verify_email", "is_pending": true }] } }
   ```
3. Frontend detects `isEmailVerificationPending(response)` → navigates to `/account/verify-email`
4. Waiting page shows "Check your email" + "Resend verification email" button
5. User clicks the link in the email → lands at `/account/verify-email/{key}` (URL pattern from `HEADLESS_FRONTEND_URLS.account_confirm_email`)
6. Route auto-POSTs the key to `/_allauth/browser/v1/auth/email/verify`
7. allauth marks the email verified; with `ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION = True` (set in `base.py`), a same-session click ALSO completes the auth — the response carries `is_authenticated: true`. Cross-browser clicks (email opened in a different browser than signup) only verify the email at the data layer; the user must then log in normally.
8. Frontend toasts "Email verified" and redirects to `/`

### Why mandatory

- Filters typos and throwaway emails at signup
- Guarantees the app can actually reach users via email (resets, MFA recovery)
- Forces downstream forks to think about email deliverability (Mailpit dev + Resend prod is wired)
- One-line relaxation: flip to `"optional"` if a fork wants lower friction

### Side-effects on TOTP enrollment

allauth refuses to mint TOTP authenticators for unverified emails — returns
409 with `unverified_email`. Verification is a hard precondition for MFA
regardless of the global verification policy; mandatory mode makes the
flow consistent (by the time the user reaches `/account/mfa/totp`, they're
already verified).

### Local dev: seeded accounts skip verification

The seed bakes an `EmailAddress` row with `verified=True` for every seeded
user (known accounts + fake users via UserFactory). Without this, every
fresh `make seed` would lock out `dev@example.com` and `admin@example.com`.

## Session cookies — why not JWT

| Reason | Detail |
|---|---|
| Same-origin behind nginx → cookies "just work" | No `Authorization: Bearer` header to manage on every request |
| Single source of truth | Django session is auth for `/admin/`, allauth, *and* DRF |
| Logout is a real revocation | Server can invalidate; JWT requires a blacklist table |
| XSS risk reduced | `HttpOnly` cookies aren't reachable from JS; tokens-in-localStorage are |

allauth headless *does* support JWT if we ever need cross-origin. We don't,
so we don't.

## CSRF protection

Django's CSRF middleware checks the Origin/Referer of state-changing
requests against `CSRF_TRUSTED_ORIGINS` (env-driven in
[`config/settings/prod.py`](../backend/config/settings/prod.py)).

For the SPA, the frontend wrapper:
1. Does a one-shot GET to `/_allauth/browser/v1/auth/session` if the
   `csrftoken` cookie isn't set yet. CsrfViewMiddleware sets it on response.
2. On every POST/PATCH/DELETE, reads the cookie and sends it as
   `X-CSRFToken` header.

See [`frontend/src/lib/auth/api.ts`](../frontend/src/lib/auth/api.ts) —
`ensureCsrfCookie()` + `getCsrfCookie()`.

## 2FA / MFA

### Design

| Rule | Why |
|---|---|
| **Optional for all users** (`MFA_REQUIRED = False`) | Most users won't enable it; nagging them on signup is hostile UX |
| **Required for `is_staff` users hitting `/admin/`** | Admin actions are higher-blast-radius. Enforced by `RequireMfaForStaffMiddleware` |
| Three methods supported: TOTP, recovery codes, WebAuthn | TOTP covers most users; recovery codes are the backup; passkeys are modern |
| When SAML/SSO lands, the IdP's MFA policy applies — app-level stays opt-in | Re-prompting in-app after IdP-MFA is the textbook SSO anti-pattern |

ADR: [decisions/0006-mfa-optional-staff-required.md](decisions/0006-mfa-optional-staff-required.md).

### Staff `/admin/` gate

[`apps/core/middleware.py::RequireMfaForStaffMiddleware`](../backend/apps/core/middleware.py)
intercepts `/admin/*` requests. If the user is authenticated, `is_staff`,
and has zero `Authenticator` rows, redirects to
`/account/mfa?required=true&next=<path>`. Exempt prefixes: `/account/mfa`,
`/_allauth/`, `/account/logout` (so the user can actually enroll without
hitting a redirect loop).

Tests: [`apps/core/tests/test_staff_mfa_middleware.py`](../backend/apps/core/tests/test_staff_mfa_middleware.py).

### Recovery codes — gotchas

- **Require TOTP first.** allauth refuses to mint recovery codes for a
  user with no other MFA method. They're a *backup*, not a primary factor.
- **Regenerating requires recent re-auth.** allauth returns
  `flow: reauthenticate` on POST to the regen endpoint if the user logged
  in more than ~5 minutes ago. The frontend should prompt for the password
  again. (Not yet wired up — flagged in the README.)

### Local dev convenience

The seed command enrolls `admin@example.com` with a fixed TOTP secret
(`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`) so `/admin/` isn't gated after every
`make seed`. Guarded: the seed command refuses to run when
`DJANGO_DEBUG=False`. Production admins enroll their own TOTP via the UI.

### At-rest encryption of TOTP secrets

allauth stores `Authenticator.data["secret"]` as JSON in the
`mfa_authenticator` table. By default that's plaintext — if a DB dump
leaks, every TOTP is compromised.

We wrap this with **app-layer Fernet encryption**, transparent to
allauth's code:

- `apps/core/encryption.py` — `encrypt()` / `decrypt()` keyed by
  `settings.MFA_FIELD_ENCRYPTION_KEY` (env-driven, never in repo)
- `apps/core/mfa_encryption.py` — `post_init` decrypts on load,
  `pre_save` encrypts on write, all keyed off the Authenticator model
- `apps/core/migrations/0001_encrypt_mfa_secrets.py` — one-time data
  migration that re-encrypts pre-existing plaintext rows

Round-trip:

```
allauth code:   authenticator.data["secret"]  →  "JBSWY3DPEHPK3PXP..." (plaintext)
                                                       ↑ post_init decrypted on load
                                                       ↓ pre_save will encrypt on next write
Postgres:       mfa_authenticator.data          →  '{"secret": "enc:gAAAAAB..."}'
```

`MFA_FIELD_ENCRYPTION_KEY` is a Fernet key (32-byte base64url-encoded).
Generate with:

```python
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Stored as `sync: false` in `render.yaml` — operator pastes per deploy.
Loss of key = users must re-enroll TOTP (the only failure mode).

What this protects against:
- DB dumps / backups leaking to attackers
- SQL injection that exfiltrates the JSON column
- Operators with read-only DB access seeing live secrets

What this does NOT protect against:
- Attacker with full app access (they can read the env var)
- Compromised Render account (they can read the dashboard)
- For higher-tier protection, swap Fernet for KMS-backed encryption
  (out of scope for this template)

## Brute-force protection (django-axes)

```python
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1  # hours
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",  # MUST be first
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
```

`AxesMiddleware` must be the **last** entry in `MIDDLEWARE` so it can
observe failures from auth backends above. We verify this in
[`config/settings/base.py`](../backend/config/settings/base.py).

## Future: social login

`allauth.socialaccount` is installed and the model tables are present, but
no providers are configured. Adding "Sign in with Google" is roughly:

1. Create OAuth credentials in Google Cloud Console
2. Add `allauth.socialaccount.providers.google` to `INSTALLED_APPS`
3. Configure `SOCIALACCOUNT_PROVIDERS["google"] = {...}` in settings
4. Set `SOCIALACCOUNT_EMAIL_AUTHENTICATION = True` to auto-link by verified email
5. Frontend button → full-page redirect to `/_allauth/browser/v1/auth/provider/redirect?provider=google`

**Key invariant:** social identities link to the *same* `User` rows our
password users live in. `request.user.is_staff` / `is_superuser` /
permissions / RLS behave identically regardless of how the user signed in.
A "social user" is not a different user model.

## Future: SAML / SCIM

See ADR 0005 (deferred). Three architectural invariants Phase 1 + 2 preserve so
SAML adds cleanly later:

1. `AUTHENTICATION_BACKENDS` is a list — SAML backend appends without rewrites
2. RLS keyed on `user.id`, not email or provider — provider-agnostic
3. Frontend uses `useSession()` flags (`is_authenticated`, `mfa_enrolled`),
   not "how did they log in" — provider-agnostic UI

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `403 CSRF verification failed` on first POST | No `csrftoken` cookie yet | `ensureCsrfCookie()` runs a GET to `/_allauth/auth/session` first |
| Login returns 200, but DRF says unauthenticated on next request | Using `app/v1` instead of `browser/v1` | Switch the frontend wrapper to `browser/v1` |
| MFA-enrolled user "can't log in" | Frontend not handling the 401-with-`mfa_authenticate` flow | `isMfaChallenge(response)` + MFA challenge form |
| Staff user redirected to `/account/mfa` and back | Enrollment route was gated by mistake | Verify `_EXEMPT_PREFIXES` in `apps/core/middleware.py` |
| `axes` locks out a real user during dev | Hit 5 failed logins | `python manage.py axes_reset` |

## Password reset

Two-step flow wired today:

1. **Request** — `POST /_allauth/browser/v1/auth/password/request` with `{email}`. Always returns 200 (no signal about whether the email exists). Triggers an email with a reset link.
2. **Complete** — link lands at `/account/password/reset/key/<key>` (set by `HEADLESS_FRONTEND_URLS.account_reset_password_from_key`). The page POSTs `{key, password}` to `/_allauth/browser/v1/auth/password/reset`, which validates the key, applies password validators (including HIBP), and logs the user in.

Frontend routes: `routes/account/password/forgot.tsx`, `routes/account/password/reset/key/$key.tsx`. Hooks: `useRequestPasswordReset`, `useCompletePasswordReset`. "Forgot password?" link on `/login`.

**Heads-up:** the *delivery* of the reset email requires a real email provider in production. See [ops/email.md](ops/email.md) for setup. Locally, emails print to `docker compose logs backend`.

## See also

- [ops/email.md](ops/email.md) — wiring a transactional email provider (Resend / Postmark / SES)
- [decisions/0003-allauth-headless.md](decisions/0003-allauth-headless.md) — why allauth over djoser
- [decisions/0006-mfa-optional-staff-required.md](decisions/0006-mfa-optional-staff-required.md) — the MFA policy choice
- [permissions.md](permissions.md) — is_staff vs is_superuser
- [rls.md](rls.md) — how `request.user.id` flows into the DB
