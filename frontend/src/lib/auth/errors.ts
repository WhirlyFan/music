/**
 * allauth headless errors arrive as `{ status, errors: [{ message, code, param? }] }`.
 * Our `auth.login` / `auth.signup` calls don't throw on non-200 — they return the
 * full response shape. This helper turns that into a human-readable list and a
 * map keyed by field name so forms can show inline errors plus a global summary.
 */
export type AllAuthErrorItem = {
  message: string
  code?: string
  param?: string
}

export type AllAuthErrorResponse = {
  status: number
  errors?: AllAuthErrorItem[]
}

export type ParsedErrors = {
  /** Field-name → list of messages. Empty object when no errors. */
  byField: Record<string, string[]>
  /** Errors not bound to a specific field (rare). */
  formMessages: string[]
}

export function parseAllAuthErrors(res: unknown): ParsedErrors {
  const errors = (
    res && typeof res === 'object' && 'errors' in res
      ? ((res as AllAuthErrorResponse).errors ?? [])
      : []
  ) as AllAuthErrorItem[]

  const byField: Record<string, string[]> = {}
  const formMessages: string[] = []
  for (const e of errors) {
    if (e.param) {
      ;(byField[e.param] ??= []).push(e.message)
    } else {
      formMessages.push(e.message)
    }
  }
  return { byField, formMessages }
}

/**
 * django-axes lockout response. Returned by AxesMiddleware (status 403)
 * when a user trips the failure limit. Shape:
 *   { failure_limit, username, cooloff_time, cooloff_timedelta }
 * Distinct from allauth's `{ status, errors: [...] }` envelope, so we
 * detect by presence of the lockout-specific keys.
 */
export type AxesLockoutResponse = {
  failure_limit: number
  username?: string
  cooloff_time?: string
  cooloff_timedelta?: string
}

export function isAxesLockout(res: unknown): res is AxesLockoutResponse {
  return !!res && typeof res === 'object' && 'failure_limit' in res && 'cooloff_time' in res
}

/**
 * Render the axes cooloff (an ISO-8601 duration like "PT1H") as something a
 * human can act on. We don't depend on a heavy date library here — only
 * hour-or-minute resolution is needed for the message we want to show.
 */
export function formatAxesCooloff(cooloffTime: string | undefined): string {
  if (!cooloffTime) return 'later'
  // ISO-8601 duration parser, narrow scope: PT<H>H<M>M<S>S.
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(cooloffTime)
  if (!m) return 'later'
  const [, h, min] = m
  if (h && Number(h) >= 1) return Number(h) === 1 ? 'in 1 hour' : `in ${h} hours`
  if (min && Number(min) >= 1) return Number(min) === 1 ? 'in 1 minute' : `in ${min} minutes`
  return 'shortly'
}

export function axesLockoutMessage(res: unknown): string | null {
  if (!isAxesLockout(res)) return null
  return `Too many failed attempts. Try again ${formatAxesCooloff(res.cooloff_time)}.`
}

/** Friendly fallback when something goes wrong outside the allauth response shape. */
export function friendlyAuthError(parsed: ParsedErrors, fallback = 'Login failed'): string {
  if (parsed.formMessages.length) return parsed.formMessages.join(' ')
  const allFieldMessages = Object.values(parsed.byField).flat()
  if (allFieldMessages.length) return allFieldMessages.join(' ')
  return fallback
}

/**
 * Banner-only message: returns a string ONLY if the failure isn't already
 * being shown inline under a specific field. Prevents duplication where the
 * inline error AND the top-of-form banner display the same text.
 *
 * Logic:
 *  - If allauth returned form-level errors (no `param`) → show those
 *  - Else if the response failed AND has zero parsed errors at all (e.g.
 *    network failure, 500 with no JSON body) → show the fallback
 *  - Else (field-level errors only) → return null — the inline UI is enough
 */
export function bannerError(
  res: { status: number; errors?: AllAuthErrorItem[] } | undefined,
  fallback: string,
): string | null {
  if (!res || res.status === 200) return null
  // django-axes lockout response has no `errors` array; surface its own
  // cooloff message instead of the generic fallback so the user knows
  // *why* they're stuck and *when* it ends.
  const lockoutMsg = axesLockoutMessage(res)
  if (lockoutMsg) return lockoutMsg
  const parsed = parseAllAuthErrors(res)
  if (parsed.formMessages.length) return parsed.formMessages.join(' ')
  if (parsed.formMessages.length === 0 && Object.keys(parsed.byField).length === 0) {
    return fallback
  }
  return null
}

/**
 * Extract a displayable string from a TanStack Form field-level error.
 *
 * TanStack Form's `field.state.meta.errors[i]` is whatever the validator
 * returned — a plain string for inline validators, OR a Zod issue object
 * `{ code, message, path, ... }` when a Zod schema is used as the
 * validator. Doing `String(...)` on the latter yields "[object Object]"
 * in the UI — this helper unwraps it safely.
 */
export function fieldErrorMessage(err: unknown): string | undefined {
  if (!err) return undefined
  if (typeof err === 'string') return err
  if (typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    return typeof m === 'string' ? m : undefined
  }
  return undefined
}
