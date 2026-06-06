import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ListMusic, SearchX, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { CoverCluster } from '@/components/playlists/cover-cluster'
import { EmptyState } from '@/components/ui/empty-state'
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
  // Clip a very long search so the no-results message can't run off screen.
  const qShort = q.length > 40 ? `${q.slice(0, 40)}…` : q

  // Full-bleed drag canvas: a fixed full-viewport layer escaping <main>'s max-width
  // + padding (the floating top chrome simply rides above it). overflow-hidden — you
  // pan the cluster, the page doesn't scroll.
  return (
    <div className="fixed inset-0 overflow-hidden">
      {playlists.isError ? (
        <div className="grid size-full place-items-center">
          <EmptyState
            tone="error"
            icon={TriangleAlert}
            title="Couldn’t load your playlists"
            description="Something went wrong reaching the server. Refresh to try again."
          />
        </div>
      ) : (
        <>
          {/* Always mounted — a no-results search passes items=[] so the cluster
              pops every cover OUT (its exit spring) instead of vanishing the moment
              the component unmounts. The empty message then fades in over the top. */}
          <CoverCluster
            loading={playlists.isLoading}
            items={items}
            onOpen={(id) => navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })}
            onDelete={(id) =>
              del.mutate(id, { onSuccess: () => toast.success('Playlist deleted.') })
            }
          />
          {empty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              {q ? (
                <EmptyState
                  icon={SearchX}
                  title="No matches"
                  description={`No playlists match “${qShort}”.`}
                />
              ) : (
                <EmptyState
                  icon={ListMusic}
                  title="No playlists yet"
                  description="Import one from the home page, then save it here."
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
