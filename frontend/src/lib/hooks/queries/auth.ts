import { useQuery } from '@tanstack/react-query'

import { auth } from '@/lib/auth/api'
import { emailKeys, sessionKeys } from '@/lib/hooks/keys'

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
