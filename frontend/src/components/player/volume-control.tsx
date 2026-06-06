import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

/** Mute toggle + level slider for the <audio> element's volume (0–1). The icon
 *  click mutes/unmutes (restoring the prior level); the slider sets the level. */
export function VolumeControl({
  volume,
  onVolumeChange,
  className,
}: {
  volume: number
  onVolumeChange: (v: number) => void
  className?: string
}) {
  const prev = useRef(volume || 1) // last non-zero level, to restore on unmute
  const muted = volume === 0
  const Icon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => onVolumeChange(muted ? prev.current || 1 : 0)}
        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
      >
        <Icon className="size-5" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (v > 0) prev.current = v
          onVolumeChange(v)
        }}
        aria-label="Volume"
        className="accent-primary h-1 w-full cursor-pointer"
      />
    </div>
  )
}
