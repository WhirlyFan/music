import {
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { FullScreenPlayer } from '@/components/player/full-screen-player'
import { JamDialog } from '@/components/player/jam-dialog'
import { SeekBar } from '@/components/player/seek-bar'
import { useAudioAnalyser } from '@/components/player/use-audio-analyser'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import type { QueueItem, Room } from '@/lib/api/models'
import { isSessionAuthenticated, sessionUserId } from '@/lib/auth/guards'
import { useMatchTrack, useRefreshArtwork } from '@/lib/hooks/mutations/catalog'
import {
  useClearQueue,
  useJump,
  useNext,
  usePrevious,
  useRemoveItem,
  useSaveQueueAsPlaylist,
  useShuffle,
  useSyncPlayback,
} from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useRoom } from '@/lib/hooks/queries/rooms'
import { useRoomSocket } from '@/lib/hooks/useRoomSocket'
import { promptText } from '@/lib/overlay'
import { useNowPlayingOpen, useQueueOpen } from '@/lib/player-url-state'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

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
  const myUserId = sessionUserId(session)
  const { data: room } = useRoom(authed)
  // Live updates: feed broadcast frames into the same room cache useRoom reads,
  // so a jam stays in sync without polling. No-op until we have a room id.
  useRoomSocket(room?.id, authed, myUserId)
  const refreshArtwork = useRefreshArtwork()

  const matchTrack = useMatchTrack()
  const next = useNext()
  const previous = usePrevious()
  const jump = useJump()
  const removeItem = useRemoveItem()
  const shuffle = useShuffle()
  const clear = useClearQueue()
  const save = useSaveQueueAsPlaylist()
  const syncPlayback = useSyncPlayback()

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
  const queuePanelRef = useRef<HTMLDivElement>(null)
  // Open-state in the URL (linkable, survives nav/refresh); measured geometry in a
  // Zustand client store (shared with the playlists search pill + FAB).
  const [expanded, setExpanded] = useNowPlayingOpen()
  const [queueOpen, setQueueOpen] = useQueueOpen()
  const [jamOpen, setJamOpen] = useState(false)
  const queueHeight = usePlayerUiStore((s) => s.queueHeight)
  const setQueueHeight = usePlayerUiStore((s) => s.setQueueHeight)
  const setPlayerHeight = usePlayerUiStore((s) => s.setPlayerHeight)

  const track = room?.current ?? null
  const matched = track?.active_source?.locator_kind === 'video_id'
  const itemId = room?.current_item_id ?? null
  const audioSrc = matched && track ? `${API_BASE}/catalog/tracks/${track.id}/stream/` : null
  // In a jam: the host always controls; guests drive playback only if the host
  // enabled it (allow_guest_control). Queue editing stays host-only regardless.
  // Your own (unshared) room: full control.
  const isShared = room?.is_shared ?? false
  const isHost = room?.host_id === myUserId
  const canDrive = !isShared || isHost || (room?.allow_guest_control ?? false)
  const canEditQueue = !isShared || isHost
  const memberCount = room?.members?.length ?? 0

  // Publish the player pill + queue-panel heights so the search pill can sit just
  // above them. We measure the queue's STABLE full height (the inner box) once;
  // both the queue's max-height and the pill's bottom then animate that exact
  // pixel value with the same 320ms ease-out-quint, so they open in lockstep.
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

  // Reconcile the <audio> element to the server's authoritative playback state.
  // The room cache — seeded by our own mutations AND by broadcast frames from
  // anyone in the jam — is the source of truth for play/pause + position; this
  // effect makes the local element follow it. That's also why a deliberate
  // play/next/jump autoplays (the action sets server is_playing=true) while a
  // track merely restored on page load does NOT: we skip the first hydration,
  // and browsers block gesture-less autoplay anyway. While the source is still
  // resolving/buffering, `loading` shows a spinner so there's no mis-click gap.
  const hydrated = useRef(false)
  const followedItem = useRef<string | null>(null)
  useEffect(() => {
    const el = audioRef.current
    if (!el || !itemId || !audioSrc) return
    const serverPlaying = room?.is_playing ?? false

    if (!hydrated.current) {
      hydrated.current = true
      followedItem.current = itemId
      return // don't autoplay a track restored on load
    }

    const newItem = followedItem.current !== itemId
    followedItem.current = itemId

    // Converge on the server's live position: on a new track, when (re)starting
    // play, or when the playhead has diverged enough to be a deliberate seek (or
    // real drift) rather than buffering jitter. The >1.5s gate keeps us from
    // stuttering on normal sub-second skew while still following a host's seek.
    const target = intendedSeconds(room)
    const diverged = Math.abs(el.currentTime - target) > 1.5
    if (Number.isFinite(target) && (newItem || (serverPlaying && el.paused) || diverged)) {
      el.currentTime = target
    }
    // Follow play/pause. play() may reject until this client has a user gesture.
    if (serverPlaying && el.paused) void el.play().catch(() => {})
    else if (!serverPlaying && !el.paused) el.pause()
  }, [itemId, audioSrc, room])

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
        // Only the controller skips on a genuine no-match — a guest's skip would
        // mutate their OWN room and bounce them out of the jam.
        if (!canDrive) return
        toast.error(`No YouTube match for “${track.title}” — skipping.`)
        next.mutate()
      },
    })
  }, [track, matched, matchTrack, next, canDrive])

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

  // Spinner while we're resolving the source, buffering, or — in a jam — waiting
  // for the server cache to warm so everyone starts together (pending_start).
  // Derived, so no effect calls setState. Covers the gap with no mis-click.
  const loading = matchTrack.isPending || buffering || (room?.pending_start ?? false)

  const queue = room?.queue ?? [] // explicit "Add to queue" (plays first)
  const context = room?.context ?? [] // the FULL playlist/album (stable list)
  const contextLabel = room?.context_label ?? ''
  // The list includes already-played tracks, so "upcoming" is only what's after
  // the current position (plus the user queue, which plays first).
  const ctxIdx = context.findIndex((i) => i.id === itemId)
  const contextAhead = ctxIdx >= 0 ? context.length - ctxIdx - 1 : context.length
  const upcoming = queue.length + contextAhead

  function togglePlay() {
    if (!canDrive) return // guests follow the host
    const el = audioRef.current
    if (!el) return
    const willPlay = el.paused
    // Optimistic local response, then report to the server so the whole jam
    // follows — the broadcast echo reconciles everyone (including us). play()
    // rejects if the source failed to load; the <audio> onError surfaces it.
    if (willPlay) void el.play().catch(() => {})
    else el.pause()
    syncPlayback.mutate({ positionMs: Math.round(el.currentTime * 1000), isPlaying: willPlay })
  }

  function handlePrevious() {
    if (!canDrive) return // guests follow the host
    // Standard behavior: >3s in, restart the track; otherwise go to the previous.
    const el = audioRef.current
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    previous.mutate()
  }

  function seek(seconds: number) {
    if (!canDrive) return // guests follow the host's playhead
    const el = audioRef.current
    if (!el) return
    el.currentTime = seconds
    setCurrentTime(seconds) // optimistic so the thumb doesn't snap back while buffering
    // Scrubbing to a spot means "play from here" — start playback locally and
    // move the shared playhead (is_playing: true) so the whole jam follows.
    void el.play().catch(() => {})
    syncPlayback.mutate({ positionMs: Math.round(seconds * 1000), isPlaying: true })
  }

  return (
    <div
      ref={barRef}
      className="border-border bg-background/90 motion-safe:animate-slide-up fixed bottom-4 left-1/2 z-40 w-[min(95%,42rem)] -translate-x-1/2 rounded-2xl border shadow-lg backdrop-blur"
    >
      {/* Queue panel. Always mounted; its max-height animates 0→(measured px) so its
          top edge travels by exactly the panel height. The search pill animates its
          bottom by that SAME pixel value with the SAME 320ms ease-out-quint, so the
          two open in true lockstep (max-height in px, not grid `fr`, matches the
          pill's px curve exactly). `inert` drops it from tab/a11y while collapsed. */}
      <div
        className="ease-out-quint absolute inset-x-0 bottom-full mb-2 overflow-hidden transition-[max-height] duration-[320ms] motion-reduce:transition-none"
        style={{ maxHeight: queueOpen ? queueHeight : 0 }}
      >
        <div
          ref={queuePanelRef}
          inert={!queueOpen}
          // Outer: the rounded/blurred panel that animates (composited transform +
          // opacity → the auth-card open/close feel). overflow-hidden clips to the
          // radius. The header is PINNED (a sibling above the scroll region), so the
          // scrollbar lives only beside the song list — below the rounded top corner.
          // The max-height wrapper above drives the layout reveal + search-pill lockstep.
          className={`border-border bg-background/95 ease-out-back overflow-hidden rounded-2xl border shadow-lg backdrop-blur transition-[transform,opacity] duration-[320ms] motion-reduce:transition-none ${
            queueOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          {/* Pinned header — stays put while the song list scrolls below it. */}
          <div className="border-border/60 flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-medium">Queue</p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => shuffle.mutate()}
                aria-disabled={context.length < 2 || !canEditQueue || undefined}
                disabled={context.length < 2 || !canEditQueue}
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
                disabled={!canEditQueue}
                onClick={() => {
                  setQueueOpen(false)
                  clear.mutate()
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          {/* Scroll region — only the songs scroll; thin, transparent-track scrollbar
              (thumb only), capped so a long queue can't run off-screen. */}
          <div className="max-h-56 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-y-auto px-4 py-2 sm:max-h-72">
            {queue.length > 0 && (
              <QueueSection
                label="Next in queue"
                items={queue}
                onPlay={(id) => jump.mutate(id)}
                onRemove={(id) => removeItem.mutate(id)}
                readOnly={!canEditQueue}
              />
            )}
            <QueueSection
              label={contextLabel ? `Playing from ${contextLabel}` : 'Now playing'}
              items={context}
              currentId={itemId}
              onPlay={(id) => jump.mutate(id)}
              onRemove={(id) => removeItem.mutate(id)}
              emptyHint={queue.length === 0 ? 'Nothing queued.' : undefined}
              readOnly={!canEditQueue}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={handlePrevious}
            aria-label="Previous"
            disabled={!canDrive}
          >
            <SkipBack className="size-5" />
          </Button>
          <Button
            size="icon"
            variant="shadow"
            onClick={togglePlay}
            aria-label={loading ? 'Loading' : playing ? 'Pause' : 'Play'}
            aria-busy={loading || undefined}
            disabled={!audioSrc || loading || !canDrive}
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
            aria-disabled={upcoming === 0 || !canDrive || undefined}
            disabled={upcoming === 0 || !canDrive}
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
          {room?.pending_start ? (
            <p className="text-muted-foreground mt-1 text-xs">Starting…</p>
          ) : audioSrc ? (
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
          onClick={() => setJamOpen(true)}
          aria-label="Jam"
          className="relative"
        >
          <Radio className={`size-4 ${isShared ? 'text-primary' : ''}`} />
          {isShared && memberCount > 0 && (
            <span className="bg-primary text-primary-foreground ring-background motion-safe:animate-pop-in absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[10px] leading-none font-semibold tabular-nums ring-2">
              {memberCount}
            </span>
          )}
        </Button>
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
          canNext={upcoming > 0 && canDrive}
          onTogglePlay={togglePlay}
          onPrevious={handlePrevious}
          onNext={() => canDrive && next.mutate()}
          onSeek={seek}
          onClose={() => setExpanded(false)}
        />
      )}

      {room && (
        <JamDialog room={room} myUserId={myUserId} open={jamOpen} onOpenChange={setJamOpen} />
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

/** The server's intended playhead in seconds: position_ms advanced by the time
 *  elapsed since the server stamped playing_since, corrected for client/server
 *  clock skew via server_time. Held (not advanced) while paused. */
function intendedSeconds(room: Room | undefined): number {
  const base = (room?.position_ms ?? 0) / 1000
  if (!room?.is_playing || !room?.playing_since) return base
  const since = Date.parse(room.playing_since)
  const serverNow = room.server_time ? Date.parse(room.server_time) : Date.now()
  if (Number.isNaN(since) || Number.isNaN(serverNow)) return base
  return base + Math.max(0, (serverNow - since) / 1000)
}

function QueueSection({
  label,
  items,
  onPlay,
  onRemove,
  currentId = null,
  emptyHint,
  readOnly = false,
}: {
  label: string
  items: QueueItem[]
  onPlay: (itemId: string) => void
  onRemove: (itemId: string) => void
  currentId?: string | null
  emptyHint?: string
  readOnly?: boolean
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
                onClick={() => !readOnly && onPlay(item.id)}
                disabled={readOnly}
                className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm ${
                  played ? 'opacity-50' : ''
                } ${isCurrent ? 'font-medium' : ''} ${readOnly ? 'cursor-default' : ''}`}
                title={readOnly ? item.track.title : `Play ${item.track.title}`}
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
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.track.title}`}
                  className="text-muted-foreground hover:text-foreground px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="size-4" />
                </button>
              )}
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
