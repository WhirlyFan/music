# Authentication

How users sign in, how the SPA stays authenticated, how MFA works, and how
brute-force is blocked.

## Stack

| Concern | Library | Notes |
|---|---|---|
| Identity + flows | `django-allauth` (headless mode) | login, signup, email verification, password reset, social, MFA — all in one |
| API session | DRF `SessionAuthentication` | Same cookie as `/admin/` and allauth — one source of truth |
| MFA | `allauth.mfa` (`[mfa]` + `fido2`) | TOTP, recovery codes, WebAuthn passkeys |
| Brute-force | `django-axes` | Lockout per (username + IP); cooloff configurable per env |
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
POST   /_allauth/browser/v1/auth/reauthenticate   re-enter password for sensitive ops
POST   /_allauth/browser/v1/auth/2fa/authenticate post-password MFA code
POST   /_allauth/browser/v1/auth/2fa/trust        complete the "remember this browser" stage
POST   /_allauth/browser/v1/auth/email/verify     consume the verification key
GET    /_allauth/browser/v1/account/email         list user's emails (verification status)
PUT    /_allauth/browser/v1/account/email         resend verification email (body: { email })
GET    /_allauth/browser/v1/account/authenticators              list enrolled methods
GET    /_allauth/browser/v1/account/authenticators/totp         start TOTP enrollment
POST   /_allauth/browser/v1/account/authenticators/totp         confirm TOTP enrollment
DELETE /_allauth/browser/v1/account/authenticators/totp         remove TOTP
GET    /_allauth/browser/v1/account/authenticators/webauthn     creation options for passkey
POST   /_allauth/browser/v1/account/authenticators/webauthn     register passkey ({name, credential})
DELETE /_allauth/browser/v1/account/authenticators/webauthn     remove passkeys ({authenticators: [...]})
GET    /_allauth/browser/v1/account/authenticators/recovery-codes  view (reauth required)
POST   /_allauth/browser/v1/account/authenticators/recovery-codes  regenerate (reauth required)

GET    /api/v1/users/passkey-credential-ids/      our endpoint — maps authenticator pk → credential id
                                                  (used for the WebAuthn Signal API on delete)
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

## Email verification — `optional` mode + middleware gate

`ACCOUNT_EMAIL_VERIFICATION = "optional"` in `config/settings/base.py`.
Signup creates a real authenticated session; access to anything past the
holding page is gated by middleware (backend) + a root-route guard
(frontend) until `EmailAddress.verified = True`.

Full rationale + alternatives in [ADR 0008](decisions/0008-email-verification-optional-plus-gate.md).

### Flow

1. User submits signup → `POST /_allauth/browser/v1/auth/signup`
2. allauth creates the user (unverified email), sends the verification
   email, returns `{ status: 200, meta: { is_authenticated: true }, data: { user: { ... } } }`. **allauth's session response does NOT expose verification status** — the source of truth is the email-list endpoint below
3. Frontend navigates to `/`. Root `beforeLoad` checks
   `isSessionAuthenticated(session)` then fetches `GET /_allauth/browser/v1/account/email`
   and checks `hasVerifiedPrimaryEmail` — same query as the backend
   (`EmailAddress.objects.filter(user=user, verified=True).exists()`).
   Unverified → `throw redirect({ to: '/account/verify-email' })`
4. Holding page shows "Check your email" + a "Resend verification email" button (POSTs `PUT /account/email` with `{ email }`)
5. User clicks the link → lands at `/account/verify-email/$key`. The route
   `loader` (not a `useEffect`) POSTs the key, force-refetches the email
   list, and either `throw redirect({ to: '/' })` on success or renders the
   right error UI

### Three real outcomes from the email-link click

