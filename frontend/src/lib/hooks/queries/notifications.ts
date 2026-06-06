import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { notificationKeys } from '@/lib/hooks/keys'

export type AppNotification = {
  id: string
  kind: 'jam_join' | (string & {})
  actor_username: string | null
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

type NotificationPage = { count: number; next: string | null; results: AppNotification[] }

/** The caller's notifications, paginated 5/page so the bell shows ~5 and
 *  infinite-scrolls for more. Refetched on a live `notification.new` nudge + focus. */
export function useNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => api<NotificationPage>(`/notifications/?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled,
  })
}

/** Unread count for the bell badge — cheap; the source of truth for the badge. */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => api<{ count: number }>('/notifications/unread-count/'),
    enabled,
  })
}

/** Mark notifications read — specific `ids`, or all unread EXCEPT `excludeKinds`
 *  (so "mark all read" clears informational ones across every page while leaving
 *  actionable invites pending), or all when given nothing. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (arg?: { ids?: string[]; excludeKinds?: string[] }) =>
      api('/notifications/mark-read/', {
        method: 'POST',
        body: {
          ...(arg?.ids ? { ids: arg.ids } : {}),
          ...(arg?.excludeKinds ? { exclude_kinds: arg.excludeKinds } : {}),
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all() }),
  })
}

/** Dismiss one notification — used to consume an actioned item (e.g. after
 *  accepting/declining a request) so it leaves the list instead of lingering. */
export function useDismissNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all() }),
  })
}
