import { useSyncExternalStore } from 'react'

/**
 * Reactively read a CSS media query. Uses useSyncExternalStore (matchMedia is an
 * external store) — no effect, no state-sync. `getSnapshot` runs on the client so
 * the first render already has the right value (no flash); the SSR snapshot is
 * unused here (Vite SPA).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
