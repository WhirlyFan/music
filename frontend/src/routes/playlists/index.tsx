import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { CoverSpiral } from '@/components/playlists/cover-spiral'
import { FormError } from '@/components/ui/form-error'
import { useDeletePlaylist } from '@/lib/hooks/mutations/catalog'
import { useInfinitePlaylists } from '@/lib/hooks/queries/catalog'
import { useRouteSearch } from '@/lib/hooks/queries/ui'
import { useDebounced } from '@/lib/use-debounced'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'My playlists — music' }] }),
})

function PlaylistsPage() {
  const navigate = useNavigate()
  // The search value is owned by the persistent layout pill (keyed by this path);
  // this page just reads it to drive the query.
  const { value: search } = useRouteSearch('/playlists')
  const q = useDebounced(search, 300)
  const playlists = useInfinitePlaylists(q)
  const del = useDeletePlaylist()

  // The spiral lays out every playlist once, so we need the full set — eagerly page
  // through to the end (typically one or two pages). A finite cluster shouldn't grow
  // under the user's cursor as they drag, so we load all up front rather than on scroll.
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = playlists
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, data])

  const items = data?.pages.flatMap((p) => p.results) ?? []
  const empty = !playlists.isLoading && items.length === 0

  // Full-bleed drag canvas: a fixed layer below the header, escaping <main>'s max-width
  // + padding. overflow-hidden — you pan the cluster, the page doesn't scroll.
  return (
    <div className="fixed inset-x-0 top-14 bottom-0 overflow-hidden">
      <h1 className="bg-background/70 absolute top-3 left-4 z-10 rounded-lg px-3 py-1.5 text-lg font-semibold tracking-tight backdrop-blur">
        My playlists
      </h1>

      {playlists.isError ? (
        <div className="grid size-full place-items-center p-6">
          <FormError message="Failed to load playlists." />
        </div>
      ) : empty ? (
        <div className="text-muted-foreground grid size-full place-items-center p-6 text-center">
          {q
            ? `No playlists match “${q}”.`
            : 'No playlists yet — import one from the home page, then save it.'}
        </div>
      ) : (
        <CoverSpiral
          loading={playlists.isLoading}
          items={items}
          onOpen={(id) => navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })}
          onDelete={(id) => del.mutate(id, { onSuccess: () => toast.success('Playlist deleted.') })}
        />
      )}
    </div>
  )
}
