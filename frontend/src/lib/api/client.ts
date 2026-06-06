/**
 * Thin fetch wrapper. Same-origin (via the nginx reverse proxy in prod, via
 * Vite's dev proxy in dev), so session cookies + CSRF "just work".
 *
 * Request bodies and responses are typed from `./types.ts`, which is generated
 * from the backend's OpenAPI schema by `pnpm gen:api`.
 */
const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api/v1'

type FetchOptions = Omit<RequestInit, 'body'> & { body?: unknown }

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

/**
 * Ensure a csrftoken cookie exists before a state-changing request. Hits the
 * allauth session endpoint (which goes through CsrfViewMiddleware) — cheap.
 */
async function ensureCsrfCookie(): Promise<void> {
  if (getCookie('csrftoken')) return
  await fetch('/_allauth/browser/v1/auth/session', {
    method: 'GET',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
}

export async function api<T = unknown>(
  path: string,
  { body, method = 'GET', headers, ...rest }: FetchOptions & { method?: string } = {},
): Promise<T> {
  if (method !== 'GET' && method !== 'HEAD') {
    await ensureCsrfCookie()
  }
  const csrf = getCookie('csrftoken')

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail: unknown
    try {
      detail = await res.json()
    } catch {
      detail = await res.text()
    }
    // Belt-and-suspenders for the email-verification gate. The root-route
    // guard catches the 99% case (unverified session detected on load). This
    // handles the edge: a previously-verified session that the backend has
    // since unverified (e.g. admin action). Hard redirect — the SPA's
    // entire visible-state assumption (verified user) is invalid.
    if (
      res.status === 403 &&
      typeof detail === 'object' &&
      detail !== null &&
      (detail as { detail?: string }).detail === 'email_verification_required'
    ) {
      window.location.assign('/account/verify-email')
    }
    throw new ApiError(res.status, res.statusText, detail)
  }

  // 204 No Content — or any empty body (e.g. a 200/201 with nothing to return, like
  // an action endpoint that just succeeds). Parsing "" as JSON would throw and turn a
  // successful call into a rejected mutation, so read text and only parse if present.
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export class ApiError extends Error {
  status: number
  statusText: string
  detail: unknown
  constructor(status: number, statusText: string, detail: unknown) {
    super(`${status} ${statusText}`)
    this.status = status
    this.statusText = statusText
    this.detail = detail
  }
}
