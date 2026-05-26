import { Link } from '@tanstack/react-router'

import type { DocGroup } from '@/lib/docs/registry'
import { cn } from '@/lib/utils'

/**
 * Vertical nav listing every doc grouped by section (Getting started /
 * Topics / Architecture / Operations / Decisions). The active entry is
 * highlighted; the rest is muted-text. Wrapped in `<nav aria-label>` so
 * screen readers can land on it as a landmark.
 */
export function DocsSidebar({ groups, activePath }: { groups: DocGroup[]; activePath: string }) {
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      {groups.map((g) => (
        <div key={g.label} className="space-y-1.5">
          <p className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
            {g.label}
          </p>
          <ul className="space-y-0.5" role="list">
            {g.entries.map((e) => {
              const isActive = e.path === activePath
              return (
                <li key={e.path}>
                  <Link
                    to={`/docs/${e.path}` as never}
                    className={cn(
                      'block rounded-md px-2 py-1.5 transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {e.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
