import { Breadcrumbs, type Crumb } from '@/components/ui/breadcrumbs'
import { cn } from '@/lib/utils'

/**
 * Standard page header — breadcrumbs + title + optional description + an
 * actions slot on the right. Pages that have sub-pages or nested routes
 * compose their navigation through this single component so every screen
 * gets consistent spacing, typography, and an accessible breadcrumb nav.
 *
 * Usage:
 *   <PageHeader
 *     breadcrumbs={[
 *       { label: 'Settings', to: '/settings' },
 *       { label: 'Multi-factor authentication' },
 *     ]}
 *     title="Multi-factor authentication"
 *     description="Add a second factor — authenticator app, passkey, …"
 *   />
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  className,
}: {
  breadcrumbs?: Crumb[]
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  )
}
