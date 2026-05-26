/**
 * MFA hooks — wrapping the allauth.mfa headless endpoints.
 *
 * Three groupings:
 *
 *  1. Enrollment list / status (useAuthenticators) — drives the /account/2fa
 *     overview page (what methods are enrolled, "remove" buttons).
 *
 *  2. TOTP enrollment (useTotpSetup + useActivateTotp + useDeactivateTotp).
 *     The setup endpoint returns the shared secret and an otpauth:// URL we
 *     render as a QR code; the user then submits the first code to confirm.
 *
 *  3. Recovery codes (useRecoveryCodes + useGenerateRecoveryCodes) — shown
 *     once on enrollment, regeneratable from the settings page.
 *
 * Login-time MFA challenge (after the password step) is NOT here — that
 * lives in useLogin / the login route, since it's part of the login flow.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { qk } from '@/lib/query/keys'
import { auth } from './api'

export function useAuthenticators() {
  return useQuery({
    queryKey: qk.authenticators,
    queryFn: () => auth.listAuthenticators(),
    staleTime: 60 * 1000,
  })
}

export function useTotpSetup() {
  return useQuery({
    queryKey: qk.totpSetup,
    queryFn: () => auth.getTotpSetup(),
    // Setup data is one-shot per enrollment — never cache stale secrets.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useActivateTotp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => auth.activateTotp(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.authenticators })
      qc.invalidateQueries({ queryKey: qk.totpSetup })
      // Activating TOTP usually mints recovery codes server-side.
      qc.invalidateQueries({ queryKey: qk.recoveryCodes })
    },
  })
}

export function useDeactivateTotp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.deactivateTotp(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.authenticators })
      qc.invalidateQueries({ queryKey: qk.recoveryCodes })
    },
  })
}

export function useRecoveryCodes() {
  return useQuery({
    queryKey: qk.recoveryCodes,
    queryFn: () => auth.listRecoveryCodes(),
    staleTime: 60 * 1000,
    retry: false,
  })
}

export function useGenerateRecoveryCodes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.generateRecoveryCodes(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.recoveryCodes }),
  })
}
