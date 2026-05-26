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
  method: 'GET' | 'POST' | 'DELETE',
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
}
