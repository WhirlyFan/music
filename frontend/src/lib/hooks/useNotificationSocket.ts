import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { notificationKeys } from '@/lib/hooks/keys'

// Same WS origin derivation as the room socket (prod connects to the backend's own
// domain via VITE_WS_BASE; dev derives same-origin ws://).
const WS_ORIGIN =
  (import.meta.env.VITE_WS_BASE as string | undefined) ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

/**
 * A single GLOBAL socket for live events — independent of any room or page, so a
 * user is notified wherever they are in the app (mounted once in the root layout).
 * Frames carry no payload: on a nudge we invalidate the notification queries and
 * the durable rows are refetched from REST. Reconnects with capped backoff, and
 * refetches on every (re)connect to catch anything missed while disconnected.
 */
export function useNotificationSocket(enabled = true) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled || !WS_ORIGIN) return

    let ws: WebSocket | null = null
    let closed = false
    let backoff = 1000
    let retry: ReturnType<typeof setTimeout> | undefined

    const refetch = () => void qc.invalidateQueries({ queryKey: notificationKeys.all() })

    const connect = () => {
      ws = new WebSocket(`${WS_ORIGIN}/ws/notifications/`)
      ws.onopen = () => {
        backoff = 1000
        refetch() // catch up on anything that arrived while we were disconnected
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type?: string }
          if (msg.type === 'notification.new') refetch()
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = () => {
        if (closed) return
        retry = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 15000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [enabled, qc])
}
