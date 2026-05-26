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

export const auth = {
  session: () => call('GET', '/auth/session'),

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
   * Resend the verification email to the in-progress signup user. Only
   * works during an unverified session — allauth uses the session's
   * pending-email-verification flow.
   */
  resendEmailVerification: () => call('PUT', '/auth/email/verify'),

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
