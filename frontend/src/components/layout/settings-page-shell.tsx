import { PageHeader } from '@/components/layout/page-header'
import type { Crumb } from '@/components/ui/breadcrumbs'

/**
 * Shared surface for settings / account cards: rounded, softly bordered, gently
 * raised. Solid `bg-card` and NO backdrop-blur — unlike the dialogs/auth card
 * (which sit over a glow blob, so blur is meaningful), these sit on a plain page,
 * where blur only adds a faint edge artifact. The soft border carries the panel
 * in light mode, where `--card` equals `--background`.
 *
 * Compose with layout utilities, e.g.
 *   `${settingsCard} divide-y divide-border overflow-hidden`   (row list)
 *   `${settingsCard} p-4 space-y-4`                            (form)
 */
export const settingsCard = 'bg-card border-border/70 rounded-2xl border shadow-sm'

/**
 * Container for the settings tree (`/settings` and `/account/*` sub-pages).
 *
 * Provides:
 *   - Consistent max-width (`max-w-2xl`) so a child page never looks
 *     narrower than its parent
 *   - The standard PageHeader (breadcrumbs + title + description + actions)
 *
 * Page content goes inside as children. Pages should NOT redeclare their
 * own outer `<div className="mx-auto max-w-... space-y-...">` wrapper —
 * this shell owns that layout.
 */
export function SettingsPageShell({
  breadcrumbs,
  title,
  description,
  actions,
  children,
}: {
  breadcrumbs?: Crumb[]
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={title}
        description={description}
        actions={actions}
      />
      {children}
    </div>
  )
}
