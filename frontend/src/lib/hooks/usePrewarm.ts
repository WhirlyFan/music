import { useEffect, useRef } from 'react'

// Desktop-only: the local Rust engine exposes POST /prewarm on the same origin the
// SPA is served from (the 127.0.0.1 proxy). On the (dead) web build VITE_DESKTOP is
// unset and this whole hook is inert — the cloud has no local cache to warm.
const IS_DESKTOP = Boolean(import.meta.env.VITE_DESKTOP)

/**
 * Warm the upcoming tracks on the desktop ahead of time. The server computes what
 * plays next — the next up-next tracks plus the exact track a (seeded, deterministic)
 * shuffle would land on — and ships it on every room frame as `room.prewarm`. We hand
 * that list to the local engine, which resolves + fully caches each one in the
 * background, so a skip / auto-advance / shuffle starts from disk instantly instead of
 * paying the ~9s cold yt-dlp resolve.
 *
 * Fires only when the *set* of ids changes (the frame's array is fresh every heartbeat,
 * so we compare by value, not reference) — the engine no-ops anything already cached or
 * in flight, so a redundant post is cheap, but this keeps us from posting every tick.
 */
export function usePrewarm(videoIds: readonly string[] | undefined) {
  const key = (videoIds ?? []).join(',')
  const lastKey = useRef<string | null>(null)

  useEffect(() => {
    if (!IS_DESKTOP || !key || lastKey.current === key) return
    lastKey.current = key
    void fetch('/prewarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: key.split(',') }),
    }).catch(() => {
      // Best-effort: a failed prewarm just means the next track resolves on demand.
      // Clear the guard so the next identical frame retries.
      lastKey.current = null
    })
  }, [key])
}
