import { useState } from 'react'

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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
}: {
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
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
      <span className="text-muted-foreground w-9 text-right text-[11px] tabular-nums">
        {fmt(value)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={value}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-label="Seek"
        className="accent-primary h-1 flex-1 cursor-pointer"
      />
      <span className="text-muted-foreground w-9 text-[11px] tabular-nums">{fmt(duration)}</span>
    </div>
  )
}
