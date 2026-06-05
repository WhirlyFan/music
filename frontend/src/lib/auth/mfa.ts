/**
 * MFA hooks — wrapping the allauth.mfa headless endpoints.
 *
 * Three groupings:
 *
 *  1. Enrollment list / status (useAuthenticators) — drives the /account/mfa
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

import { mfaKeys } from '@/lib/hooks/keys'

import { auth } from './api'

export function useAuthenticators() {
  return useQuery({
    queryKey: mfaKeys.authenticators(),
    queryFn: () => auth.listAuthenticators(),
    staleTime: 60 * 1000,
  })
}

export function useTotpSetup() {
  return useQuery({
    queryKey: mfaKeys.totpSetup(),
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
    // Activating TOTP also mints recovery codes server-side, so invalidate
    // the whole MFA namespace in one call instead of three sibling keys.
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaKeys.all() }),
  })
}

export function useDeactivateTotp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.deactivateTotp(),
    // Removing TOTP invalidates recovery codes too — namespace-wide flush.
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaKeys.all() }),
  })
}

export function useRecoveryCodes() {
  return useQuery({
    queryKey: mfaKeys.recoveryCodes(),
    queryFn: () => auth.listRecoveryCodes(),
    staleTime: 60 * 1000,
    retry: false,
  })
}

export function useGenerateRecoveryCodes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auth.generateRecoveryCodes(),
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaKeys.recoveryCodes() }),
  })
}

/**
 * Reauthenticate the current user with their password. Required by allauth
 * before sensitive operations (adding a passkey). On success the session is
 * marked "fresh" for ~5 minutes; subsequent sensitive endpoints stop
 * returning the `reauthenticate` flow.
 */
export function useReauthenticate() {
  return useMutation({
    mutationFn: (password: string) => auth.reauthenticate(password),
  })
}

/**
 * Add a passkey / WebAuthn credential. The mutation takes the fully-formed
 * payload — caller is responsible for the browser dance (fetch options,
 * call navigator.credentials.create(), serialize the credential).
 */
export function useAddWebAuthn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { name: string; credential: unknown; passwordless?: boolean }) =>
      auth.addWebAuthn(params),
    // Adding a webauthn may mint recovery codes — flush the whole namespace.
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaKeys.all() }),
  })
}

/** Remove one or more enrolled passkeys by authenticator id. */
export function useDeleteWebAuthn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => auth.deleteWebAuthn(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: mfaKeys.all() }),
  })
}
