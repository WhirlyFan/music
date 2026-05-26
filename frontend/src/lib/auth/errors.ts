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

/** Friendly fallback when something goes wrong outside the allauth response shape. */
export function friendlyAuthError(parsed: ParsedErrors, fallback = 'Login failed'): string {
  if (parsed.formMessages.length) return parsed.formMessages.join(' ')
  const allFieldMessages = Object.values(parsed.byField).flat()
  if (allFieldMessages.length) return allFieldMessages.join(' ')
  return fallback
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
