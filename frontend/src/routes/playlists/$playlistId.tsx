import { createFileRoute } from '@tanstack/react-router'
import { ListPlus, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useInfinitePlaylistTracks, usePlaylist, useRefreshArtwork } from '@/lib/query/catalog'
import { usePlayPlaylist, useQueueTracks } from '@/lib/query/rooms'

/** A YouTube-thumbnail fallback cover — offer to re-resolve the real art. */
function isYouTubeArt(url?: string | null): boolean {
  return !!url && url.includes('i.ytimg.com')
}

export const Route = createFileRoute('/playlists/$playlistId')({
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()
  const { data: playlist, isLoading, error } = usePlaylist(playlistId)
  const tracks = useInfinitePlaylistTracks(playlistId)
  const playPlaylist = usePlayPlaylist()
  const queueTracks = useQueueTracks()
  const refreshArtwork = useRefreshArtwork()

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = tracks
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

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (error || !playlist) return <FormError message="Failed to load playlist." />

  const items = tracks.data?.pages.flatMap((p) => p.results) ?? []

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{playlist.title}</h1>
          <p className="text-muted-foreground text-sm">{playlist.track_count} tracks</p>
        </div>
        <Button
          disabled={!playlist.track_count}
          onClick={() =>
            playPlaylist.mutate({ playlistId }, { onSuccess: () => toast.success('Playing.') })
          }
        >
          Play
        </Button>
      </header>

      {tracks.isError && <FormError message="Failed to load tracks." />}

      <ol className="space-y-2">
        {items.map((item) => (
          <li
            key={item.track.id}
            className="group border-border hover:bg-accent/40 relative flex items-center gap-3 rounded-lg border p-3"
          >
            {/* Full-row play target — clicking the row plays the playlist from here.
                Sits behind the action controls (which carry a higher z-index). */}
            <button
              type="button"
              aria-label={`Play ${item.track.title}`}
              onClick={() =>
                playPlaylist.mutate({ playlistId, startTrackId: item.track.id })
              }
              className="absolute inset-0 rounded-lg"
            />
            <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
              {item.position + 1}
            </span>
            <div className="relative shrink-0">
              <TrackArtwork track={item.track} />
              {isYouTubeArt(item.track.artwork_url) && (
                <button
                  type="button"
                  aria-label={`Retry cover art for ${item.track.title}`}
                  title="Cover is from YouTube — retry the original"
                  disabled={refreshArtwork.isPending}
                  onClick={() => refreshArtwork.mutate(item.track.id)}
                  className="bg-background/80 text-foreground hover:bg-background absolute -top-1 -right-1 z-10 grid size-5 place-items-center rounded-full border shadow-sm disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${refreshArtwork.isPending ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {item.track.is_explicit && <ExplicitBadge />}
                <p className="truncate font-medium">{item.track.title}</p>
              </div>
              <p className="text-muted-foreground truncate text-sm">
                {[item.track.primary_artist, item.track.album_name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="relative z-10 flex items-center">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Add ${item.track.title} to queue`}
                title="Add to queue"
                onClick={() =>
                  queueTracks.mutate(
                    { trackIds: [item.track.id] },
                    { onSuccess: () => toast.success('Added to queue.') },
                  )
                }
              >
                <ListPlus className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {/* Infinite-scroll sentinel + loading affordance. */}
      <div ref={sentinelRef} className="flex justify-center py-2">
        {isFetchingNextPage && <Loader2 className="text-muted-foreground size-5 animate-spin" />}
      </div>
    </div>
  )
}
