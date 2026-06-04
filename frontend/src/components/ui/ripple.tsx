import * as React from 'react'

/**
 * Press ripple, shared by buttons and clickable cards/rows. A circle emanates
 * from the pointer-down point (HeroUI scale-ripple style). Under reduce-motion
 * the global guard collapses the animation to ~0ms so `onAnimationEnd` still
 * fires and nothing visibly moves.
 *
 * Usage: the host element must be `relative overflow-hidden`.
 *   const ripple = useRipple()
 *   <div className="relative overflow-hidden" onPointerDown={ripple.onPointerDown}>
 *     {children}
 *     <Ripples ripples={ripple.ripples} onDone={ripple.remove} />
 *   </div>
 */
export type Ripple = { id: number; x: number; y: number; size: number }

export function useRipple() {
  const [ripples, setRipples] = React.useState<Ripple[]>([])
  const nextId = React.useRef(0)

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    setRipples((prev) => [
      ...prev,
      {
        id: nextId.current++,
        size,
        x: e.clientX - rect.left - size / 2,
        y: e.clientY - rect.top - size / 2,
      },
    ])
  }, [])

  const remove = React.useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return { ripples, onPointerDown, remove }
}

export function Ripples({ ripples, onDone }: { ripples: Ripple[]; onDone: (id: number) => void }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {ripples.map((r) => (
        <span
          key={r.id}
          className="animate-ripple absolute rounded-full bg-current"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          onAnimationEnd={() => onDone(r.id)}
        />
      ))}
    </span>
  )
}
