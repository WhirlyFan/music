/**
 * Wrappers around the django-allauth headless endpoints under /_allauth/.
 *
 * We use the **browser/v1** flavor (not app/v1) so allauth sets a Django
 * session cookie + CSRF cookie. That matches DRF's SessionAuthentication
 * — same auth state for /_allauth/* and /api/* under the same origin.
 *
 * The app/v1 flavor is for mobile/native clients and returns a token in JSON
 * instead of setting cookies; using it from the SPA would mean DRF never
 * sees you as authenticated.
 */
const ALLAUTH = '/_allauth/browser/v1'
const API = (import.meta.env.VITE_API_BASE as string) ?? '/api/v1'

type AllAuthResponse<T = unknown> = { status: number; data: T; meta?: unknown }

function getCsrfCookie(): string | null {
  return document.cookie.match(/(^|; )csrftoken=([^;]+)/)?.[2] ?? null
}

/**
 * Browser-mode allauth uses Django sessions + CSRF. State-changing requests
 * need an X-CSRFToken header that matches the csrftoken cookie. If the user's
 * very first action is a POST (no prior GET to seed the cookie), do a one-shot
 * pre-flight to /auth/session — that request goes through CsrfViewMiddleware
 * and sets the cookie before we send the POST.
 */
async function ensureCsrfCookie(): Promise<void> {
  if (getCsrfCookie()) return
  await fetch(`${ALLAUTH}/auth/session`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
}

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<AllAuthResponse<T>> {
  if (method !== 'GET') {
    await ensureCsrfCookie()
  }
  const csrf = getCsrfCookie()
  const res = await fetch(`${ALLAUTH}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json() as Promise<AllAuthResponse<T>>
}

/**
 * Begin a social login via allauth's browser redirect flow. This is a REAL
 * browser navigation (a synthesized form POST), not a fetch — the endpoint
 * responds with a 302 to the provider, which fetch can't follow across origins.
 * allauth returns to `callbackUrl` afterward: authenticated on success, or with
 * `?error=<code>&error_process=login` on failure (e.g. `signup_closed` when the
 * invite gate rejects a new Google user). CSRF: the headless POST accepts the
 * `csrfmiddlewaretoken` form field (form posts can't set the X-CSRFToken header),
 * so we seed the cookie first and pass it through.
 */
export async function providerRedirect(
  provider: string,
  opts: { process?: 'login' | 'connect'; callbackUrl: string },
): Promise<void> {
  await ensureCsrfCookie()
  const fields: Record<string, string> = {
    provider,
    process: opts.process ?? 'login',
    callback_url: opts.callbackUrl,
  }
  const csrf = getCsrfCookie()
  if (csrf) fields.csrfmiddlewaretoken = csrf

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${ALLAUTH}/auth/provider/redirect`
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
}

export const auth = {
  session: () => call('GET', '/auth/session'),
  /** Public allauth config — includes the list of configured social providers. */
  config: () => call('GET', '/config'),
  /** Social accounts connected to the signed-in user. */
  providerAccounts: () => call('GET', '/account/providers'),
  /** Disconnect a connected social account (by provider id + account uid). */
  disconnectProvider: (provider: string, account: string) =>
    call('DELETE', '/account/providers', { provider, account }),

  /**
   * Login by EITHER email or username. We detect which by the '@' in the
   * identifier and submit the right field name; allauth (with both login
   * methods enabled) accepts either.
   *
   * If the user has MFA enrolled, allauth returns status 401 with
   * `data.flows[]` including `mfa_authenticate`. The caller handles that
   * step via `auth.mfaAuthenticate(code)`.
   */
  login: (identifier: string, password: string) => {
    const looksLikeEmail = identifier.includes('@')
    const payload = looksLikeEmail
      ? { email: identifier, password }
      : { username: identifier, password }
    return call('POST', '/auth/login', payload)
  },

  signup: (params: { email: string; username: string; password: string }) =>
    call('POST', '/auth/signup', params),

  logout: () => call('DELETE', '/auth/session'),

  // --- Email verification (mandatory after signup) ---
  /**
   * Complete email verification by submitting the key from the email link.
   * On success, allauth marks the EmailAddress.verified=True and the user
   * can now log in (or, if they were mid-signup-session, continue).
   */
  verifyEmail: (key: string) => call('POST', '/auth/email/verify', { key }),

  /**
   * Resend the verification email for the authenticated user's address.
   * Hits the email-management surface (`PUT /account/email`) — the
   * authenticated equivalent of `/auth/email/verify/resend`. With
   * `ACCOUNT_EMAIL_VERIFICATION = "optional"` the user IS fully
   * authenticated after signup, so this is the correct endpoint.
   * Body `{ email }` identifies which of their emails to resend (we only
   * ever have one).
   */
  resendEmailVerification: (email: string) => call('PUT', '/account/email', { email }),

  /**
   * Request an email change. With `ACCOUNT_CHANGE_EMAIL = True`, allauth
   * adds the new address (unverified) and sends a verification link to it.
   * The old address stays primary until the new one is verified, then
   * swaps. POST /account/email, body `{ email }`.
   */
  changeEmail: (email: string) => call('POST', '/account/email', { email }),

  /**
   * Cancel a pending email change by removing the unverified address.
   * DELETE /account/email, body `{ email }`. allauth aborts the in-flight
   * verification and drops the address, leaving the current (primary) email
   * untouched. (A *new* change request already auto-replaces a pending one;
   * this is the explicit "never mind" path.)
   */
  removeEmail: (email: string) => call('DELETE', '/account/email', { email }),

  // --- Password change (authenticated) ---
  /**
   * Change the password for the logged-in user. `current_password` is
   * required when the account has a usable password (always, for our
   * password-based signups). On success allauth keeps the session alive.
   * POST /account/password/change.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    call('POST', '/account/password/change', {
      current_password: currentPassword,
      new_password: newPassword,
    }),

  // --- Password reset (two-step) ---
  /**
   * Step 1: user submits their email; allauth sends a reset link if the
   * account exists. Always returns 200 — we don't leak which emails are
   * registered. The link lands at HEADLESS_FRONTEND_URLS.account_reset_password_from_key,
   * which is /account/password/reset/key/<key> per our settings.
   */
  requestPasswordReset: (email: string) => call('POST', '/auth/password/request', { email }),

  /**
   * Step 2: GET to validate the key (used by the reset page to fail-fast
   * if the link is expired/invalid before the user types a new password).
   */
  getPasswordResetInfo: (key: string) =>
    call('GET', `/auth/password/reset?key=${encodeURIComponent(key)}`),

  /**
   * Step 3: submit the new password with the key. allauth verifies the
   * key, applies the password validators (incl. HIBP), and logs the user in.
   */
  completePasswordReset: (key: string, password: string) =>
    call('POST', '/auth/password/reset', { key, password }),

  // --- MFA challenge step (post-password) ---
  /** Submit a TOTP/recovery code mid-login to finish authenticating. */
  mfaAuthenticate: (code: string) => call('POST', '/auth/2fa/authenticate', { code }),

  /**
   * Complete the "remember this browser" stage. After mfaAuthenticate
   * succeeds with MFA_TRUST_ENABLED on the backend, the session enters a
   * `mfa_trust` stage; the user must POST `{trust}` to advance. Setting
   * `trust: true` mints a signed cookie (`MFA_TRUST_COOKIE_AGE`, 30d) that
   * skips the MFA challenge on subsequent logins from this device.
   */
  mfaTrust: (trust: boolean) => call('POST', '/auth/2fa/trust', { trust }),

  /**
   * Re-confirm the user's password to "freshen" the session for sensitive
   * operations (adding a passkey, changing primary email, etc.). allauth
   * returns 401 + a `reauthenticate` flow on those endpoints when the
   * session is stale; this completes that flow.
   */
  reauthenticate: (password: string) => call('POST', '/auth/reauthenticate', { password }),

  // --- WebAuthn / passkey enrollment ---
  /**
   * Fetch the PublicKeyCredentialCreationOptions for a new passkey. The
   * response (under `data.creation_options`) is the JSON-encoded options
   * payload — `lib/auth/webauthn.ts#createPasskey` runs it through the native
   * `PublicKeyCredential.parseCreationOptionsFromJSON` + the create() ceremony.
   *
   * 401 + `reauthenticate` flow when the session isn't fresh — call
   * `reauthenticate` first, then retry this GET.
   */
  getWebAuthnCreationOptions: () => call('GET', '/account/authenticators/webauthn'),

  /**
   * Finalize passkey enrollment. `credential` is the JSON-serialized result
   * of navigator.credentials.create() (the native credential.toJSON()).
   * `passwordless` enables sign-in with just the passkey (no password); leave
   * false to use the passkey only as a 2nd factor.
   */
  addWebAuthn: (params: { name: string; credential: unknown; passwordless?: boolean }) =>
    call('POST', '/account/authenticators/webauthn', params),

  /**
   * Remove one or more enrolled passkeys. allauth deletes the underlying
   * Authenticator rows; invalidates recovery codes if this was the last
   * factor. `ids` are the integer authenticator IDs from listAuthenticators().
   *
   * After this call succeeds the frontend should ALSO fire the WebAuthn
   * Signal API to tell the device's authenticator (Touch ID Keychain,
   * Windows Hello, etc.) to garbage-collect its local credential. See
   * `signalDeletedPasskey` in `lib/auth/passkey-signal.ts`.
   */
  deleteWebAuthn: (ids: number[]) =>
    call('DELETE', '/account/authenticators/webauthn', { authenticators: ids }),

  /**
   * Map of `{ [authenticator_pk]: base64url credentialId }` for the
   * current user's passkeys. Used by the Signal API path — allauth's own
   * authenticator list doesn't expose credential bytes, so we have a
   * tiny DRF endpoint that does.
   */
  passkeyCredentialIds: async (): Promise<Record<string, string>> => {
    const res = await fetch(`${API}/users/passkey-credential-ids/`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (!res.ok) return {}
    return (await res.json()) as Record<string, string>
  },

  // --- Email management ---
  /**
   * List the user's email addresses with `{ email, verified, primary }`.
   * The verified flag is the source of truth for the frontend's
   * verified-email gate — allauth's session response doesn't expose it.
   */
  listEmails: () => call('GET', '/account/email'),

  // --- Authenticator management (post-login) ---
  /** List enrolled authenticators (TOTP, recovery codes, WebAuthn). */
  listAuthenticators: () => call('GET', '/account/authenticators'),
  /** Start TOTP enrollment — returns { secret, totp_url } for QR rendering. */
  getTotpSetup: () => call('GET', '/account/authenticators/totp'),
  /** Finalize TOTP by submitting the first valid code. */
  activateTotp: (code: string) => call('POST', '/account/authenticators/totp', { code }),
  /** Remove TOTP. Recovery codes invalidate as a side effect. */
  deactivateTotp: () => call('DELETE', '/account/authenticators/totp'),
  /** List unused recovery codes. */
  listRecoveryCodes: () => call('GET', '/account/authenticators/recovery-codes'),
  /** Generate a fresh recovery code set (invalidates the old one). */
  generateRecoveryCodes: () => call('POST', '/account/authenticators/recovery-codes'),
}
