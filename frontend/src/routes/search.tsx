import { createFileRoute } from '@tanstack/react-router'

import { OmniBox, SearchResults } from '@/components/import/import-hub'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/search')({
  // `?q=` drives the search from the URL, so results are a real navigation step:
  // shareable, refresh-safe, and back / the home logo return to the clean hero.
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q.trim() ? { q: search.q } : {},
  component: SearchPage,
  head: () => ({ meta: [{ title: 'Search — music' }] }),
})

function SearchPage() {
  const { q } = Route.useSearch()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Search' }]} title="Search" />
      <section className="mx-auto w-full max-w-xl">
        <OmniBox initial={q ?? ''} autoFocus />
      </section>
      {q ? (
        <SearchResults q={q} />
      ) : (
        <p className="text-muted-foreground text-center text-sm">Type a song above to search.</p>
      )}
    </div>
  )
}
