import { createFileRoute, Link } from '@tanstack/react-router'
import { Loader2, MoreVertical, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/page-header'
import { TrackArtwork } from '@/components/track/track-artwork'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { Ripples, useRipple } from '@/components/ui/ripple'
import type { Playlist } from '@/lib/query/catalog'
import { useDeletePlaylist, useInfinitePlaylists } from '@/lib/query/catalog'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'Playlists — music' }] }),
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
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const playlists = useInfinitePlaylists(q)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = playlists

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = playlists.data?.pages.flatMap((p) => p.results) ?? []
  const empty = !playlists.isLoading && items.length === 0

  return (
    <div className="space-y-6">
      <PageHeader title="Playlists" />

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search your playlists"
          placeholder="Search playlists and songs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {playlists.isError && <FormError message="Failed to load playlists." />}

      <ul className="space-y-2">
        {items.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </ul>

      {empty && (
        <p className="text-muted-foreground">
          {q
            ? `No playlists match “${q}”.`
            : 'No playlists yet — import one from the home page, then save it.'}
        </p>
      )}

      <div ref={sentinelRef} className="flex justify-center py-2">
        {isFetchingNextPage && <Loader2 className="text-muted-foreground size-5 animate-spin" />}
      </div>
    </div>
  )
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const del = useDeletePlaylist()
  const ripple = useRipple()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <li
      className="border-border hover:bg-accent/40 relative flex items-center gap-3 overflow-hidden rounded-lg border p-4"
      onPointerDown={ripple.onPointerDown}
    >
      {/* Full-card navigation target, behind the actions menu. */}
      <Link
        to="/playlists/$playlistId"
        params={{ playlistId: playlist.id }}
        aria-label={playlist.title}
        className="absolute inset-0 rounded-lg"
      />
      <TrackArtwork track={{ artwork_url: playlist.artwork_url, title: playlist.title }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{playlist.title}</p>
        <p className="text-muted-foreground text-sm">
          {playlist.track_count} track{playlist.track_count === 1 ? '' : 's'}
        </p>
      </div>

      <div className="relative z-10" onPointerDown={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${playlist.title}`}>
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{playlist.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The playlist is removed. The songs stay in your catalog, so re-importing them later
                is instant.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  del.mutate(playlist.id, {
                    onSuccess: () => toast.success('Playlist deleted.'),
                  })
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Ripples ripples={ripple.ripples} onDone={ripple.remove} />
    </li>
  )
}
