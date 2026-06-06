import { useRouterState } from '@tanstack/react-router'

import { FloatingSearchPill } from '@/components/ui/floating-search-pill'
import { useRouteSearch } from '@/lib/hooks/queries/ui'

const LIST_PATH = '/playlists'
const DETAIL_RE = /^\/playlists\/[^/]+$/

/**
 * Single source of truth for which routes render the floating search pill — so
 * anything that needs to position around it (e.g. the quick-actions FAB) stays in
 * sync with where the pill actually appears, instead of duplicating the routes.
 */
export function routeHasFloatingSearch(path: string): boolean {
  return path === LIST_PATH || DETAIL_RE.test(path)
}

/**
 * One persistent search pill mounted in the layout — it never unmounts across
 * navigation, so the shell stays put and only the text/placeholder change (no
 * flash). It reads the current route to decide what it searches: the playlists
 * wall (titles) or a playlist's detail page (that playlist's tracks). The value
 * lives in a route-keyed cache the matching page reads to drive its query.
 */
export function GlobalSearchPill() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { value, setValue } = useRouteSearch(path)

  const mode = path === LIST_PATH ? 'list' : DETAIL_RE.test(path) ? 'detail' : null
  if (!mode) return null

  return (
    <FloatingSearchPill
      value={value}
      onChange={setValue}
      placeholder={mode === 'list' ? 'search playlists' : 'search this playlist'}
      ariaLabel={mode === 'list' ? 'Search your playlists' : 'Search this playlist'}
    />
  )
}
