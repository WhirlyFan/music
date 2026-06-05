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
      // Opt OUT of view transitions for these toggles (overriding the router's
      // defaultViewTransition). Both panels are always-mounted and animate via CSS
      // (opacity/transform / max-height); a VT snapshot would freeze that mid-animation.
      viewTransition,
    })
  return [value, setValue] as const
}

/** Full-screen "now playing" view open? (?nowPlaying=true) — linkable, survives refresh. */
export const useNowPlayingOpen = () => useUrlFlag('nowPlaying')

/** Queue panel open? (?queue=true) — retained across navigation. */
export const useQueueOpen = () => useUrlFlag('queue')