| Outcome | When | UI |
|---|---|---|
| Verified + logged in here | Same browser as signup | Toast "Email verified" → redirect home |
| Verified, but **not** logged in | Different browser / incognito | "Email verified — log in to continue" card with a Login CTA. allauth no longer auto-logs in on verify click (their [2024 security change](https://docs.allauth.org/en/dev/release-notes/2024.html)) |
| Invalid / expired / wrong-account | Bad or already-consumed link | "Link no longer works" card with a "Get a new link" CTA |

The frontend reads the **email-list endpoint** rather than the verify-POST
response to decide which outcome. This insulates us from Strict-Mode
double-mounts, browser pre-fetchers, and double-clicks, all of which can
cause the second POST to 400 even though the first one succeeded.

### Three enforcement layers

| Layer | File | What it does |
|---|---|---|
| Backend middleware | `backend/apps/core/middleware.py::RequireVerifiedEmailMiddleware` | Returns `403 {"detail": "email_verification_required"}` on `/api/*` when authenticated user has no verified email. The contract for cURL / mobile / any client |
| Frontend root guard | `frontend/src/routes/__root.tsx` `beforeLoad` | Redirects authenticated+unverified users to `/account/verify-email`, except on exempt routes (verify-email, logout, login, signup) |
| Frontend fetch fallback | `frontend/src/lib/api/client.ts` | On `403 email_verification_required` from any API call, hard-redirects to the holding page. Catches the edge where a session was verified at load but unverified mid-session |

**Keep exempt paths in sync** between `VERIFY_EXEMPT_PREFIXES` (frontend
guard) and `_VERIFIED_EMAIL_EXEMPT_PREFIXES` (backend middleware). Drift
shows up as a redirect loop on signup.

### URL-encoded key gotcha

Django's URL utilities URL-encode the verification key when constructing
the email link (`MTk:1wRoSB:...` → `MTk%3A1wRoSB%3A...`). The route
`params` give us the raw URL segment, so we `decodeURIComponent` before
POSTing — otherwise allauth compares the encoded string against the DB's
literal-colon key and rejects it as "invalid or expired."

### Side-effects on TOTP enrollment

allauth refuses to mint TOTP authenticators for unverified emails (returns
409 `unverified_email`). The root guard funnels unverified users to
`/account/verify-email` before they can reach `/account/mfa/totp`, so by
the time enrollment runs the precondition holds.

### Local dev: seeded accounts skip verification

The seed bakes an `EmailAddress(verified=True)` row for every seeded user
(known accounts + fake users via UserFactory). Without this, every fresh
`make seed` would lock out `dev@example.com` and `admin@example.com`.

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

## MFA

### Design

| Rule | Why |
|---|---|
| **Optional for all users** (`MFA_REQUIRED = False`) | Most users won't enable it; nagging on signup is hostile UX |
| **Required for `is_staff` users hitting `/admin/`** | Admin actions are higher-blast-radius. Enforced by `RequireMfaForStaffMiddleware` |
| Three methods: TOTP, recovery codes, WebAuthn (passkeys) | TOTP covers most users; recovery codes are the backup; passkeys are modern |
| When SAML/SSO lands, the IdP's MFA policy applies — app-level stays opt-in | Re-prompting in-app after IdP-MFA is the textbook SSO anti-pattern |

ADR: [decisions/0006-mfa-optional-staff-required.md](decisions/0006-mfa-optional-staff-required.md).

UI naming: user-facing copy uses "Multi-factor authentication" / "MFA"
consistently (no "2FA" in user-visible strings). The `/auth/2fa/*` URL
paths in the API are allauth's literal endpoint URLs — those stay.

### Staff `/admin/` gate

[`apps/core/middleware.py::RequireMfaForStaffMiddleware`](../backend/apps/core/middleware.py)
intercepts `/admin/*` requests. If the user is authenticated, `is_staff`,
and has zero `Authenticator` rows, redirects to
`/account/mfa?required=true&next=<path>`. Exempt prefixes: `/account/mfa`,
`/_allauth/`, `/account/logout`.

Tests: [`apps/core/tests/test_staff_mfa_middleware.py`](../backend/apps/core/tests/test_staff_mfa_middleware.py).

### TOTP code tolerance

```python
MFA_TOTP_TOLERANCE = 1
```

Allows the previous and next 30-second windows in addition to the current
one. Closes the common "I typed the last digit right as it rolled over"
footgun without meaningfully weakening security.

### "Remember this browser for 30 days"

```python
MFA_TRUST_ENABLED = True
MFA_TRUST_COOKIE_AGE = timedelta(days=30)
```

After a successful MFA code submit allauth advances to a `mfa_trust`
stage; the frontend's MFA challenge form has an opt-in checkbox that
POSTs `/auth/2fa/trust` with the user's choice. Trust = `True` mints a
signed cookie that skips the MFA challenge on subsequent logins from this
browser. Trust = `False` is still required (the trust stage blocks the
final 200 until *some* answer is given).

**Reading the code-submit response.** With trust enabled, an accepted
6-digit code returns `401 + mfa_trust: is_pending: true` instead of 200 —
allauth holds the login until the trust stage completes. The frontend
check `isMfaTrustPending(result)` runs *before* the "invalid code" branch
so a valid code doesn't read as a rejection.

### Reauthentication ("sensitive actions")

allauth's `Authenticator.AccessLevel.SENSITIVE` actions return
`401 + reauthenticate` flow when the session isn't "fresh." We use this
gate for:

- Adding a passkey (`POST /account/authenticators/webauthn`)
- Removing a passkey (`DELETE /account/authenticators/webauthn`)
- Viewing recovery codes (`GET /account/authenticators/recovery-codes`)
- Regenerating recovery codes

Shared frontend component:
[`components/auth/reauthenticate-step.tsx`](../frontend/src/components/auth/reauthenticate-step.tsx).
Exports `<ReauthenticateStep />` (password prompt card) and `requiresReauth(res)`
(detector). Pages that perform a sensitive action either gate on
`requiresReauth(initialQuery.data)` before rendering, or fall through to a
reauth retry after a 401.

### Recovery codes

- **Require an authenticator factor first.** allauth refuses to mint
  recovery codes for a user with no other MFA method. They're a *backup*,
  not a primary factor — the overview page hides the "Generate" row until
  TOTP is enrolled.
- **Viewing + regenerating require reauth.** The recovery-codes page
  detects `requiresReauth` on its GET response and renders the password
  prompt instead of the codes.

### WebAuthn / passkeys

Full enrollment + delete UI at `/account/mfa/webauthn`. Three-step flow:

1. **Reauthenticate** with password (shared `ReauthenticateStep`)
2. **Fetch creation options.** `GET /account/authenticators/webauthn` →
   `{ creation_options: { publicKey: {...} } }`. The frontend uses
   `@github/webauthn-json/browser-ponyfill`'s `parseCreationOptionsFromJSON()`
   to base64url-decode `challenge` / `user.id` into `ArrayBuffer`s before
   handing them to `navigator.credentials.create()`. The returned
   credential's `.toJSON()` re-encodes to base64url for the POST body.
3. **POST the attestation** with `{ name, credential }`. Toast + return to
   overview.

Removal does the same reauth dance: attempt DELETE, if 401 with
`reauthenticate` pending → prompt for password → retry. No `confirm()`
modal — the password challenge IS the deliberate-action gate.

#### Signal API — device-side cleanup

Server-side delete revokes the public key from our database, but the
credential **still lives on the user's device** (Touch ID Keychain,
Windows Hello vault, hardware-key memory, password-manager passkey store).
After a successful delete the frontend fires
`PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })` so
modern browsers prune the local copy. Best-effort: silent on unsupported
browsers (older Firefox, Safari < 18), spec-mandated silent on success.

The credential ID isn't exposed by allauth's authenticator list (security
default — don't leak credential bytes), so we expose it via
`GET /api/v1/users/passkey-credential-ids/` — a small DRF endpoint scoped
to the calling user. See [`apps/users/views.py`](../backend/apps/users/views.py).

> ℹ️ The Signal API only exists for WebAuthn. TOTP authenticator apps have
> no equivalent — RFC 6238 is one-way by design, so deleting a TOTP factor
> server-side leaves the entry orphaned in the user's authenticator app
> until they remove it manually.

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
AXES_COOLOFF_TIME = timedelta(minutes=5)   # dev. Prod default = timedelta(hours=1)
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
AXES_RESET_ON_SUCCESS = True               # forgive typos after a good login
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",  # MUST be first
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
```

`AxesMiddleware` must be the **last** entry in `MIDDLEWARE` so it can
observe failures from auth backends above.

The lockout response is `403` with a body axes generates directly:

```json
{ "failure_limit": 5, "username": "...", "cooloff_time": "PT5M", "cooloff_timedelta": "P0DT00H05M00S" }
```

The frontend `bannerError()` helper detects this shape and surfaces
"Too many failed attempts. Try again in 5 minutes." via toast — no
duplication with field-level "Incorrect password" errors. Helpers in
[`frontend/src/lib/auth/errors.ts`](../frontend/src/lib/auth/errors.ts):
`isAxesLockout`, `axesLockoutMessage`, `formatAxesCooloff` (ISO-8601
duration → human string).

**Resetting a dev lockout:** `docker compose exec backend python manage.py axes_reset_username dev@example.com` (or `axes_reset` for all).

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
| Valid TOTP code reads as "Invalid code — try again" | Frontend checks `status !== 200` before `isMfaTrustPending(result)` | With `MFA_TRUST_ENABLED`, an accepted code returns `401 + mfa_trust: is_pending: true`. Check trust pending FIRST |
| Staff user redirected to `/account/mfa` and back | Enrollment route was gated by mistake | Verify `_MFA_EXEMPT_PREFIXES` in `apps/core/middleware.py` |
| Verify-email link clicked → "Link no longer works" but verification did succeed | Strict-Mode double-mount → 2nd POST gets 400, frontend reads response status | Frontend reads the email-list endpoint, not the POST response — that's the fix already in place. If it regresses, check `$key.tsx`'s loader |
| Resend verification button does nothing | POSTing to `PUT /auth/email/verify` (wrong endpoint for `optional` mode) | Use `PUT /account/email` with `{email}` — see `auth.ts::resendEmailVerification` |
| `axes` locks out a real user during dev | Hit 5 failed logins | `make axes-reset` (or `python manage.py axes_reset`) |
| Recovery codes endpoint returns 401 + `reauthenticate` flow | Session isn't fresh for sensitive read | Render the `<ReauthenticateStep />`; invalidate the recovery-codes query on confirm |

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
- [decisions/0008-email-verification-optional-plus-gate.md](decisions/0008-email-verification-optional-plus-gate.md) — email verification pattern
- [permissions.md](permissions.md) — is_staff vs is_superuser
- [rls.md](rls.md) — how `request.user.id` flows into the DB
