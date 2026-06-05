import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useRoom } from '@/lib/hooks/queries/rooms'
import { useQueueOpen } from '@/lib/player-url-state'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

/**
 * The floating rounded search pill, shared by the playlists wall and a playlist's
 * detail page (each passes its own value/handler — playlists search titles, the
 * detail page searches that playlist's tracks). Fixed bottom-center so it lands in
 * the exact same spot everywhere. It sits just above the player (measured pill
 * height + the bottom-4/mb-2 offsets) and rises by the queue panel's measured
 * height when it opens — the queue is pre-measured and both use the same 280ms
 * ease-out-quint, so the pill and the queue open in lockstep.
 */
export function FloatingSearchPill({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  ariaLabel: string
}) {
  const { data: room } = useRoom()
  const [queueOpen] = useQueueOpen()
  const queueHeight = usePlayerUiStore((s) => s.queueHeight)
  const playerHeight = usePlayerUiStore((s) => s.playerHeight)
  const playerShown = Boolean(room?.current)
  // Sit 8px above the player (matching the queue↔seek-bar gap). When the queue is
  // open, rise above it by the queue height + the same 8px gap, so the pill clears
  // the queue box by the same amount the queue clears the seek bar.
  const bottom = playerShown ? 16 + playerHeight + 8 + (queueOpen ? queueHeight + 8 : 0) : 16

  return (
    <div
      className="ease-out-quint fixed left-1/2 z-30 w-[min(92%,28rem)] -translate-x-1/2 transition-[bottom] duration-[280ms] motion-reduce:transition-none"
      style={{ bottom }}
    >
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-background/80 h-12 rounded-full pr-4 pl-11 shadow-lg backdrop-blur"
        />
      </div>
    </div>
  )
}
