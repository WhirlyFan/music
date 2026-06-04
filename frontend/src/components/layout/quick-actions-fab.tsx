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
  // Wide enough that the centered player pill (max 42rem) can't reach the corner.
  const roomy = useMediaQuery('(min-width: 820px)')

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

  // Stay in the bottom-right corner; but the moment the bottom is wide enough that
  // the centered player/search pills reach the corner (narrow screens), lift the
  // FAB above whatever's stacked there — the search pill if this route shows one,
  // else the player pill. Same gaps + 280ms ease-out-quint as the queue, so it
  // rides up in sync when the queue opens.
  const playerShown = Boolean(room?.current)
  const searchShown = SEARCH_ROUTE_RE.test(path)
  let bottom = 16 // bottom-4 corner
  if (!roomy) {
    if (searchShown) {
      const searchBottom = playerShown
        ? 16 + playerHeight + GAP + (queueOpen ? queueHeight + GAP : 0)
        : 16
      bottom = searchBottom + PILL_H + GAP
    } else if (playerShown) {
      bottom = 16 + playerHeight + GAP
    }
  }

  return (
    <GooeyMenu
      items={items}
      className="fixed right-4 z-50 transition-[bottom] duration-[280ms] ease-out-quint motion-reduce:transition-none"
      style={{ bottom }}
    />
  )
}
