import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type GooeyItem = { icon: React.ReactNode; label: string; onSelect: () => void }

const RADIUS = 116 // px each item travels — far enough that the goo bridge breaks at rest
const DURATION = 0.55 // s — slow enough that the liquid stretch reads
const STAGGER = 45 // ms between items, so they pull apart like droplets

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Expanding FAB with a real gooey effect (the canonical SVG goo filter:
 * feGaussianBlur + a high-contrast feColorMatrix so overlapping shapes melt
 * together). Two stacked layers ride the same transforms: a **blob layer** under
 * `filter:url(#goo)` (plain colored circles — no shadow, which would escape the
 * goo) that stretches/merges as items travel, and a crisp **icon layer** on top.
 * Items fan up-and-left, suiting a bottom-right placement; at rest the radius is
 * wide enough that the liquid bridge thins out and the buttons read as distinct.
 * A11y on the icon layer: haspopup/expanded, Escape + click-outside, tab-gating.
 * Reduced motion → snap (no travel), goo still applies statically.
 */
export function GooeyMenu({ items, className }: { items: GooeyItem[]; className?: string }) {
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

  // Fan from straight-up (90°) to up-left (170°).
  const n = items.length
  const point = (i: number) => {
    if (!open) return { x: 0, y: 0 }
    const deg = n <= 1 ? 130 : 90 + (i * 80) / (n - 1)
    const a = (deg * Math.PI) / 180
    return { x: Math.cos(a) * RADIUS, y: -Math.sin(a) * RADIUS }
  }
  const travel = (i: number) =>
    reducedMotion()
      ? 'none'
      : `transform ${DURATION}s cubic-bezier(0.34,1.4,0.64,1) ${i * STAGGER}ms`
  const blobStyle = (i: number) => {
    const { x, y } = point(i)
    return {
      transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${open ? 1 : 0.4})`,
      transition: travel(i),
    }
  }

  return (
    <div ref={ref} className={cn('relative size-14', className)}>
      {/* Goo filter — blur then crush the alpha so near shapes melt together. */}
      <svg aria-hidden width="0" height="0" className="absolute">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="goo"
            />
          </filter>
        </defs>
      </svg>

      {/* Blob layer — colored circles under the goo filter (no shadows). */}
      <div className="pointer-events-none absolute inset-0" style={{ filter: 'url(#goo)' }}>
        <span className="bg-primary absolute inset-0 rounded-full" />
        {items.map((item, i) => (
          <span
            key={item.label}
            className="bg-primary absolute top-1/2 left-1/2 size-12 rounded-full"
            style={blobStyle(i)}
          />
        ))}
      </div>

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
              transition: reducedMotion()
                ? 'none'
                : `${travel(i)}, opacity 0.2s ${i * STAGGER}ms`,
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
