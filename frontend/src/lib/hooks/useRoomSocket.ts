import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { Room } from '@/lib/api/models'
import { roomKeys } from '@/lib/hooks/keys'

// WebSocket origin. In prod the SPA (music.whirlyfan.com) connects straight to
// the backend's own domain (api.whirlyfan.com) because Render static sites don't
// proxy WS — set VITE_WS_BASE there. In dev it's unset, so we derive the
// same-origin ws:// URL and nginx routes /ws/ to the backend.
const WS_ORIGIN =
  (import.meta.env.VITE_WS_BASE as string | undefined) ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

/**
 * Subscribe to live room updates over WebSocket. Every frame is a FULL room
 * snapshot; we drop stale frames by `generation` and feed the rest into the same
 * TanStack Query cache the REST mutations seed (`roomKeys.me()`), so a change
 * made by anyone in the jam appears here with no refetch — and the existing
 * player just re-renders off the updated cache.
 *
 * Reconnects with capped backoff: the free-tier backend sleeps when idle, and
 * the first reconnect attempt is what wakes it.
 */
export function useRoomSocket(roomId: string | undefined, enabled = true) {
  const qc = useQueryClient()
  const lastGen = useRef(0)

  useEffect(() => {
    if (!enabled || !roomId || !WS_ORIGIN) return
    // New room → fresh generation series; don't let a previous room's counter
    // suppress this one's frames.
    lastGen.current = 0

    let ws: WebSocket | null = null
    let closed = false
    let backoff = 1000
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      ws = new WebSocket(`${WS_ORIGIN}/ws/rooms/${roomId}/`)
      ws.onopen = () => {
        backoff = 1000
      }
      ws.onmessage = (e) => {
        let msg: { type?: string; room?: Room; generation?: number }
        try {
          msg = JSON.parse(e.data as string)
        } catch {
          return
        }
        if (msg.type !== 'room.update' || !msg.room) return
        const gen = msg.generation ?? 0
        if (gen < lastGen.current) return // older than what we've already applied
        lastGen.current = gen
        qc.setQueryData(roomKeys.me(), msg.room)
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
  }, [roomId, enabled, qc])
}
