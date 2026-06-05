import { createFileRoute } from '@tanstack/react-router'

import { ImportView, OmniBox } from '@/components/import/import-hub'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/import')({
  // `?url=` drives the import from the URL — shareable, refresh-safe, back/logo → home.
  validateSearch: (search: Record<string, unknown>): { url?: string } =>
    typeof search.url === 'string' && search.url.trim() ? { url: search.url } : {},
  component: ImportPage,
  head: () => ({ meta: [{ title: 'Import — music' }] }),
})

function ImportPage() {
  const { url } = Route.useSearch()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Import' }]} title="Import" />
      <section className="mx-auto w-full max-w-xl">
        <OmniBox autoFocus />
      </section>
      {url ? (
        <ImportView url={url} />
      ) : (
        <p className="text-muted-foreground text-center text-sm">
          Paste a Spotify, Apple Music, or YouTube link above to import it.
        </p>
      )}
    </div>
  )
}
