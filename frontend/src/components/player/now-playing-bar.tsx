import { ListMusic, Pause, Play, Shuffle, SkipBack, SkipForward, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { FullScreenPlayer } from '@/components/player/full-screen-player'
import { SeekBar } from '@/components/player/seek-bar'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { promptText } from '@/lib/overlay'
import { useMatchTrack, useSetSource } from '@/lib/query/catalog'
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
  const { data: room, refetch: refetchRoom } = useRoom(authed)

  const matchTrack = useMatchTrack()
  const next = useNext()
  const previous = usePrevious()
  const jump = useJump()
  const removeItem = useRemoveItem()
  const shuffle = useShuffle()
  const clear = useClearQueue()
  const save = useSaveQueueAsPlaylist()
  const setSource = useSetSource()

  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

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
  //
  // Why state, not a ref/local: `armed` must survive the synchronous re-render
  // that `setPrevItemId` triggers (a local would reset to false before commit),
  // and `autoPlay` is read *during render* — reading a ref there would violate
  // the Rules of React the compiler enforces.
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

  function seek(seconds: number) {
    const el = audioRef.current
    if (!el) return
    el.currentTime = seconds
    setCurrentTime(seconds) // optimistic so the thumb doesn't snap back while buffering
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
                onClick={async () => {
                  const title = await promptText({
                    title: 'Save queue as playlist',
                    label: 'Playlist name',
                    defaultValue: contextLabel,
                    confirmLabel: 'Save playlist',
                  })
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

        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Open now playing"
          className="hover:scale-105 motion-safe:transition-transform"
        >
          <TrackArtwork track={track} className="size-11" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {playing && <Equalizer />}
            {track.is_explicit && <ExplicitBadge />}
            <p className="truncate text-sm font-medium">
              {track.title}
              <span className="text-muted-foreground ml-2 truncate text-xs font-normal">
                {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
              </span>
            </p>
          </div>
          {audioSrc ? (
            <div className="mt-1">
              <SeekBar currentTime={currentTime} duration={duration} onSeek={seek} />
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

      {expanded && (
        <FullScreenPlayer
          track={track}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          audioReady={!!audioSrc}
          canNext={upcoming > 0}
          onTogglePlay={togglePlay}
          onPrevious={handlePrevious}
          onNext={() => next.mutate()}
          onSeek={seek}
          onPauseMain={() => audioRef.current?.pause()}
          onCorrect={(videoId) => setSource.mutate({ trackId: track.id, videoId })}
          onClose={() => setExpanded(false)}
        />
      )}

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
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration)
            // The stream endpoint backfills artwork for old tracks on play — pull
            // it in live so the cover appears without a reload.
            if (!track.artwork_url) void refetchRoom()
          }}
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
                <TrackArtwork track={item.track} className="size-7 rounded-sm" />
                {item.track.is_explicit && <ExplicitBadge />}
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
