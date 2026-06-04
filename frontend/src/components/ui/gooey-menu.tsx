import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type GooeyItem = { icon: React.ReactNode; label: string; onSelect: () => void }

const RADIUS = 78 // px each item travels from the trigger center

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Expanding FAB with a gooey-merge effect (annnimate "gooey-menu"). A `+`
 * trigger fans its actions out on an arc (up-and-left, suiting a bottom-right
 * placement); an SVG goo filter on a non-interactive blob layer makes them
 * "pull apart" like liquid. Icons live in a separate crisp layer so the filter
 * never blurs them. A11y: `aria-haspopup`/`aria-expanded`, Escape +
 * click-outside to close, items un-tabbable while closed. Reduced motion → snap.
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

  // Fan from straight-up (90°) to up-left (150°) so a corner FAB opens inward.
  const n = items.length
  const point = (i: number) => {
    if (!open) return { x: 0, y: 0 }
    const deg = n <= 1 ? 120 : 90 + (i * 60) / (n - 1)
    const a = (deg * Math.PI) / 180
    return { x: Math.cos(a) * RADIUS, y: -Math.sin(a) * RADIUS }
  }
  const itemTransition = (i: number) =>
    reducedMotion()
      ? 'none'
      : `transform 0.35s cubic-bezier(0.22,1,0.36,1) ${i * 30}ms, opacity 0.2s ${i * 30}ms`

  return (
    <div ref={ref} className={cn('relative size-14', className)}>
      <svg aria-hidden className="absolute size-0">
        <defs>
          <filter id="gooey-menu-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
          </filter>
        </defs>
      </svg>

      {/* Blob layer — gooified, non-interactive. */}
      <div className="pointer-events-none absolute inset-0" style={{ filter: 'url(#gooey-menu-goo)' }}>
        <div className="bg-primary absolute inset-0 rounded-full" />
        {items.map((item, i) => {
          const { x, y } = point(i)
          return (
            <div
              key={item.label}
              className="bg-primary absolute top-1/2 left-1/2 size-12 rounded-full"
              style={{
                transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                transition: reducedMotion() ? 'none' : `transform 0.35s cubic-bezier(0.22,1,0.36,1) ${i * 30}ms`,
              }}
            />
          )
        })}
      </div>

      {/* Control layer — crisp icons + the real buttons. */}
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
              transition: itemTransition(i),
            }}
          >
            {item.icon}
          </button>
        )
      })}
    </div>
  )
}
