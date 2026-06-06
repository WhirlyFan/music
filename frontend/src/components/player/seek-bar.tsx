import { useState } from 'react'

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  // Show hours for long videos (a 24h stream would read as 1477 *minutes* otherwise).
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Seek bar with instant client-side scrubbing: while dragging, the thumb follows
 * a local value (no audio seek, no network) so it never lags behind the pointer;
 * we commit a single seek on release. The parent's onSeek should set currentTime
 * optimistically so the thumb doesn't snap back while the stream buffers.
 */
export function SeekBar({
  currentTime,
  duration,
  onSeek,
  disabled = false,
}: {
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
  // Read-only progress (no scrubbing): a passive jam guest follows the host's
  // playhead and can't seek. The bar still shows the live position.
  disabled?: boolean
}) {
  const [scrub, setScrub] = useState<number | null>(null)
  const value = scrub ?? Math.min(currentTime, duration || 0)

  const commit = () => {
    if (scrub !== null) {
      onSeek(scrub)
      setScrub(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground min-w-9 text-right text-[11px] tabular-nums">
        {fmt(value)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={value}
        disabled={disabled}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-label="Seek"
        className={`accent-primary h-1 flex-1 ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
      />
      <span className="text-muted-foreground min-w-9 text-[11px] tabular-nums">
        {fmt(duration)}
      </span>
    </div>
  )
}
