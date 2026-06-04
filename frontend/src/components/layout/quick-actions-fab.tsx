import { useNavigate } from '@tanstack/react-router'
import { Import, Save, Shuffle } from 'lucide-react'
import { toast } from 'sonner'

import { GooeyMenu, type GooeyItem } from '@/components/ui/gooey-menu'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { promptText } from '@/lib/overlay'
import { useRoom, useSaveQueueAsPlaylist, useShuffle } from '@/lib/query/rooms'

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

  return <GooeyMenu items={items} className="fixed right-4 bottom-4 z-50" />
}
