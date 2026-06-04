import { useQuery, useQueryClient } from '@tanstack/react-query'

import { uiKeys } from '@/lib/query/keys'

type PlayerUi = { queueOpen: boolean }
const DEFAULT: PlayerUi = { queueOpen: false }

/**
 * Ephemeral player UI state (is the queue panel open) shared across components
 * via the Query cache — a client-only key with no fetcher. The player toggles
 * it; the playlists search pill reads it to slide up out of the way. One source
 * of truth, no prop-drilling and no global store.
 */
export function usePlayerUi() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: uiKeys.player(),
    queryFn: () => DEFAULT,
    initialData: DEFAULT,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const setQueueOpen = (open: boolean | ((prev: boolean) => boolean)) =>
    qc.setQueryData<PlayerUi>(uiKeys.player(), (prev) => {
      const cur = prev ?? DEFAULT
      return { ...cur, queueOpen: typeof open === 'function' ? open(cur.queueOpen) : open }
    })
  return { queueOpen: data.queueOpen, setQueueOpen }
}
