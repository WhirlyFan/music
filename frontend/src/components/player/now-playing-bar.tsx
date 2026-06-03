import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { useMatchTrack } from '@/lib/query/catalog'
import { useAdvance, useClearQueue, useRoom, useSaveQueueAsPlaylist } from '@/lib/query/rooms'

const API_BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api/v1'

/**
 * Persistent now-playing bar (mounted in the root layout, so playback + the
 * queue survive navigation). Reads the room — the DB-backed queue — as the
 * single source of truth.
 *
 * Playback path: the current track's audio is matched on demand (lazy) and
 * streamed ad-free through the backend proxy via a plain <audio> element. When
 * a track ends we advance to the next queued item.
 */
export function NowPlayingBar() {
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const { data: room } = useRoom(authed)

  const matchTrack = useMatchTrack()
  const advance = useAdvance()
  const clear = useClearQueue()
  const save = useSaveQueueAsPlaylist()
  const [queueOpen, setQueueOpen] = useState(false)

  const current = useMemo(() => room?.items.find((i) => i.id === room.current_item) ?? null, [room])
  const track = current?.track ?? null
  const source = track?.active_source ?? null
  const matched = source?.locator_kind === 'video_id'

  // Lazy match-on-play: when a new track becomes current and isn't matched yet,
  // resolve its YouTube source once. On failure, skip to the next track.
  const attempted = useRef<string | null>(null)
  useEffect(() => {
    if (!track) {
      attempted.current = null
      return
    }
    if (matched || attempted.current === track.id) return
    attempted.current = track.id
    matchTrack.mutate(track.id, {
      onError: () => {
        toast.error(`No YouTube match for “${track.title}” — skipping.`)
        advance.mutate()
      },
    })
  }, [track, matched, matchTrack, advance])

  if (!authed || !track) return null

  const audioSrc = matched ? `${API_BASE}/catalog/tracks/${track.id}/stream/` : null
  const upNext = room ? room.items.filter((i) => i.position > (current?.position ?? -1)) : []

  return (
    <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur">
      {queueOpen && (
        <div className="border-border mx-auto max-h-64 max-w-5xl overflow-y-auto border-b px-6 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Queue · {room?.items.length ?? 0}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const title = window.prompt('Save queue as playlist — name it:')
                  if (title)
                    save.mutate(title, {
                      onSuccess: () => toast.success('Saved to your playlists.'),
                    })
                }}
              >
                Save as playlist
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>
                Clear
              </Button>
            </div>
          </div>
          <ol className="space-y-1">
            {room?.items.map((item) => (
              <li
                key={item.id}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                  item.id === room.current_item ? 'bg-muted font-medium' : 'text-muted-foreground'
                }`}
              >
                <span className="w-5 text-right tabular-nums">{item.position + 1}</span>
                <span className="truncate">{item.track.title}</span>
                <span className="truncate text-xs opacity-70">{item.track.primary_artist}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="text-muted-foreground truncate text-xs">{track.primary_artist}</p>
        </div>

        {audioSrc ? (
          <audio
            key={track.id}
            src={audioSrc}
            autoPlay
            controls
            onEnded={() => advance.mutate()}
            className="h-9 max-w-xs flex-1"
          />
        ) : (
          <span className="text-muted-foreground flex-1 text-center text-xs">Finding audio…</span>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => advance.mutate()}
          aria-disabled={upNext.length === 0 || undefined}
          disabled={upNext.length === 0}
        >
          Skip
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setQueueOpen((o) => !o)}>
          Queue · {room?.items.length ?? 0}
        </Button>
      </div>
    </div>
  )
}
