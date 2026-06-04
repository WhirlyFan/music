import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CoverWall } from '@/components/playlists/cover-wall'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { useDeletePlaylist, useInfinitePlaylists } from '@/lib/query/catalog'
import { useRoom } from '@/lib/query/rooms'
import { usePlayerUi } from '@/lib/query/ui'
import { useDebounced } from '@/lib/use-debounced'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'My playlists — music' }] }),
})

function PlaylistsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const playlists = useInfinitePlaylists(q)
  const del = useDeletePlaylist()
  const { data: room } = useRoom()
  const { queueHeight, playerHeight } = usePlayerUi()
  // Sit just above the player: bottom-4 (16) + the player pill (measured) + the
  // mb-2 gap (8) + the queue panel (measured). The player publishes the queue
  // height every frame of its open/close animation, so this pill rides the queue
  // in lockstep — no transition of its own to drift out of sync.
  const playerShown = Boolean(room?.current)
  const pillBottomPx = playerShown ? 16 + playerHeight + 8 + queueHeight : 16

  // The wall tiles a finite pool, so the first page is plenty — no scroll paging.
  const pool = playlists.data?.pages[0]?.results ?? []
  const empty = !playlists.isLoading && pool.length === 0

  // Full-bleed: a fixed layer below the header, escaping <main>'s max-width +
  // padding so the wall is edge-to-edge and flush.
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
        <CoverWall
          loading={playlists.isLoading}
          items={pool}
          onOpen={(id) => navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })}
          onDelete={(id) => del.mutate(id, { onSuccess: () => toast.success('Playlist deleted.') })}
        />
      )}

      {/* Floating rounded search — centered (matches the player pill), stacks
          above it when something's playing. */}
      <div
        className="absolute left-1/2 z-10 w-[min(92%,28rem)] -translate-x-1/2"
        style={{ bottom: pillBottomPx }}
      >
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
  )
}
