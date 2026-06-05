import { useQuery } from '@tanstack/react-query'

import { auth } from '@/lib/auth/api'
import { authKeys, emailKeys, sessionKeys } from '@/lib/hooks/keys'

type AllAuthConfig = { socialaccount?: { providers?: { id: string; name: string }[] } }

/**
 * Public allauth config (never changes within a session). We use it to learn
 * which social providers are configured, so the "Continue with Google" button
 * only renders when Google credentials are actually set on the backend.
 */
export function useSocialProviders() {
  const query = useQuery({
    queryKey: authKeys.config(),
    queryFn: () => auth.config(),
    staleTime: Infinity,
    retry: false,
  })
  const config = query.data?.data as AllAuthConfig | undefined
  const providers = config?.socialaccount?.providers ?? []
  return { ...query, providers, hasGoogle: providers.some((p) => p.id === 'google') }
}

type ProviderAccount = { uid: string; provider: { id: string; name: string }; display: string }

/** Social accounts connected to the signed-in user (for the settings page). */
export function useProviderAccounts() {
  const query = useQuery({
    queryKey: authKeys.providers(),
    queryFn: () => auth.providerAccounts(),
    retry: false,
    staleTime: 60 * 1000,
  })
  const accounts = (query.data?.data as ProviderAccount[] | undefined) ?? []
  return { ...query, accounts, google: accounts.find((a) => a.provider.id === 'google') }
}

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
