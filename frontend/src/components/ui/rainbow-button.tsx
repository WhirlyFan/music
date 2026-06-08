import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Annnimate "rainbow-button": a dark, glossy pill with a soft animated rainbow that
 * bleeds out the bottom edge and brightens on hover (see `.rainbow-glow` in index.css).
 *
 * The glow lives on the wrapper `<span>`, not the button — the button's opaque dark
 * fill sits on top and hides all but the bottom spill. Renders a real `<button>`, so it
 * takes the usual button props (type, onClick, disabled, …).
 */
export function RainbowButton({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<'button'>) {
  return (
    <span className="rainbow-glow">
      <button
        className={cn(
          'relative inline-flex h-12 items-center justify-center rounded-full px-8',
          'text-sm font-medium text-white',
          // Flat near-black (no gloss) — the rainbow hairline is the only edge treatment.
          'bg-neutral-900 shadow-md',
          'transition-[transform,box-shadow] duration-200 hover:shadow-lg active:scale-[0.98]',
          'focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-hidden',
          // Stay OPAQUE while disabled (e.g. "Importing…"): the dark fill is what hides
          // the rainbow glow behind it, so fading it would let the rainbow bleed through
          // on top. Just block interaction + soften the label instead.
          'disabled:pointer-events-none disabled:text-white/70',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </span>
  )
}
