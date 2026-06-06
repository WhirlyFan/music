import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'

export type SidebarItem = { to: string; label: string; icon: LucideIcon }

/**
 * A stylized section nav — not a flat full-height bar. Each item is a rounded pill
 * that links to its own route; the active one (TanStack Router sets
 * `data-status="active"`) gets the app's gradient icon badge (matching the settings
 * rows) plus a soft primary tint. Vertical on desktop (a contained card), a
 * horizontal scroll strip on mobile. Reusable for any routed, sectioned page.
 */
export function SectionSidebar({ items }: { items: SidebarItem[] }) {
  return (
    <nav
      aria-label="Sections"
      className="bg-card/60 border-border/60 flex [scrollbar-width:none] gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-sm backdrop-blur sm:flex-col sm:gap-0.5 sm:overflow-visible"
    >
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          // Sections are equal-hierarchy siblings, so switching replaces the history
          // entry — Back returns to wherever you were before Settings, not to each
          // section you happened to click through.
          replace
          className="group text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-primary/10 data-[status=active]:text-foreground flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors sm:w-full"
        >
          <span className="bg-muted text-muted-foreground group-hover:text-foreground group-data-[status=active]:from-primary group-data-[status=active]:to-accent group-data-[status=active]:text-primary-foreground group-data-[status=active]:shadow-primary/30 grid size-8 shrink-0 place-items-center rounded-lg transition-colors group-data-[status=active]:bg-gradient-to-br group-data-[status=active]:shadow-sm">
            <Icon className="size-4" aria-hidden />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  )
}
