import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type GooeyItem = { icon: React.ReactNode; label: string; onSelect: () => void }

const RADIUS = 88 // px each item travels from the trigger center (enough to clear it)

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Expanding FAB. A `+` trigger fans its actions out on an arc (up-and-left,
 * suiting a bottom-right placement). The items are **distinct** circular buttons
 * (each its own shadow), not a merged blob. A11y: `aria-haspopup`/`aria-expanded`,
 * Escape + click-outside to close, items un-tabbable while closed. Reduced motion
 * → snap (no slide).
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

  return (
    <div ref={ref} className={cn('relative size-14', className)}>
      {/* Action buttons — distinct circles that fan out of the trigger. */}
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
            className="bg-primary text-primary-foreground absolute top-1/2 left-1/2 grid size-12 place-items-center rounded-full shadow-md"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
              opacity: open ? 1 : 0,
              pointerEvents: open ? 'auto' : 'none',
              transition: reducedMotion()
                ? 'none'
                : `transform 0.3s cubic-bezier(0.22,1,0.36,1) ${i * 35}ms, opacity 0.2s ${i * 35}ms`,
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
        className="bg-primary text-primary-foreground absolute inset-0 grid place-items-center rounded-full shadow-lg"
      >
        <Plus className={cn('size-6 transition-transform duration-300', open && 'rotate-45')} />
      </button>
    </div>
  )
}
