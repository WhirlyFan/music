import { type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The house style for empty / error / no-results screens: a soft icon tile, a
 * title, an optional description, and an optional action. `tone="error"` tints
 * the tile in the destructive color; `muted` (default) is the calm neutral used
 * for "nothing here yet" / "no matches".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'muted',
  className,
}: {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  tone?: 'muted' | 'error'
  className?: string
}) {
  return (
    <div
      className={cn(
        'motion-safe:animate-fade-in mx-auto grid max-w-sm place-items-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-12 place-items-center rounded-2xl',
          tone === 'error'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description != null && (
          <p className="text-muted-foreground text-sm break-words">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
