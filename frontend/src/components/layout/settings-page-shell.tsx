import { PageHeader } from '@/components/layout/page-header'
import type { Crumb } from '@/components/ui/breadcrumbs'

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
