import { useQuery, useQueryClient } from '@tanstack/react-query'

import { uiKeys } from '@/lib/query/keys'

// Measured player geometry (px), published so the playlists search pill can sit
// exactly above the player + its queue on any screen. `playerHeight` = the pill
// row; `queueHeight` = the queue panel, which animates 0→full as it opens, so the
// search pill (reading it every frame) rides the queue in lockstep.
type PlayerUi = { queueOpen: boolean; queueHeight: number; playerHeight: number }
const DEFAULT: PlayerUi = { queueOpen: false, queueHeight: 0, playerHeight: 0 }

/**
 * Ephemeral player UI state shared across components via the Query cache — a
 * client-only key with no fetcher. The player owns it (queue open + measured
 * geometry); the playlists search pill reads it to sit above the player. One
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
  return {
    queueOpen: data.queueOpen,
    queueHeight: data.queueHeight,
    playerHeight: data.playerHeight,
    setQueueOpen,
    setQueueHeight: (queueHeight: number) => set({ queueHeight }),
    setPlayerHeight: (playerHeight: number) => set({ playerHeight }),
  }
}

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
