import {
  ListMusic,
  Loader2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { FullScreenPlayer } from '@/components/player/full-screen-player'
import { SeekBar } from '@/components/player/seek-bar'
import { useAudioAnalyser } from '@/components/player/use-audio-analyser'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'
import { promptText } from '@/lib/overlay'
import { useMatchTrack, useRefreshArtwork } from '@/lib/query/catalog'
import { usePlayerUi } from '@/lib/query/ui'
import {
  playIntent,
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
  const { data: room } = useRoom(authed)
  const refreshArtwork = useRefreshArtwork()

  const matchTrack = useMatchTrack()
  const next = useNext()
  const previous = usePrevious()
  const jump = useJump()
  const removeItem = useRemoveItem()
  const shuffle = useShuffle()
  const clear = useClearQueue()
  const save = useSaveQueueAsPlaylist()

  const audioRef = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const { analyser, connect: connectAnalyser } = useAudioAnalyser(audioRef)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Playback status, driven by the <audio> element's own events (DOM state) +
  // the match query. `playing` flips on the real `playing` event; `buffering`
  // covers the audio fetch/buffer gap. The spinner state (`loading`) is derived
  // below from the match-in-progress + buffering — no effect sets it.
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const queuePanelRef = useRef<HTMLDivElement>(null)
  // Queue-open + measured geometry live in the Query cache (shared with the
  // playlists search pill). The queue panel stays open across navigation — it
  // closes only via its own toggle, never on outside clicks/navigation.
  const { queueOpen, setQueueOpen, queueHeight, setQueueHeight, setPlayerHeight } = usePlayerUi()

  const track = room?.current ?? null
  const matched = track?.active_source?.locator_kind === 'video_id'
  const itemId = room?.current_item_id ?? null
  const audioSrc = matched && track ? `${API_BASE}/catalog/tracks/${track.id}/stream/` : null

  // Publish the player pill + queue-panel heights so the search pill can sit just
  // above them. We measure the queue's STABLE full height (the inner box) once;
  // both the queue's max-height and the pill's bottom then animate that exact
  // pixel value with the same 280ms ease-out-quint, so they open in lockstep.
  // Only the async RO callback setStates (never the effect body). Re-attaches when
  // the bar mounts (track present → itemId set).
  useEffect(() => {
    const bar = barRef.current
    const panel = queuePanelRef.current
    if (!bar || !panel) return
    const ro = new ResizeObserver(() => {
      setPlayerHeight(bar.offsetHeight)
      setQueueHeight(panel.offsetHeight)
    })
    ro.observe(bar)
    ro.observe(panel)
    return () => ro.disconnect()
  }, [itemId])

  // Autoplay + loading, imperatively. We start playback with play() from an effect
  // (after the <audio> mounts), not the `autoPlay` attribute — the attribute reads
  // a stale value on the render that mounts a new item and silently skips play
  // (this is why hitting Next didn't play). NEVER auto-start the track merely
  // restored on page load: only when a deliberate action set `playIntent` (play /
  // next / previous / jump). While we intend to play but aren't yet — resolving the
  // source ("fetching details") or buffering — `loading` is true, so the button
  // shows a spinner with no mis-click gap. `startedFor` records the decided item.
  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!itemId || startedFor.current === itemId) return
    if (!playIntent.value) {
      startedFor.current = itemId // restored / no intent → don't auto-start
      return
    }
    if (audioSrc) {
      startedFor.current = itemId
      playIntent.value = false
      audioRef.current?.play().catch(() => {}) // onError surfaces a real failure
    }
    // While unmatched (audioSrc null), the spinner shows via matchTrack.isPending.
  }, [itemId, audioSrc])

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

  // Resolve a blank cover once per track — off the audio path (its own request),
  // so playback never waits on an image fetch. Invalidates the room + playlist
  // queries on success, so the cover updates in the player AND any playlist view.
  const artAttempted = useRef<string | null>(null)
  useEffect(() => {
    if (!track) {
      artAttempted.current = null
      return
    }
    if (track.artwork_url || artAttempted.current === track.id) return
    artAttempted.current = track.id
    refreshArtwork.mutate(track.id)
  }, [track, refreshArtwork])

  if (!authed || !track) return null

  // Spinner while we're resolving the source ("fetching details") or buffering —
  // derived, so no effect calls setState. Covers the gap with no mis-click.
  const loading = matchTrack.isPending || buffering

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
    // play() rejects if the source failed to load (e.g. YouTube blocked the
    // stream) — swallow it; the <audio> onError handler surfaces the message.
    if (el.paused) void el.play().catch(() => {})
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
    <div
      ref={barRef}
      className="border-border bg-background/90 motion-safe:animate-slide-up fixed bottom-4 left-1/2 z-40 w-[min(95%,42rem)] -translate-x-1/2 rounded-2xl border shadow-lg backdrop-blur"
    >
      {/* Queue panel. Always mounted; its max-height animates 0→(measured px) so its
          top edge travels by exactly the panel height. The search pill animates its
          bottom by that SAME pixel value with the SAME 280ms ease-out-quint, so the
          two open in true lockstep (max-height in px, not grid `fr`, matches the
          pill's px curve exactly). `inert` drops it from tab/a11y while collapsed. */}
      <div
        className="absolute inset-x-0 bottom-full mb-2 overflow-hidden transition-[max-height] duration-[280ms] ease-out-quint motion-reduce:transition-none"
        style={{ maxHeight: queueOpen ? queueHeight : 0 }}
      >
        <div
          ref={queuePanelRef}
          inert={!queueOpen}
          className="border-border bg-background/95 max-h-60 overflow-y-auto rounded-2xl border px-4 py-3 shadow-lg backdrop-blur sm:max-h-80"
        >
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQueueOpen(false)
                  clear.mutate()
                }}
              >
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
      </div>

      <div className="flex items-center gap-2 px-3 py-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={handlePrevious} aria-label="Previous">
            <SkipBack className="size-5" />
          </Button>
          <Button
            size="icon"
            variant="shadow"
            onClick={togglePlay}
            aria-label={loading ? 'Loading' : playing ? 'Pause' : 'Play'}
            aria-busy={loading || undefined}
            disabled={!audioSrc || loading}
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : playing ? (
              <Pause className="size-5" />
            ) : (
              <Play className="size-5" />
            )}
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
          {/* Title opens the full-screen now-playing view too — the main way to
              reach seeking on mobile, where the in-pill seek bar is hidden. */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Open now playing"
            className="block w-full text-left"
          >
            <div className="flex items-center gap-2">
              {track.is_explicit && <ExplicitBadge />}
              {/* Title takes the row and truncates; the playing indicator is pinned
                  right and reserves its own space — so toggling play never shifts or
                  covers the title. */}
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {track.title}
                <span className="text-muted-foreground ml-2 truncate text-xs font-normal">
                  {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
                </span>
              </p>
              {playing && <Equalizer />}
            </div>
          </button>
          {/* The seek bar is too cramped in the compact pill on phones — hide it
              there and let the full-screen view handle seeking (tap the artwork). */}
          {audioSrc ? (
            <div className="mt-1 hidden sm:block">
              <SeekBar currentTime={currentTime} duration={duration} onSeek={seek} />
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">Finding audio…</p>
          )}
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setQueueOpen((o) => !o)}
          aria-label="Toggle queue"
        >
          <ListMusic className="size-4" />
        </Button>
      </div>

      {expanded && (
        <FullScreenPlayer
          track={track}
          analyser={analyser}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          audioReady={!!audioSrc}
          canNext={upcoming > 0}
          onTogglePlay={togglePlay}
          onPrevious={handlePrevious}
          onNext={() => next.mutate()}
          onSeek={seek}
          onClose={() => setExpanded(false)}
        />
      )}

      {audioSrc && (
        <audio
          key={itemId ?? track.id}
          ref={audioRef}
          src={audioSrc}
          onLoadStart={() => {
            // Just resetting the scrubber. Do NOT mark buffering here: a restored
            // track loads its source without ever playing (no onPlaying/onPause to
            // clear it), which would strand the spinner forever. Buffering is tied
            // to a real play attempt (onPlay) or a mid-play stall (onWaiting).
            setCurrentTime(0)
            setDuration(0)
          }}
          onWaiting={() => setBuffering(true)} // re-buffering mid-track
          onPlay={() => {
            setBuffering(true) // requested — spinner until it actually starts
            connectAnalyser() // wire the visualizer on the first play gesture
          }}
          onPlaying={() => {
            // Real playback started — flip to "playing" so the button matches reality.
            setBuffering(false)
            setPlaying(true)
          }}
          onPause={() => {
            setBuffering(false)
            setPlaying(false)
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => next.mutate()}
          onError={() => {
            // The stream failed to load (couldn't extract audio from YouTube).
            setBuffering(false)
            setPlaying(false)
            toast.error(`Couldn't load audio for “${track.title}” — try again shortly.`)
          }}
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
