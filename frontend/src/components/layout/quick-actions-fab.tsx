import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Import, Save, Shuffle } from 'lucide-react'
import { toast } from 'sonner'

import { GooeyMenu, type GooeyItem } from '@/components/ui/gooey-menu'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { promptText } from '@/lib/overlay'
import { useRoom, useSaveQueueAsPlaylist, useShuffle } from '@/lib/query/rooms'
import { usePlayerUi } from '@/lib/query/ui'
import { useMediaQuery } from '@/lib/use-media-query'

const SEARCH_ROUTE_RE = /^\/playlists(\/[^/]+)?$/ // routes that show the floating search pill
const GAP = 8 // matches the player/queue/pill gaps
const PILL_H = 48 // the floating search pill is h-12

/**
 * Global bottom-right quick-actions FAB (gooey menu). Import is always offered;
 * Shuffle + Save-queue appear when something's queued. Authed-only.
 */
export function QuickActionsFab() {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const { data: room } = useRoom(authed)
  const shuffle = useShuffle()
  const save = useSaveQueueAsPlaylist()
  const { queueOpen, queueHeight, playerHeight } = usePlayerUi()
  const path = useRouterState({ select: (s) => s.location.pathname })
  // Two breakpoints, because the pills are different widths: the player pill
  // (max 42rem) reaches the corner on a wider screen than the narrower search
  // pill (max 28rem). So there are three FAB heights as the screen narrows.
  const playerClearsCorner = useMediaQuery('(min-width: 820px)')
  const searchClearsCorner = useMediaQuery('(min-width: 600px)')

  if (!authed) return null

  const hasQueue = (room?.context?.length ?? 0) > 0
  const items: GooeyItem[] = [
    {
      icon: <Import className="size-5" />,
      label: 'Import a playlist',
      onSelect: () => navigate({ to: '/' }),
    },
    ...(hasQueue
      ? [
          {
            icon: <Shuffle className="size-5" />,
            label: 'Shuffle queue',
            onSelect: () => shuffle.mutate(),
          },
          {
            icon: <Save className="size-5" />,
            label: 'Save queue as playlist',
            onSelect: async () => {
              const title = await promptText({
                title: 'Save queue as playlist',
                label: 'Playlist name',
                confirmLabel: 'Save playlist',
              })
              if (title)
                save.mutate(title, { onSuccess: () => toast.success('Saved to your playlists.') })
            },
          },
        ]
      : []),
  ]

  // Three heights, each still hugging the right edge, lifting only as much as the
  // current width actually needs (gaps + 280ms ease-out-quint match the queue):
  //   1. corner — nothing reaches the corner;
  //   2. above the player pill — the wide player pill reaches it, the search pill
  //      doesn't (it's narrower, so it only reaches on an even smaller screen);
  //   3. above the search pill — the search pill reaches the lifted FAB too.
  const playerShown = Boolean(room?.current)
  const searchShown = SEARCH_ROUTE_RE.test(path)
  const searchBottom = playerShown
    ? 16 + playerHeight + GAP + (queueOpen ? queueHeight + GAP : 0)
    : 16
  let bottom = 16 // 1) corner
  if (searchShown && !searchClearsCorner) {
    bottom = searchBottom + PILL_H + GAP // 3) above the search pill
  } else if (playerShown && !playerClearsCorner) {
    bottom = 16 + playerHeight + GAP // 2) above the player pill
  }

  return (
    <GooeyMenu
      items={items}
      className="fixed right-4 z-50 transition-[bottom] duration-[280ms] ease-out-quint motion-reduce:transition-none"
      style={{ bottom }}
    />
  )
}
