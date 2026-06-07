import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type GooeyItem = { icon: React.ReactNode; label: string; onSelect: () => void }

const RADIUS = 116 // px each item travels — far enough that the goo bridge breaks at rest
const DURATION = 0.55 // s — slow enough that the liquid stretch reads
const STAGGER = 45 // ms between items, so they pull apart like droplets

// Goo canvas. The blobs are SVG <circle>s filtered as a GROUP inside this <svg>,
// NOT HTML elements under a CSS `filter: url(#goo)` — the Safari engine (the desktop
// Tauri WebView) silently drops a CSS SVG-filter reference on an HTML element, which
// is why the goo "worked as a website" (Chrome) but died in the app. WebKit applies
// filters to SVG content reliably. The canvas is centered on the 56px FAB and big
// enough that the fanned-out blobs (RADIUS + their own radius) stay inside it.
const SVG = 320
const C = SVG / 2 // FAB / blob center within the canvas
const TRIGGER_R = 28 // the resting FAB blob (size-14 = 56px)
const ITEM_R = 24 // each item blob (size-12 = 48px)

/**
 * Expanding FAB with a real gooey effect (the canonical SVG goo filter:
 * feGaussianBlur + a high-contrast feColorMatrix so overlapping shapes melt
 * together). At rest the item blobs sit on top of the trigger blob (one merged
 * shape); on open they translate out and the liquid bridge stretches then snaps.
 * A crisp HTML icon layer rides the same offsets on top.
 *
 * NOTE: animation is intentionally NOT gated on `prefers-reduced-motion` here —
 * the Tauri WebView mis-reports that query as "reduce", which would (wrongly) snap
 * every transition. Global reduced-motion is still honored elsewhere via Tailwind's
 * motion-safe/${''}motion-reduce variants on real CSS media queries.
 */
export function GooeyMenu({
  items,
  className,
  style,
}: {
  items: GooeyItem[]
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  // Fan from straight-up (90°) to up-left (170°). Closed → at center (0,0), so the
  // item blobs collapse onto the trigger blob and read as one shape.
  const n = items.length
  const point = (i: number) => {
    if (!open) return { x: 0, y: 0 }
    const deg = n <= 1 ? 130 : 90 + (i * 80) / (n - 1)
    const a = (deg * Math.PI) / 180
    return { x: Math.cos(a) * RADIUS, y: -Math.sin(a) * RADIUS }
  }
  const travel = (i: number) =>
    `transform ${DURATION}s cubic-bezier(0.34,1.4,0.64,1) ${i * STAGGER}ms`

  return (
    <div ref={ref} className={cn('relative size-14', className)} style={style}>
      {/* Blob layer: SVG circles filtered as a group (see note above). Centered on
          the FAB; pointer-events-none so the crisp buttons below handle interaction. */}
      <svg
        aria-hidden
        width={SVG}
        height={SVG}
        viewBox={`0 0 ${SVG} ${SVG}`}
        className="pointer-events-none absolute top-1/2 left-1/2"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <defs>
          <filter
            id="goo"
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={SVG}
            height={SVG}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
            />
          </filter>
        </defs>
        <g filter="url(#goo)" className="text-primary" fill="currentColor">
          <circle cx={C} cy={C} r={TRIGGER_R} />
          {items.map((item, i) => {
            const { x, y } = point(i)
            // Translate a wrapping <g> (not the circle) — the most reliably
            // transition-able transform target across engines.
            return (
              <g
                key={item.label}
                style={{ transform: `translate(${x}px, ${y}px)`, transition: travel(i) }}
              >
                <circle cx={C} cy={C} r={ITEM_R} />
              </g>
            )
          })}
        </g>
      </svg>

      {/* Icon / interaction layer — crisp, on top of the blobs. */}
      {items.map((item, i) => {
        const { x, y } = point(i)
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            aria-label={item.label}
            title={item.label}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setOpen(false)
              item.onSelect()
            }}
            className="text-primary-foreground absolute top-1/2 left-1/2 grid size-12 place-items-center rounded-full"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
              opacity: open ? 1 : 0,
              pointerEvents: open ? 'auto' : 'none',
              transition: `${travel(i)}, opacity 0.2s ${i * STAGGER}ms`,
            }}
          >
            {item.icon}
          </button>
        )
      })}

      {/* Trigger. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Quick actions"
        className="text-primary-foreground absolute inset-0 grid place-items-center rounded-full"
      >
        <Plus className={cn('size-6 transition-transform duration-300', open && 'rotate-45')} />
      </button>
    </div>
  )
}
