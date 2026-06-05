import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { auth } from '@/lib/auth/api'
import { emailKeys, playlistKeys, roomKeys, sessionKeys } from '@/lib/hooks/keys'

/** Invite an email to the (invite-only) platform — any logged-in member can.
 *  The backend creates a pending invitation and emails the signup link. */
export function useInvite() {
  return useMutation({
    mutationFn: (email: string) =>
      api<{ email: string }>('/users/invite/', { method: 'POST', body: { email } }),
  })
}

/**
 * Reset cache for an auth boundary (login/signup/logout/MFA-complete). Session +
 * email are *invalidated* (refetched) — keeping the auth-state observers mounted so
 * the `authed` gating that shows the player keeps working. The previous user's data
 * (room/queue, playlists, song search, per-route search text) is *removed* so the
 * next session never inherits it and refetches fresh. Prefix keys match sub-queries.
 */
function resetForSession(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: sessionKeys.all() })
  qc.invalidateQueries({ queryKey: emailKeys.all() })
  qc.removeQueries({ queryKey: roomKeys.all() })
  qc.removeQueries({ queryKey: playlistKeys.all() })
  qc.removeQueries({ queryKey: ['search'] })
  qc.removeQueries({ queryKey: ['ui'] })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ identifier, password }: { identifier: string; password: string }) =>
      auth.login(identifier, password),
    onSuccess: () => resetForSession(qc),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { email: string; username: string; password: string }) =>
      auth.signup(params),
    onSuccess: () => resetForSession(qc),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.logout(),
    onSuccess: () => resetForSession(qc),
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
    onSuccess: () => resetForSession(qc),
  })
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
    onSuccess: () => resetForSession(qc),
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
