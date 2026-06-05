import { useNavigate, useRouterState } from '@tanstack/react-router'

/**
 * Player view state lives in the URL via TanStack Router's native search params
 * (the root route declares `nowPlaying` + `queue` and retains them across
 * navigation). So opening the now-playing view / queue is linkable + survives a
 * refresh, and is just a search-param toggle on the *current* route — not a
 * navigation (`replace: true`, and closing clears the param). The router is the
 * single owner of URL state; no nuqs needed.
 */
type Flag = 'nowPlaying' | 'queue'

function useUrlFlag(key: Flag, viewTransition = false) {
  const value = useRouterState({
    select: (s) => Boolean((s.location.search as Record<string, unknown>)[key]),
  })
  const navigate = useNavigate()
  const setValue = (next: boolean | ((prev: boolean) => boolean)) =>
    navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => {
        const open = typeof next === 'function' ? next(Boolean(prev[key])) : next
        return { ...prev, [key]: open ? true : undefined } // undefined drops the param
      }) as never,
      replace: true,
      // Opt this search-only navigation into a View Transition. The router only
      // auto-transitions route (pathname) changes, so without this the overlay's
      // close (a `?nowPlaying` toggle) snaps instead of animating its
      // `::view-transition-*(full-screen-player)`.
      viewTransition,
    })
  return [value, setValue] as const
}

/** Full-screen "now playing" view open? (?nowPlaying=true) — linkable. View-transitioned
 *  so the overlay animates open/closed (incl. Back). */
export const useNowPlayingOpen = () => useUrlFlag('nowPlaying', true)

/** Queue panel open? (?queue=true) — retained across navigation. No view transition:
 *  the queue uses an always-mounted max-height transition that a snapshot would freeze. */
export const useQueueOpen = () => useUrlFlag('queue')
