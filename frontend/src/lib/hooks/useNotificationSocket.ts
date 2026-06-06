import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { friendKeys, notificationKeys, playlistKeys } from '@/lib/hooks/keys'

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

    const invalidate = (key: readonly unknown[]) => void qc.invalidateQueries({ queryKey: key })

    const connect = () => {
      ws = new WebSocket(`${WS_ORIGIN}/ws/notifications/`)
      ws.onopen = () => {
        backoff = 1000
        // On (re)connect we may have missed events while down — refetch broadly so
        // the bell AND the domain lists (friends, playlists) catch up.
        invalidate(notificationKeys.all())
        invalidate(friendKeys.all())
        invalidate(playlistKeys.all())
      }
      ws.onmessage = (e) => {
        let msg: { type?: string; kind?: string; payload?: Record<string, unknown> }
        try {
          msg = JSON.parse(e.data as string)
        } catch {
          return // ignore malformed frames
        }
        if (msg.type !== 'notification.new') return
        // Always refresh the bell.
        invalidate(notificationKeys.all())
        // Then the exact domain cache the event changed, so an open friends list or
        // collaborators list updates live (e.g. pending → accepted) on the OTHER
        // client — the kind + payload ride along on the nudge for this.
        const kind = msg.kind ?? ''
        const payload = msg.payload ?? {}
        if (kind.startsWith('friend')) {
          invalidate(friendKeys.all())
        }
        if (kind.startsWith('playlist')) {
          const pid = typeof payload.playlist_id === 'string' ? payload.playlist_id : null
          // detail(id) is a prefix of collaborators/activity/tracks → one call covers
          // the whole playlist view; fall back to the broad key if no id rode along.
          invalidate(pid ? playlistKeys.detail(pid) : playlistKeys.all())
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
