import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/page-header'
import { CoverWall } from '@/components/playlists/cover-wall'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { useDeletePlaylist, useInfinitePlaylists } from '@/lib/query/catalog'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'My playlists — music' }] }),
})

/** Debounce a value so typing doesn't fire a request per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

function PlaylistsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const playlists = useInfinitePlaylists(q)
  const del = useDeletePlaylist()

  // The wall tiles a finite pool, so the first page is plenty — no scroll paging.
  const pool = playlists.data?.pages[0]?.results ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="My playlists" />

      <div className="border-border relative h-[calc(100dvh-11rem)] overflow-hidden rounded-xl border sm:h-[calc(100dvh-15rem)]">
        {playlists.isLoading ? (
          <div className="grid size-full place-items-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : playlists.isError ? (
          <div className="grid size-full place-items-center p-6">
            <FormError message="Failed to load playlists." />
          </div>
        ) : pool.length > 0 ? (
          <CoverWall
            items={pool}
            onOpen={(id) => navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })}
            onDelete={(id) =>
              del.mutate(id, { onSuccess: () => toast.success('Playlist deleted.') })
            }
          />
        ) : (
          <div className="text-muted-foreground grid size-full place-items-center p-6 text-center">
            {q
              ? `No playlists match “${q}”.`
              : 'No playlists yet — import one from the home page, then save it.'}
          </div>
        )}

        {/* Floating, rounded search — sits over the canvas, above the now-playing bar. */}
        <div className="absolute right-4 bottom-4 left-4 z-10 mx-auto w-auto max-w-md sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search your playlists"
              placeholder="Search playlists and songs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background/80 h-12 rounded-full pr-4 pl-11 shadow-lg backdrop-blur"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
