import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Button with an animated rainbow fill (annnimate "rainbow-button"). Wraps our
 * Button so it keeps the press ripple + sizing; the `.rainbow-button` class
 * (index.css) provides the moving gradient + white text. Reduce-motion freezes it.
 */
export function RainbowButton({ className, ...props }: ButtonProps) {
  return (
    <Button className={cn('rainbow-button shadow-lg shadow-primary/30', className)} {...props} />
  )
}
