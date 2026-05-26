import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { qk } from '@/lib/query/keys'
import { auth } from './api'

export function useSession() {
  return useQuery({
    queryKey: qk.session,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { email: string; username: string; password: string }) =>
      auth.signup(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.logout(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
  })
}

/** Detect whether an allauth response is asking for the MFA step. */
export function isMfaChallenge(response: { status: number; data?: unknown } | undefined) {
  if (!response || response.status !== 401) return false
  const flows = (response.data as { flows?: Array<{ id: string; is_pending?: boolean }> })?.flows
  return Boolean(flows?.some((f) => f.id === 'mfa_authenticate' && f.is_pending))
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
  })
}
