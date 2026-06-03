import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import type { PlaybackSource } from '@/lib/query/catalog'
import { usePlaylist, useSetSource } from '@/lib/query/catalog'
import { useEnqueue, useEnqueueBatch, usePlayPlaylist } from '@/lib/query/rooms'

export const Route = createFileRoute('/playlists/$playlistId')({
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()
  const { data: playlist, isLoading, error } = usePlaylist(playlistId)
  const playPlaylist = usePlayPlaylist()
  const addBatch = useEnqueueBatch()
  const enqueue = useEnqueue()
  const setSource = useSetSource(playlistId)

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
              addBatch.mutate(
                { trackIds, replace: false },
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
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.track.title}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {item.track.primary_artist}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => enqueue.mutate({ trackId: item.track.id, mode: 'play_now' })}
                >
                  Play
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    enqueue.mutate(
                      { trackId: item.track.id, mode: 'add' },
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
