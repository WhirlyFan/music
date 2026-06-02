import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { usePlaylist, useMatchPlaylist, useSetSource } from '@/lib/query/catalog'

export const Route = createFileRoute('/playlists/$playlistId')({
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()
  const { data: playlist, isLoading, error } = usePlaylist(playlistId)
  const matchAll = useMatchPlaylist(playlistId)
  const setSource = useSetSource(playlistId)
  const [nowPlaying, setNowPlaying] = useState<string | null>(null)

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (error || !playlist) return <FormError message="Failed to load playlist." />

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{playlist.title}</h1>
          <p className="text-muted-foreground text-sm">{playlist.track_count} tracks</p>
        </div>
        <Button
          onClick={() => matchAll.mutate()}
          aria-busy={matchAll.isPending || undefined}
          className={matchAll.isPending ? 'pointer-events-none opacity-60' : undefined}
        >
          {matchAll.isPending ? 'Matching…' : 'Match on YouTube'}
        </Button>
      </header>

      {nowPlaying && (
        <div className="aspect-video w-full overflow-hidden rounded-lg border">
          {/* IFrame Player — the ToS-compliant playback path (video + ads).
              Ad-free audio (yt-dlp → R2) is Phase 3. */}
          <iframe
            title="Now playing"
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${nowPlaying}?autoplay=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      )}

      <ol className="space-y-2">
        {playlist.items.map((item) => {
          const source = item.track.active_source
          const videoId = source?.locator_kind === 'video_id' ? source.locator : null
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
              {videoId ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setNowPlaying(videoId)}>
                    Play
                  </Button>
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
                </div>
              ) : (
                <span className="text-muted-foreground text-sm">unmatched</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
