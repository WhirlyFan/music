import { useRouterState } from '@tanstack/react-router'

import { FloatingSearchPill } from '@/components/ui/floating-search-pill'
import { useRouteSearch } from '@/lib/query/ui'

const DETAIL_RE = /^\/playlists\/[^/]+$/

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

  const mode = path === '/playlists' ? 'list' : DETAIL_RE.test(path) ? 'detail' : null
  if (!mode) return null

  return (
    <FloatingSearchPill
      value={value}
      onChange={setValue}
      placeholder={mode === 'list' ? 'Search playlists' : 'Search this playlist'}
      ariaLabel={mode === 'list' ? 'Search your playlists' : 'Search this playlist'}
    />
  )
}
