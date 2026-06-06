import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { friendKeys, notificationKeys } from '@/lib/hooks/keys'

// These shapes aren't in the generated OpenAPI models yet; mirror the backend
// serializers (apps/friends/serializers.py, apps/users search) inline — same
// pattern as notifications.ts.
export type FriendUser = { id: string; username: string; display_name: string }
export type Friendship = {
  id: string
  status: 'pending' | 'accepted'
  requester: FriendUser
  addressee: FriendUser
  created_at: string
}
type RequestsPayload = { incoming: Friendship[]; outgoing: Friendship[] }

/** Accepted friends. */
export function useFriends(enabled = true) {
  return useQuery({
    queryKey: friendKeys.list(),
    queryFn: () => api<Friendship[]>('/friends/'),
    enabled,
  })
}

/** Pending requests, split incoming/outgoing. */
export function useFriendRequests(enabled = true) {
  return useQuery({
    queryKey: friendKeys.requests(),
    queryFn: () => api<RequestsPayload>('/friends/requests/'),
    enabled,
  })
}

/** Find people by username/name to befriend; idle for an empty query. */
export function useUserSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: friendKeys.search(q),
    queryFn: q ? () => api<FriendUser[]>(`/users/search/?q=${encodeURIComponent(q)}`) : skipToken,
    placeholderData: keepPreviousData,
  })
}

// Friend mutations all touch the same surface (lists + requests) AND can produce
// a notification (accept), so they invalidate both key trees on success.
function useFriendMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: friendKeys.all() })
      void qc.invalidateQueries({ queryKey: notificationKeys.all() })
    },
  })
}

export function useSendFriendRequest() {
  return useFriendMutation((userId: string) =>
    api('/friends/request/', { method: 'POST', body: { user_id: userId } }),
  )
}

export function useAcceptFriend() {
  return useFriendMutation((id: string) => api(`/friends/${id}/accept/`, { method: 'POST' }))
}

export function useDeclineFriend() {
  return useFriendMutation((id: string) => api(`/friends/${id}/decline/`, { method: 'POST' }))
}

/** Unfriend, or cancel an outgoing request. */
export function useRemoveFriend() {
  return useFriendMutation((id: string) => api(`/friends/${id}/`, { method: 'DELETE' }))
}
