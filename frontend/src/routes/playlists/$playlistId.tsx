import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import type { PlaybackSource } from '@/lib/query/catalog'
import { usePlaylist, useRefreshArtwork, useSetSource } from '@/lib/query/catalog'
import { usePlayNow, usePlayPlaylist, useQueueTracks } from '@/lib/query/rooms'

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
  const playPlaylist = usePlayPlaylist()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const setSource = useSetSource(playlistId)
  const refreshArtwork = useRefreshArtwork()

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (error || !playlist) return <FormError message="Failed to load playlist." />

  const trackIds = playlist.items.map((item) => item.track.id)

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{playlist.title}</h1>
          <p className="text-muted-foreground text-sm">{playlist.track_count} tracks</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              playPlaylist.mutate(playlistId, { onSuccess: () => toast.success('Playing.') })
            }
          >
            Play
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              queueTracks.mutate(
                { trackIds },
                { onSuccess: () => toast.success('Added to queue.') },
              )
            }
          >
            Add to queue
          </Button>
        </div>
      </header>

      <ol className="space-y-2">
        {playlist.items.map((item) => {
          const source: PlaybackSource | null = item.track.active_source
          const videoMatched = source?.locator_kind === 'video_id'
          return (
            <li
              key={item.track.id}
              className="border-border flex items-center gap-3 rounded-lg border p-3"
            >
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
                    className="bg-background/80 text-foreground hover:bg-background absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border shadow-sm disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`size-3 ${refreshArtwork.isPending ? 'animate-spin' : ''}`}
                    />
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
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => playNow.mutate(item.track.id)}>
                  Play
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    queueTracks.mutate(
                      { trackIds: [item.track.id] },
                      { onSuccess: () => toast.success('Added to queue.') },
                    )
                  }
                >
                  Add
                </Button>
                {videoMatched && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Fix the match for ${item.track.title}`}
                    onClick={() => {
                      const id = window.prompt('Paste the correct YouTube video ID:')
                      if (id) setSource.mutate({ trackId: item.track.id, videoId: id })
                    }}
                  >
                    Wrong song?
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
