import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Breadcrumb trail. Semantic `<nav aria-label="Breadcrumb">` containing an
 * ordered list — screen readers announce it as a landmark and let users
 * jump between items. The current page (last item) is marked with
 * `aria-current="page"` and rendered as plain text; everything before it
 * is a link.
 *
 * Pass items in order from root to leaf:
 *   [{ label: 'Settings', to: '/settings' }, { label: 'MFA' }]
 */
export type Crumb = {
  label: string
  /** Omit on the current (last) page; pages in between need a destination. */
  to?: string
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={cn('text-muted-foreground text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              {item.to && !isLast ? (
                // Cast: TanStack Router types `to` against the generated route
                // tree (strict literal paths). Breadcrumb destinations are
                // passed in as plain strings by callers; runtime behavior is
                // identical, only the type narrowing is lost here.
                <Link to={item.to as never} className="hover:text-foreground transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'text-foreground font-medium' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
