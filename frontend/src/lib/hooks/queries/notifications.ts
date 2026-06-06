import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

type NotificationPage = { count: number; results: AppNotification[] }

/** Recent notifications (first page). Refetched on a live `notification.new` nudge
 *  and on window focus, so the durable DB rows stay current without polling. */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => api<NotificationPage>('/notifications/'),
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

/** Mark notifications read — specific `ids`, or all when omitted. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api('/notifications/mark-read/', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all() }),
  })
}
