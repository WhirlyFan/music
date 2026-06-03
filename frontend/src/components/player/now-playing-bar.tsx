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

  // Autoplay gate: NEVER autoplay the track restored from a previous session on
  // load/login — only tracks the user actually starts or advances to. We arm
  // autoplay the first time the current item *changes* after the initial
  // hydration (any change is user-driven: play / next / jump). `prevItemId`
  // starts undefined = "not hydrated yet"; the first real value is the restored
  // track and is deliberately not armed. (Adjust-state-during-render pattern —
  // not an effect — so it commits before paint with no flash.)
  const [prevItemId, setPrevItemId] = useState<string | null | undefined>(undefined)
  const [armed, setArmed] = useState(false)
  if (room) {
    if (prevItemId === undefined) {
      setPrevItemId(itemId) // first load → capture, leave un-armed (no autoplay)
    } else if (itemId !== prevItemId) {
      setPrevItemId(itemId)
      setArmed(true) // a post-hydration change → user-initiated → autoplay
    }
  }

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
  const context = room?.context ?? [] // the FULL playlist/album (stable list)
  const contextLabel = room?.context_label ?? ''
  // The list includes already-played tracks, so "upcoming" is only what's after
  // the current position (plus the user queue, which plays first).
  const ctxIdx = context.findIndex((i) => i.id === itemId)
  const contextAhead = ctxIdx >= 0 ? context.length - ctxIdx - 1 : context.length
  const upcoming = queue.length + contextAhead

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
    <div className="border-border bg-background/95 motion-safe:animate-slide-up fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur">
      {queueOpen && (
        <div className="border-border motion-safe:animate-slide-up mx-auto max-h-80 max-w-5xl overflow-y-auto border-b px-6 py-3">
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
            label={contextLabel ? `Playing from ${contextLabel}` : 'Now playing'}
            items={context}
            currentId={itemId}
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
            variant="shadow"
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
          <div className="flex items-center gap-2">
            {playing && <Equalizer />}
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
          autoPlay={armed}
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
  currentId = null,
  emptyHint,
}: {
  label: string
  items: QueueItem[]
  onPlay: (itemId: string) => void
  onRemove: (itemId: string) => void
  currentId?: string | null
  emptyHint?: string
}) {
  const curIdx = currentId ? items.findIndex((i) => i.id === currentId) : -1
  return (
    <div className="mb-2">
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      {items.length === 0 && emptyHint && (
        <p className="text-muted-foreground py-1 text-sm">{emptyHint}</p>
      )}
      <ol className="space-y-0.5">
        {items.map((item, i) => {
          const isCurrent = item.id === currentId
          const played = curIdx >= 0 && i < curIdx // earlier in the list (already passed)
          return (
            <li
              key={item.id}
              className={`group flex items-center gap-2 rounded transition-colors duration-150 ${
                isCurrent ? 'bg-muted' : 'hover:bg-muted/60'
              }`}
            >
              <button
                type="button"
                onClick={() => onPlay(item.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm ${
                  played ? 'opacity-50' : ''
                } ${isCurrent ? 'font-medium' : ''}`}
                title={`Play ${item.track.title}`}
              >
                {isCurrent ? (
                  <Play className="text-primary size-3 shrink-0" />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <span className="truncate">{item.track.title}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {item.track.primary_artist}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.track.title}`}
                className="text-muted-foreground hover:text-foreground px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-4" />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Three bars bouncing while audio plays — a small music-specific flourish.
 *  Static (full height) under reduce-motion; purely decorative. */
function Equalizer() {
  return (
    <span className="flex h-3.5 shrink-0 items-end gap-[2px]" aria-hidden="true">
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="bg-primary motion-safe:animate-equalize inline-block w-[3px] origin-bottom rounded-full"
          style={{ height: '100%', animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  )
}
