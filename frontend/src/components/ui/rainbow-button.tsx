import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A solid button wrapped in an animated rainbow *glow* halo (annnimate
 * "rainbow-button"). The glow lives on the wrapper, not the Button: the Button clips
 * overflow for its press ripple, which would otherwise cut the halo off. The
 * `.rainbow-glow` class (index.css) draws the moving, blurred gradient behind the
 * button; the global reduce-motion rule freezes it.
 */
export function RainbowButton({ className, ...props }: ButtonProps) {
  return (
    <span className="rainbow-glow">
      <Button className={cn('relative', className)} {...props} />
    </span>
  )
}
