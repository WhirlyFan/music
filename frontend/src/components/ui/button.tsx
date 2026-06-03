import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Motion, kept functional: color transitions on hover (affordance) + a subtle
  // tactile press (scale-down) on click. No decorative hover-lift/glow — buttons
  // stay quiet. Press is motion-safe so reduce-motion users get no movement.
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,transform] duration-150 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.97]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border border-border bg-background hover:bg-secondary hover:text-secondary-foreground',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

type Ripple = { id: number; x: number; y: number; size: number }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, onPointerDown, children, ...props }, ref) => {
    const [ripples, setRipples] = React.useState<Ripple[]>([])
    const nextId = React.useRef(0)

    function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
      // Ripple originates from the press point (HeroUI scale-ripple style). Under
      // reduce-motion the global guard collapses the animation to ~0ms, so the
      // onAnimationEnd cleanup still fires and nothing visibly moves.
      const rect = e.currentTarget.getBoundingClientRect()
      const diameter = Math.max(rect.width, rect.height)
      setRipples((prev) => [
        ...prev,
        {
          id: nextId.current++,
          size: diameter,
          x: e.clientX - rect.left - diameter / 2,
          y: e.clientY - rect.top - diameter / 2,
        },
      ])
      onPointerDown?.(e)
    }

    return (
      <button
        className={cn('relative overflow-hidden', buttonVariants({ variant, size, className }))}
        ref={ref}
        onPointerDown={handlePointerDown}
        {...props}
      >
        {children}
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {ripples.map((r) => (
            <span
              key={r.id}
              className="animate-ripple absolute rounded-full bg-current"
              style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
              onAnimationEnd={() => setRipples((prev) => prev.filter((p) => p.id !== r.id))}
            />
          ))}
        </span>
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
