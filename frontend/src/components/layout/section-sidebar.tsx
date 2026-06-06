import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type SidebarItem<T extends string> = { key: T; label: string; icon: LucideIcon }

/**
 * A stylized section nav — not a flat full-height bar. Each item is a rounded pill;
 * the active one gets the app's gradient icon badge (matching the settings rows) plus
 * a soft primary tint. Vertical on desktop (a contained card), a horizontal scroll
 * strip on mobile. Reusable for any tabbed page.
 */
export function SectionSidebar<T extends string>({
  items,
  value,
  onChange,
}: {
  items: SidebarItem<T>[]
  value: T
  onChange: (key: T) => void
}) {
  return (
    <nav
      aria-label="Sections"
      className="bg-card/60 border-border/60 flex gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-sm backdrop-blur [scrollbar-width:none] sm:flex-col sm:gap-0.5 sm:overflow-visible"
    >
      {items.map(({ key, label, icon: Icon }) => {
        const active = key === value
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(key)}
            className={cn(
              'group flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors sm:w-full',
              active
                ? 'bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg transition-colors',
                active
                  ? 'from-primary to-accent text-primary-foreground shadow-primary/30 bg-gradient-to-br shadow-sm'
                  : 'bg-muted text-muted-foreground group-hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            {label}
          </button>
        )
      })}
    </nav>
  )
}
