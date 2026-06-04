import { useQuery, useQueryClient } from '@tanstack/react-query'

import { uiKeys } from '@/lib/query/keys'

// NOTE: player open-state (queue / now-playing) lives in the URL — see
// lib/player-url-state.ts (TanStack Router search params). Measured player
// geometry is client state in a Zustand store — see lib/stores/player-ui.ts.

/**
 * Search text for a route, in the Query cache so a single persistent search pill
 * (mounted in the layout) and the page it serves share one value — no prop-drill,
 * and the pill never unmounts across navigation (so it doesn't flash). Keyed by
 * path so each page keeps its own term.
 */
export function useRouteSearch(path: string) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: uiKeys.search(path),
    queryFn: () => '',
    initialData: '',
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return { value: data, setValue: (v: string) => qc.setQueryData(uiKeys.search(path), v) }
}
