import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { emailKeys, sessionKeys } from '@/lib/query/keys'

import { auth } from './api'

export type EmailAddress = { email: string; verified: boolean; primary: boolean }

export function useSession() {
  return useQuery({
    queryKey: sessionKeys.all(),
    queryFn: () => auth.session(),
    // session endpoint returns 401 when logged out — that's fine, not an error
    retry: false,
    // Auth state rarely changes mid-tab; invalidation fires on login/logout
    // mutations so the cache stays accurate when it matters.
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ identifier, password }: { identifier: string; password: string }) =>
      auth.login(identifier, password),
    // Flush ALL cached query data so the new user never inherits the previous
    // user's room/queue/playlists; every query (incl. the user-scoped room)
    // refetches fresh for this session. Mutations are untouched, so the
    // multi-step login/MFA flow (which reads mutation responses) keeps working.
    onSuccess: () => qc.removeQueries(),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { email: string; username: string; password: string }) =>
      auth.signup(params),
    onSuccess: () => qc.removeQueries(), // fresh session → flush any stale cached data
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.logout(),
    // Flush ALL cached data on logout so nothing belonging to the user lingers in
    // memory for whoever logs in next (room/queue, playlists, search, emails…).
    onSuccess: () => qc.removeQueries(),
  })
}

/**
 * Submit the user's TOTP / recovery code mid-login. Used when /auth/login
 * returns 401 with a `mfa_authenticate` flow — allauth tracks the pending
 * login server-side, this mutation completes it.
 */
export function useMfaAuthenticate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => auth.mfaAuthenticate(code),
    onSuccess: () => qc.removeQueries(), // completes login → flush stale cache for the new session
  })
}

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
 * Submit the trust decision. `true` mints the 30-day "remember this browser"
 * cookie and completes the login; `false` skips it but still completes the
 * login. Either way, after this the user is fully authenticated.
 */
export function useMfaTrust() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trust: boolean) => auth.mfaTrust(trust),
    onSuccess: () => qc.removeQueries(), // completes login → flush stale cache for the new session
  })
}

// ─── Email verification ──────────────────────────────────────────────────

/**
 * Consume the verification link's `key` and mark the email verified. On
 * success the user transitions from "unverified" to "verified" — invalidate
 * the session AND the email list so the verified-email gate re-evaluates.
 */
export function useVerifyEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => auth.verifyEmail(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.all() })
      qc.invalidateQueries({ queryKey: emailKeys.all() })
    },
  })
}

/**
 * Resend the verification email to the authenticated user's address.
 * Caller passes the email (read from the session payload).
 */
export function useResendEmailVerification() {
  return useMutation({
    mutationFn: (email: string) => auth.resendEmailVerification(email),
  })
}

/**
 * Request an email change. allauth adds the new (unverified) address and
 * sends it a verification link; the swap completes when the user clicks it.
 * Invalidate the email list so the pending address shows up in the UI.
 */
export function useChangeEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => auth.changeEmail(email),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailKeys.all() }),
  })
}

/**
 * Change the logged-in user's password. Requires the current password.
 * allauth keeps the session alive on success — no re-login needed.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string
      newPassword: string
    }) => auth.changePassword(currentPassword, newPassword),
  })
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

/**
 * Query the user's email addresses. Used by the verified-email gate +
 * any UI that needs to know which email is primary / verified.
 */
export function useEmails() {
  return useQuery({
    queryKey: emailKeys.list(),
    queryFn: () => auth.listEmails(),
    // Cheap endpoint, but the value rarely changes within a session.
    staleTime: 5 * 60 * 1000,
    // Returns 401 when unauthenticated — don't retry, that's expected.
    retry: false,
  })
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

// ─── Password reset ──────────────────────────────────────────────────────

/**
 * Request a reset email. allauth always responds 200 — no signal about
 * whether the email is registered. Keeps the form simple: submit + show
 * a "if your email is registered, you'll receive a link" confirmation.
 */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => auth.requestPasswordReset(email),
  })
}

/**
 * Complete the reset: submit `{ key, password }`. On success, allauth
 * logs the user in, so we invalidate the session query so the SPA picks
 * up the new auth state.
 */
export function useCompletePasswordReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, password }: { key: string; password: string }) =>
      auth.completePasswordReset(key, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.all() })
      qc.invalidateQueries({ queryKey: emailKeys.all() })
    },
  })
}
