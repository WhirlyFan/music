import { useRouterState } from '@tanstack/react-router'
import { Moon, Save, Sun, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { routeHasFloatingSearch } from '@/components/layout/global-search-pill'
import { type GooeyItem, GooeyMenu } from '@/components/ui/gooey-menu'
import { isSessionAuthenticated } from '@/lib/auth/guards'
import { useSaveQueueAsPlaylist } from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useRoom } from '@/lib/hooks/queries/rooms'
import { promptText } from '@/lib/overlay'
import { useQueueOpen } from '@/lib/player-url-state'
import { usePlayerUiStore } from '@/lib/stores/player-ui'
import { useThemeStore } from '@/lib/theme/store'
import { useMediaQuery } from '@/lib/use-media-query'

const GAP = 8 // matches the player/queue/pill gaps
const PILL_H = 48 // the floating search pill is h-12

/**
 * Global bottom-right quick-actions FAB (gooey menu). Invite-a-friend + a theme
 * toggle are always present; Save-queue appears when something's queued. Authed-only.
 */
export function QuickActionsFab() {
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const { data: room } = useRoom(authed)
  const save = useSaveQueueAsPlaylist()
  const setInviteOpen = usePlayerUiStore((s) => s.setInviteOpen)
  const resolvedTheme = useThemeStore((s) => s.resolved)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const [queueOpen] = useQueueOpen()
  const queueHeight = usePlayerUiStore((s) => s.queueHeight)
  const playerHeight = usePlayerUiStore((s) => s.playerHeight)
  const path = useRouterState({ select: (s) => s.location.pathname })
  // Two breakpoints, because the pills are different widths: the player pill
  // (max 42rem) reaches the corner on a wider screen than the narrower search
  // pill (max 28rem). So there are three FAB heights as the screen narrows.
  const playerClearsCorner = useMediaQuery('(min-width: 820px)')
  const searchClearsCorner = useMediaQuery('(min-width: 600px)')

  if (!authed) return null

  // Theme lives here now that the top bar is gone: a sun/moon toggle, its icon
  // reflecting the current mode. (The logged-out theme control is the standalone
  // toggle in the root layout.)
  const isDark = resolvedTheme === 'dark'
  const ThemeIcon = isDark ? Moon : Sun

  const hasQueue = (room?.context?.length ?? 0) > 0
  const items: GooeyItem[] = [
    {
      icon: <UserPlus className="size-5" />,
      label: 'Invite a friend',
      onSelect: () => setInviteOpen(true),
    },
    ...(hasQueue
      ? [
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
    {
      icon: <ThemeIcon className="size-5" />,
      label: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      onSelect: toggleTheme,
    },
  ]

  // Hug the bottom-right corner, lifting only as much as the current width needs —
  // and clearing the open queue box, since that's what's actually stacked there.
  //   • The player pill (and the equally-wide queue) reach the corner below 820px →
  //     lift above the player + open queue.
  //   • The narrower search pill reaches below 600px → sit above it (which is above
  //     the player/queue stack when present, else just above the corner).
  // Heights track the player + queue measurements, so the FAB rides the queue
  // open/close (gaps + 280ms ease-out-quint match it).
  const playerShown = Boolean(room?.current)
  const searchShown = routeHasFloatingSearch(path)
  const playerStackTop = playerShown
    ? 16 + playerHeight + GAP + (queueOpen ? queueHeight + GAP : 0)
    : 16
  let bottom = 16 // corner
  if (playerShown && !playerClearsCorner) {
    bottom = playerStackTop // above the player + open queue
  }
  if (searchShown && !searchClearsCorner) {
    bottom = Math.max(bottom, playerStackTop + PILL_H + GAP) // above the search pill
  }

  return (
    <GooeyMenu
      items={items}
      className="ease-out-quint fixed right-4 z-50 transition-[bottom] duration-[280ms] motion-reduce:transition-none"
      style={{ bottom }}
    />
  )
}
