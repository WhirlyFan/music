import { cn } from '@/lib/utils'

/**
 * Animated open/close that also reflows its siblings — the same model as the queue
 * panel in `now-playing-bar` (always mounted, height animates, `inert` while closed),
 * generalized. Instead of a measured `max-height` it transitions `grid-template-rows`
 * `0fr ↔ 1fr`, so it needs no ResizeObserver and adapts to dynamic content.
 *
 * Because the node stays mounted and collapses, surrounding content slides to make
 * room on open and slides back on close (the exit) — no snap. Entrances use our snappy
 * ease-out curve; exits the Material standard curve a touch quicker, mirroring the
 * dialog in/out feel. Reduced-motion is honored globally (see index.css).
 *
 * The OUTER element carries layout — pass `sticky`/`z`/margin resets via `className`.
 * The INNER clips during the collapse; put the visible block (its own bg/border/
 * padding) as `children`.
 */
export function Reveal({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
        open
          ? 'ease-out-quint grid-rows-[1fr] opacity-100 duration-300'
          : 'ease-standard grid-rows-[0fr] opacity-0 duration-200',
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}
