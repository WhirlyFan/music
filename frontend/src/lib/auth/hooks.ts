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
