import { useRef } from 'react'

import { prefersReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'

/**
 * 3D tilt-on-hover card (annnimate "3d-card-flip" style). The element tilts
 * toward the cursor (rotateX/rotateY up to `maxTilt`), lifts a touch (`scale`),
 * and a glare highlight follows the pointer.
 *
 * Pointer handlers write `transform` + glare CSS vars directly to the DOM (no
 * per-frame React state — compiler-friendly). Tilt is skipped under
 * `prefers-reduced-motion` and on touch (no hover). Handlers don't capture or
 * stopPropagation, so this composes inside the draggable cover wall: the wall's
 * `translate3d` stays on the outer tile, tilt on this inner element, and during
 * a drag the wall's pointer-capture pauses tilt naturally.
 */
export function TiltCard({
  children,
  className,
  maxTilt = 12,
  scale = 1.06,
  glare = true,
}: {
  children: React.ReactNode
  className?: string
  maxTilt?: number
  scale?: number
  glare?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el || e.pointerType === 'touch' || prefersReducedMotion()) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const rotateX = (-(y - r.height / 2) / (r.height / 2)) * maxTilt
    const rotateY = ((x - r.width / 2) / (r.width / 2)) * maxTilt
    el.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`
    const g = glareRef.current
    if (g) {
      g.style.opacity = '1'
      g.style.setProperty('--gx', `${(x / r.width) * 100}%`)
      g.style.setProperty('--gy', `${(y / r.height) * 100}%`)
    }
  }

  function reset() {
    if (ref.current) ref.current.style.transform = ''
    if (glareRef.current) glareRef.current.style.opacity = '0'
  }

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      className={cn(
        'size-full transition-transform duration-150 ease-out [transform-style:preserve-3d]',
        className,
      )}
    >
      {children}
      {glare && (
        <div
          ref={glareRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200"
          style={{
            background:
              'radial-gradient(circle at var(--gx,50%) var(--gy,50%), rgba(255,255,255,0.35), transparent 60%)',
          }}
        />
      )}
    </div>
  )
}
