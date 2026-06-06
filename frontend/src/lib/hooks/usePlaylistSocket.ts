import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { playlistKeys } from '@/lib/hooks/keys'

// Same WS origin derivation as the room/notification sockets (prod connects to the
// backend's own domain via VITE_WS_BASE; dev derives same-origin ws://).
const WS_ORIGIN =
  (import.meta.env.VITE_WS_BASE as string | undefined) ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

/**
 * Subscribe to live edits of the playlist you're viewing. This is an EPHEMERAL
 * per-playlist channel (distinct from the durable per-user notification socket): any
 * viewer who can see the playlist joins `playlist.{id}` while on the page and gets a
 * content-less `playlist.changed` nudge when it's edited — then we refetch the
 * playlist (detail is a prefix of its tracks/collaborators/activity, so one
 * invalidation covers the whole view). So a public playlist updates live for anyone
 * watching, not just its owner/collaborators. Reconnects with capped backoff.
 */
export function usePlaylistSocket(playlistId: string | undefined, enabled = true) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled || !playlistId || !WS_ORIGIN) return

    let ws: WebSocket | null = null
    let closed = false
    let backoff = 1000
    let connectedOnce = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const refetch = () => void qc.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) })

    const connect = () => {
      ws = new WebSocket(`${WS_ORIGIN}/ws/playlists/${playlistId}/`)
      ws.onopen = () => {
        backoff = 1000
        // On a RE-connect we may have missed an edit while down → catch up.
        if (connectedOnce) refetch()
        connectedOnce = true
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type?: string }
          if (msg.type === 'playlist.changed') refetch()
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
  }, [playlistId, enabled, qc])
}
