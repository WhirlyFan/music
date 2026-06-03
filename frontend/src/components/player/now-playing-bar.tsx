import { ListMusic, Pause, Play, Shuffle, SkipBack, SkipForward, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { useMatchTrack } from '@/lib/query/catalog'
import {
  type QueueItem,
  useClearQueue,
  useJump,
  useNext,
  usePrevious,
  useRemoveItem,
  useRoom,
  useSaveQueueAsPlaylist,
  useShuffle,
} from '@/lib/query/rooms'

const API_BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api/v1'

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Persistent player (mounted in the root layout, so playback + the queue survive
 * navigation). The DB-backed room is the single source of truth: now-playing +
 * two up-next layers — the explicit "Next in queue" and the "Next from: …"
 * context (the playlist remaining).
 *
 * Custom transport (prev / play-pause / next) + a seek bar drive a hidden
 * <audio> element. Audio is matched on demand (lazy) and streamed ad-free
 * through the backend proxy. Track end → next.
 */
export function NowPlayingBar() {
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const { data: room } = useRoom(authed)

  const matchTrack = useMatchTrack()
  const next = useNext()
  const previous = usePrevious()
  const jump = useJump()
  const removeItem = useRemoveItem()
  const shuffle = useShuffle()
  const clear = useClearQueue()
  const save = useSaveQueueAsPlaylist()

  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  const track = room?.current ?? null
  const matched = track?.active_source?.locator_kind === 'video_id'
  const itemId = room?.current_item_id ?? null

  // Lazy match-on-play: resolve the current track's source once; on failure skip.
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
        next.mutate()
      },
    })
  }, [track, matched, matchTrack, next])

  if (!authed || !track) return null

  const audioSrc = matched ? `${API_BASE}/catalog/tracks/${track.id}/stream/` : null
  const queue = room?.queue ?? [] // explicit "Add to queue" (plays first)
  const context = room?.context ?? [] // the playlist/album remaining ("Next from")
  const contextLabel = room?.context_label ?? ''
  const upcoming = queue.length + context.length

  function togglePlay() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  function handlePrevious() {
    // Standard behavior: >3s in, restart the track; otherwise go to the previous.
    const el = audioRef.current
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    previous.mutate()
  }

  return (
    <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur">
      {queueOpen && (
        <div className="border-border mx-auto max-h-80 max-w-5xl overflow-y-auto border-b px-6 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Queue</p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => shuffle.mutate()}
                aria-disabled={context.length < 2 || undefined}
                disabled={context.length < 2}
              >
                <Shuffle className="mr-1 size-4" /> Shuffle
              </Button>
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
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          {queue.length > 0 && (
            <QueueSection
              label="Next in queue"
              items={queue}
              onPlay={(id) => jump.mutate(id)}
              onRemove={(id) => removeItem.mutate(id)}
            />
          )}
          <QueueSection
            label={contextLabel ? `Next from: ${contextLabel}` : 'Next up'}
            items={context}
            onPlay={(id) => jump.mutate(id)}
            onRemove={(id) => removeItem.mutate(id)}
            emptyHint={queue.length === 0 ? 'Nothing queued.' : undefined}
          />
        </div>
      )}

      <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={handlePrevious} aria-label="Previous">
            <SkipBack className="size-5" />
          </Button>
          <Button
            size="icon"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={!audioSrc}
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => next.mutate()}
            aria-label="Next"
            aria-disabled={upcoming === 0 || undefined}
            disabled={upcoming === 0}
          >
            <SkipForward className="size-5" />
          </Button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium">
              {track.title}
              <span className="text-muted-foreground ml-2 truncate text-xs font-normal">
                {track.primary_artist}
              </span>
            </p>
          </div>
          {audioSrc ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-muted-foreground w-9 text-right text-[11px] tabular-nums">
                {fmt(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step="any"
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => {
                  const el = audioRef.current
                  if (el) el.currentTime = Number(e.target.value)
                }}
                aria-label="Seek"
                className="accent-primary h-1 flex-1 cursor-pointer"
              />
              <span className="text-muted-foreground w-9 text-[11px] tabular-nums">
                {fmt(duration)}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">Finding audio…</p>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setQueueOpen((o) => !o)}
          aria-label="Toggle queue"
        >
          <ListMusic className="mr-1 size-4" /> {upcoming}
        </Button>
      </div>

      {audioSrc && (
        <audio
          key={itemId ?? track.id}
          ref={audioRef}
          src={audioSrc}
          autoPlay
          onLoadStart={() => {
            setCurrentTime(0)
            setDuration(0)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => next.mutate()}
        />
      )}
    </div>
  )
}

function QueueSection({
  label,
  items,
  onPlay,
  onRemove,
  muted = false,
  emptyHint,
}: {
  label: string
  items: QueueItem[]
  onPlay: (itemId: string) => void
  onRemove: (itemId: string) => void
  muted?: boolean
  emptyHint?: string
}) {
  return (
    <div className="mb-2">
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      {items.length === 0 && emptyHint && (
        <p className="text-muted-foreground py-1 text-sm">{emptyHint}</p>
      )}
      <ol className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id} className="hover:bg-muted/60 group flex items-center gap-2 rounded">
            <button
              type="button"
              onClick={() => onPlay(item.id)}
              className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm ${
                muted ? 'opacity-70' : ''
              }`}
              title={`Play ${item.track.title}`}
            >
              <span className="truncate">{item.track.title}</span>
              <span className="text-muted-foreground truncate text-xs">
                {item.track.primary_artist}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.track.title}`}
              className="text-muted-foreground hover:text-foreground px-2 py-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
