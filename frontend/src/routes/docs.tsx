import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'

import { DocsSidebar } from '@/components/docs/sidebar'
import { groupDocs, listDocs } from '@/lib/docs/registry'

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
  head: () => ({ meta: [{ title: 'Docs — music' }] }),
})

function DocsLayout() {
  const groups = groupDocs(listDocs())
  // Active path is whatever follows `/docs/` in the URL. Strip the prefix
  // and any leading slash so it matches the entries' `path` field.
  const { pathname } = useLocation()
  const activePath = pathname.startsWith('/docs/') ? pathname.slice('/docs/'.length) : 'README.md'

  return (
    <div className="-mx-6 grid grid-cols-1 gap-8 px-6 md:grid-cols-[220px_1fr]">
      {/* Sticky + max-h-viewport + overflow-y-auto so the sidebar tracks
          the page scroll AND can scroll its own contents when the doc list
          outgrows the visible height. `top-20` clears the app header.
          Scrollbar uses theme colors (CSS `scrollbar-color`) so it looks
          right in dark mode — the browser default is a bright gray that
          clashes hard with `--background` on dark themes. */}
      <aside className="docs-sidebar md:sticky md:top-20 md:max-h-[calc(100vh-5rem)] md:self-start md:overflow-y-auto md:pr-2">
        <DocsSidebar groups={groups} activePath={activePath} />
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
