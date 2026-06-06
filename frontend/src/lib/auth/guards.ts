/**
 * Auth-state detectors over allauth response shapes — pure helpers, not hooks.
 * The auth query/mutation hooks live in `@/lib/hooks/queries/auth` and
 * `@/lib/hooks/mutations/auth`; these read the responses those return.
 */

export type EmailAddress = { email: string; verified: boolean; primary: boolean }

/** Detect whether an allauth response is asking for the MFA step. */
export function isMfaChallenge(response: { status: number; data?: unknown } | undefined) {
  if (!response || response.status !== 401) return false
  const flows = (response.data as { flows?: Array<{ id: string; is_pending?: boolean }> })?.flows
  return Boolean(flows?.some((f) => f.id === 'mfa_authenticate' && f.is_pending))
}

/**
 * Detect the "you just signed up, please verify your email" pending flow.
 *
 * allauth's `signup` and `login` endpoints both return 401 + a pending
 * `verify_email` flow when the user has signed up but not yet clicked
 * the link in their email. The frontend treats this as a successful
 * signup/login (the session IS tracked by allauth even though
 * `meta.is_authenticated` is false) and routes the user to the holding
 * page where they can resend.
 */
export function isEmailVerificationPending(
  response: { status?: number; data?: unknown } | undefined,
): boolean {
  if (!response) return false
  const flows = (response.data as { flows?: Array<{ id?: string; is_pending?: boolean }> })?.flows
  return Boolean(flows?.some((f) => f.id === 'verify_email' && f.is_pending))
}

/**
 * Detect the "remember this browser" stage. After a successful MFA code
 * submit (when MFA_TRUST_ENABLED on the backend) the session response carries
 * a `mfa_trust` flow with `is_pending: true`. UI then prompts the user to
 * trust this browser for `MFA_TRUST_COOKIE_AGE` (30 days in our settings).
 */
export function isMfaTrustPending(response: { status?: number; data?: unknown } | undefined) {
  if (!response) return false
  const flows = (response.data as { flows?: Array<{ id?: string; is_pending?: boolean }> })?.flows
  return Boolean(flows?.some((f) => f.id === 'mfa_trust' && f.is_pending))
}

/**
 * Whether the response from `GET /_allauth/browser/v1/auth/session` shows
 * an authenticated user. allauth doesn't expose verification status here —
 * use `hasVerifiedPrimaryEmail` against the email list endpoint for that.
 */
export function isSessionAuthenticated(response: { meta?: unknown } | undefined): boolean {
  if (!response) return false
  const meta = response.meta as { is_authenticated?: boolean } | undefined
  return Boolean(meta?.is_authenticated)
}

/** The signed-in user's email from a session response, or null. */
export function sessionEmail(response: { data?: unknown } | undefined): string | null {
  const user = (response?.data as { user?: { email?: string } } | undefined)?.user
  return user?.email ?? null
}

/** The signed-in user's id (uuid7) from a session response, or null. Used to
 *  tell host from guest in a jam (compare to room.host_id / members[].user_id). */
export function sessionUserId(response: { data?: unknown } | undefined): string | null {
  const user = (response?.data as { user?: { id?: string } } | undefined)?.user
  return user?.id ?? null
}

/**
 * Whether the user has at least one verified email. Returns false when the
 * data is missing (unauthenticated or load error) — the gate is "block until
 * we positively confirm verified", which is the safer default.
 *
 * Mirrors the backend's check:
 *   EmailAddress.objects.filter(user=user, verified=True).exists()
 */
export function hasVerifiedPrimaryEmail(
  response: { status?: number; data?: unknown } | undefined,
): boolean {
  if (!response || response.status !== 200) return false
  const emails = response.data as EmailAddress[] | undefined
  if (!Array.isArray(emails)) return false
  return emails.some((e) => e.verified)
}
