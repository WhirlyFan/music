import { useQuery, useQueryClient } from '@tanstack/react-query'

import { uiKeys } from '@/lib/query/keys'

// `queueHeight` = the open queue panel's measured px height (0 when closed), so
// the playlists search pill can sit exactly above it on any screen size.
type PlayerUi = { queueOpen: boolean; queueHeight: number }
const DEFAULT: PlayerUi = { queueOpen: false, queueHeight: 0 }

/**
 * Ephemeral player UI state shared across components via the Query cache — a
 * client-only key with no fetcher. The player owns it (queue open + its measured
 * height); the playlists search pill reads it to slide up out of the way. One
 * source of truth, no prop-drilling and no global store.
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
  const set = (patch: Partial<PlayerUi>) =>
    qc.setQueryData<PlayerUi>(uiKeys.player(), (prev) => ({ ...(prev ?? DEFAULT), ...patch }))
  const setQueueOpen = (open: boolean | ((prev: boolean) => boolean)) =>
    qc.setQueryData<PlayerUi>(uiKeys.player(), (prev) => {
      const cur = prev ?? DEFAULT
      return { ...cur, queueOpen: typeof open === 'function' ? open(cur.queueOpen) : open }
    })
  const setQueueHeight = (queueHeight: number) => set({ queueHeight })
  return { queueOpen: data.queueOpen, queueHeight: data.queueHeight, setQueueOpen, setQueueHeight }
}
