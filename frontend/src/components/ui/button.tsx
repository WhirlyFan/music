import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { Ripples, useRipple } from '@/components/ui/ripple'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Motion, kept functional: 250ms `ease` transitions (HeroUI's exact cadence —
  // 150ms felt cheap/snappy) + a subtle tactile press (scale-down) on click. No
  // decorative hover-lift/glow. Press is motion-safe so reduce-motion users get
  // no movement.
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium ring-offset-background transition-[transform,color,background-color,opacity] duration-[250ms] ease motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.97]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border border-border bg-background hover:bg-secondary hover:text-secondary-foreground',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        // HeroUI "shadow" style: a static soft colored shadow for depth, and a
        // hover that dims opacity (their opacity-hover) rather than moving.
        shadow: 'bg-primary text-primary-foreground shadow-lg shadow-primary/40 hover:opacity-90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3',
        lg: 'h-11 px-8',
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

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, onPointerDown, children, ...props }, ref) => {
    const ripple = useRipple()

    return (
      <button
        className={cn('relative overflow-hidden', buttonVariants({ variant, size, className }))}
        ref={ref}
        onPointerDown={(e) => {
          ripple.onPointerDown(e)
          onPointerDown?.(e)
        }}
        {...props}
      >
        {children}
        <Ripples ripples={ripple.ripples} onDone={ripple.remove} />
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
