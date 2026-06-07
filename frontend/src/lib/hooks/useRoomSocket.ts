import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

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
 *
 * Returns `reportReady(generation)` — the synced-start readiness signal. When a
 * shared room parks a freshly-chosen track (`pending_start`), each node calls this
 * once its audio is buffered; the server starts the track when every present node
 * is ready (or a deadline passes). It's the only client→server message besides the
 * keepalive, and it never *commands* playback — it only accelerates a start the
 * server was already going to make.
 */
export function useRoomSocket(
  roomId: string | undefined,
  enabled = true,
  myUserId: string | null = null,
) {
  const qc = useQueryClient()
  const lastGen = useRef(0)
  const lastContextVersion = useRef<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const reportReady = useCallback((generation: number) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ready', generation }))
    }
  }, [])

  useEffect(() => {
    if (!enabled || !roomId || !WS_ORIGIN) return
    // New room → fresh generation series; don't let a previous room's counter
    // suppress this one's frames.
    lastGen.current = 0
    lastContextVersion.current = null

    let ws: WebSocket | null = null
    let closed = false
    let backoff = 1000
    let connectedOnce = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      ws = new WebSocket(`${WS_ORIGIN}/ws/rooms/${roomId}/`)
      wsRef.current = ws
      ws.onopen = () => {
        backoff = 1000
        // On a RE-connect we missed every broadcast while the socket was down, so
        // our cached room is stale (this is the "refreshed and the song was stuck"
        // case). Refetch the authoritative state to catch up. (Skipped on the first
        // connect — useRoom just fetched.)
        if (connectedOnce) {
          void qc.invalidateQueries({ queryKey: roomKeys.me() })
          void qc.invalidateQueries({ queryKey: roomKeys.context() })
        }
        connectedOnce = true
      }
      ws.onmessage = (e) => {
        let msg: { type?: string; room?: Room; generation?: number }
        try {
          msg = JSON.parse(e.data as string)
        } catch {
          return
        }
        // The host kicked me → fall back to my own room (refetch /rooms/current/,
        // which now resolves there, and the socket re-subscribes).
        if (msg.type === 'membership.revoked') {
          void qc.invalidateQueries({ queryKey: roomKeys.me() })
          return
        }
        if (msg.type !== 'room.update' || !msg.room) return
        const gen = msg.generation ?? 0
        if (gen < lastGen.current) return // older than what we've already applied
        lastGen.current = gen
        qc.setQueryData(roomKeys.me(), msg.room)
        // The context LIST (not just the head) changed — host shuffled / played a
        // new playlist — so refetch the cached full list. Skipped on play/pause/seek
        // frames, which carry an unchanged context_version.
        const cv = msg.room.context_version ?? null
        if (
          cv !== null &&
          lastContextVersion.current !== null &&
          cv !== lastContextVersion.current
        ) {
          void qc.invalidateQueries({ queryKey: roomKeys.context() })
        }
        lastContextVersion.current = cv
        // The jam I'm a guest in just ended (host unshared) → fall back too.
        if (myUserId && msg.room.host_id !== myUserId && !msg.room.is_shared) {
          void qc.invalidateQueries({ queryKey: roomKeys.me() })
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
      wsRef.current = null
    }
  }, [roomId, enabled, qc, myUserId])

  return { reportReady }
}
