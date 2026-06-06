import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
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

export type ProfileRelationship = {
  status: 'self' | 'none' | 'outgoing' | 'incoming' | 'friends'
  id?: string // the friendship id (for accept / cancel / unfriend), when one exists
}
export type PublicProfile = {
  id: string
  username: string
  display_name: string
  relationship: ProfileRelationship
}

/** A user's public profile + my relationship to them (drives the Add/Accept/Friends
 *  control). Idle for an empty username. */
export function useUserProfile(username: string | undefined) {
  return useQuery({
    queryKey: friendKeys.profile(username ?? ''),
    queryFn: username
      ? () => api<PublicProfile>(`/users/profile/${encodeURIComponent(username)}/`)
      : skipToken,
  })
}

type UserSearchPage = { count: number; next: string | null; results: FriendUser[] }

/** Find people by username/name to befriend. Infinite (25/page): the first page
 *  lands as you type, and more load only on scroll — low load by default. Idle for
 *  an empty query. */
export function useUserSearch(query: string) {
  const q = query.trim()
  return useInfiniteQuery({
    queryKey: friendKeys.search(q),
    queryFn: q
      ? ({ pageParam }) =>
          api<UserSearchPage>(`/users/search/?q=${encodeURIComponent(q)}&page=${pageParam}`)
      : skipToken,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
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
