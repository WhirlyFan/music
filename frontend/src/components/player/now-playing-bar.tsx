import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import {
  GripVertical,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { FullScreenPlayer } from '@/components/player/full-screen-player'
import { SeekBar } from '@/components/player/seek-bar'
import { useAudioAnalyser } from '@/components/player/use-audio-analyser'
import { VolumeControl } from '@/components/player/volume-control'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { IS_DESKTOP } from '@/lib/api/client'
import type { QueueItem, Room } from '@/lib/api/models'
import { isSessionAuthenticated, sessionUserId } from '@/lib/auth/guards'
import { roomKeys } from '@/lib/hooks/keys'
import { useMatchTrack, useRefreshArtwork } from '@/lib/hooks/mutations/catalog'
import {
  useClearQueue,
  useJump,
  useNext,
  usePrevious,
  useRemoveItem,
  useReorderQueue,
  useShuffle,
  useSyncPlayback,
} from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { type ContextPage, useRoom, useRoomContext } from '@/lib/hooks/queries/rooms'
import { usePrewarm } from '@/lib/hooks/usePrewarm'
import { useRoomSocket } from '@/lib/hooks/useRoomSocket'
import { useNowPlayingOpen, useQueueOpen } from '@/lib/player-url-state'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

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
  const qc = useQueryClient()
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const myUserId = sessionUserId(session)
  const { data: room } = useRoom(authed)
  // Live updates: feed broadcast frames into the same room cache useRoom reads,
  // so a jam stays in sync without polling. No-op until we have a room id.
  // `reportReady` is the synced-start readiness signal (below).
  const { reportReady } = useRoomSocket(room?.id, authed, myUserId)
  // Desktop: warm the next tracks (incl. the seeded shuffle target) locally so a
  // skip / auto-advance / shuffle starts instantly. Server-computed; no-op on web.
  usePrewarm(room?.prewarm)
  const refreshArtwork = useRefreshArtwork()

  const matchTrack = useMatchTrack()
  const next = useNext()
  const previous = usePrevious()
  const jump = useJump()
  const removeItem = useRemoveItem()
  const reorderQueue = useReorderQueue()
  const shuffle = useShuffle()
  const clear = useClearQueue()
  const syncPlayback = useSyncPlayback()

  const audioRef = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const playPauseRef = useRef<HTMLButtonElement>(null)
  // A passive jam guest's local listen intent. Their Play/Pause doesn't move the
  // shared jam, so we can't read it back off `room`; we track it here so a host
  // pause/resume (or track change) respects it — a muted guest stays muted, an
  // opted-in one keeps following. Default true: joining a jam means "let me hear
  // it." Irrelevant for a driver (they follow the server's is_playing directly).
  // State (not a ref) because the render-time `audioBlocked` hint reads it.
  const [wantsAudio, setWantsAudio] = useState(true)
  const { analyser, connect: connectAnalyser } = useAudioAnalyser(audioRef)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Local playback status from the <audio> element's own events (DOM state).
  // `buffering` covers the audio fetch/buffer gap. The button's displayed state
  // and the toggle intent are derived from this in a solo room but from the
  // SERVER in a jam (below) — so the whole room agrees on play/pause regardless
  // of any single client's element diverging (e.g. a swallowed autoplay reject).
  const [localPlaying, setLocalPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  // Output volume (0–1), persisted across sessions. Applied to the <audio> element
  // below; a fresh element (per-track remount) re-reads it.
  const [volume, setVolume] = useState(() => {
    // getItem returns null when unset, and Number(null) === 0 — which passes the
    // range check below and would silently default a fresh client (every guest,
    // every new/incognito session) to MUTED. Treat absent/blank as "no saved
    // preference" → full volume; only a real stored 0–1 wins.
    const raw = localStorage.getItem('player:volume')
    const v = raw === null || raw === '' ? NaN : Number(raw)
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
  })
  const queuePanelRef = useRef<HTMLDivElement>(null)
  // Open-state in the URL (linkable, survives nav/refresh); measured geometry in a
  // Zustand client store (shared with the playlists search pill + FAB).
  const [expanded, setExpanded] = useNowPlayingOpen()
  const [queueOpen, setQueueOpen] = useQueueOpen()
  // The played-from list can be 1000+ tracks, so it's NOT in the room frame — it's
  // a separate paginated query, fetched only while the queue panel is open and
  // cached (playback ticks never refetch it).
  const contextQuery = useRoomContext(authed && queueOpen)
  const setJamOpen = usePlayerUiStore((s) => s.setJamOpen)
  const setSaveQueueOpen = usePlayerUiStore((s) => s.setSaveQueueOpen)
  const queueHeight = usePlayerUiStore((s) => s.queueHeight)
  const setQueueHeight = usePlayerUiStore((s) => s.setQueueHeight)
  const setPlayerHeight = usePlayerUiStore((s) => s.setPlayerHeight)

  const track = room?.current ?? null
  const matched = track?.active_source?.locator_kind === 'video_id'
  const itemId = room?.current_item_id ?? null
  // Audio always comes from the LOCAL engine: the desktop's Rust proxy resolves the
  // video via the bundled yt-dlp (from the user's own residential IP) and proxies
  // the bytes from /stream/. The cloud no longer serves audio (no server-side
  // resolve/cache) — every node fetches off its own IP.
  const audioSrc = matched && track ? `/stream/${track.active_source?.locator}` : null
  // The song's true length, from metadata (the matched YouTube video's duration,
  // falling back to the track's). We DON'T trust the <audio> element's own
  // `duration`: some YouTube AAC streams report it ~2x too long (an SBR/timescale
  // decoder quirk), which both shows a wrong total time AND makes the element think
  // the track is only half over when the audio actually runs out — so it stalls
  // instead of ending, and playback never advances. Metadata is authoritative;
  // el.duration is only a fallback when we have none.
  const metaDurationSec = (track?.active_source?.duration_ms ?? track?.duration_ms ?? 0) / 1000
  const effectiveDuration = metaDurationSec || duration
  // In a jam: the host always controls; guests drive playback only if the host
  // enabled it (allow_guest_control). Queue editing stays host-only regardless.
  // Your own (unshared) room: full control.
  const isShared = room?.is_shared ?? false
  const isHost = room?.host_id === myUserId
  const canDrive = !isShared || isHost || (room?.allow_guest_control ?? false)
  const serverPlaying = room?.is_playing ?? false
  // The transport reflects what THIS client is actually playing (`localPlaying`),
  // not the room's intent. In a healthy jam a driver's element tracks the server,
  // so the two match during normal play. They diverge in exactly one case: the
  // browser blocked gesture-less audio (after a refresh), leaving us silent while
  // the jam plays. Then the button honestly shows Play — a "tap to start" signal —
  // and a tap STARTS this client's audio (togglePlay's willPlay = !playing) rather
  // than pausing the whole jam, which a server-driven Pause button would do.
  const playing = localPlaying
  const canEditQueue = !isShared || isHost
  const memberCount = room?.members_count ?? 0

  // Synced-start readiness: a freshly-chosen track parks (pending_start) until THIS
  // node's audio is buffered enough to play, then the server starts it. We report
  // readiness for SOLO rooms too — that's what keeps a cold ~10s resolve from running
  // as playback (the song would otherwise begin ~10s in); the clock only starts once
  // the audio is actually ready. In a jam the server waits for every present node.
  // Deduped per (track, generation) so we report each parked track exactly once.
  const pendingStart = room?.pending_start ?? false
  const generation = room?.generation
  const reportedReadyRef = useRef<string | null>(null)
  const maybeReportReady = useCallback(() => {
    if (!pendingStart || typeof generation !== 'number') return
    const tag = `${itemId ?? ''}:${generation}`
    if (reportedReadyRef.current === tag) return
    reportedReadyRef.current = tag
    reportReady(generation)
  }, [pendingStart, generation, itemId, reportReady])

  // Cover the already-buffered case: the audio was ready before the pending frame
  // arrived (a track we'd already cached), so the element's onCanPlay won't fire
  // again — report straight away.
  useEffect(() => {
    const el = audioRef.current
    if (el && el.readyState >= 3) maybeReportReady()
  }, [maybeReportReady])

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
  // effect makes the local element follow it. On the first hydration (e.g. a page
  // refresh) we restore the live position AND resume per the server's is_playing,
  // so a refreshed playing track keeps playing instead of showing "playing" while
  // parked. The browser may still block gesture-less autoplay → it stays paused and
  // the Play button reads correctly; one tap resumes. While the source is still
  // resolving/buffering, `loading` shows a spinner so there's no mis-click gap.
  const hydrated = useRef(false)
  const followedItem = useRef<string | null>(null)
  const roomRef = useRef(room) // latest room for the gesture-resume handler below
  useEffect(() => {
    roomRef.current = room
  }, [room])
  useEffect(() => {
    const el = audioRef.current
    if (!el || !itemId || !audioSrc) return

    if (!hydrated.current) {
      hydrated.current = true
      followedItem.current = itemId
      const t = intendedSeconds(room)
      if (Number.isFinite(t)) el.currentTime = t
      if (serverPlaying) void el.play().catch(() => {})
      return
    }

    const newItem = followedItem.current !== itemId
    followedItem.current = itemId

    // Converge on the server's live position: on a new track, when (re)starting
    // play, or when the playhead has diverged enough to be a deliberate seek (or
    // real drift) rather than buffering jitter. The >1.5s gate keeps us from
    // stuttering on normal sub-second skew while still following a host's seek.
    // While we're the seek authority (just moved the playhead ourselves), don't snap
    // to the server frame — it's the lagging echo of our own seek and would yank us
    // back. A genuine new track or a resume-from-paused still applies.
    const localAuthority = performance.now() < localSeekUntil.current
    const target = intendedSeconds(room)
    const diverged = Math.abs(el.currentTime - target) > 1.5
    if (
      Number.isFinite(target) &&
      (newItem || (serverPlaying && el.paused) || (diverged && !localAuthority))
    ) {
      el.currentTime = target
    }
    // Follow play/pause. play() may reject until this client has a user gesture.
    // Resume only if this client wants audio (`wantsAudio`). This is deliberately
    // NOT gated on `canDrive`: gaining control is a permission, not consent to
    // sound — when the host enables guest control, a muted guest's canDrive flips
    // true, and keying resume off it would force-unmute them. `wantsAudio` is true
    // by default and for any driver, so host/solo still follow the server normally.
    // A host PAUSE still stops everyone — pausing the jam silences the room.
    if (serverPlaying && el.paused) {
      if (wantsAudio) void el.play().catch(() => {})
    } else if (!serverPlaying && !el.paused) {
      el.pause()
    }
  }, [itemId, audioSrc, room, wantsAudio])

  // Jam playhead: interpolate the progress bar from the server clock, NOT this
  // client's <audio> element. A refresh (or autoplay block, or buffering) can leave
  // our element paused/silent while the session is logically playing — if the bar
  // only followed onTimeUpdate it would freeze even though the jam is advancing, the
  // exact "shows playing but the seeker is stuck" symptom. So while the jam plays,
  // anchor to intendedSeconds(room) at the frame we received and advance by wall
  // clock; each new frame (heartbeat or a host action) re-anchors. Solo playback
  // stays driven by the element's own onTimeUpdate (below).
  useEffect(() => {
    if (!isShared || !serverPlaying) return
    const base = intendedSeconds(room)
    if (!Number.isFinite(base)) return
    const startWall = performance.now()
    // Only DRIVE the bar from the server clock while our element isn't actually
    // playing (refresh / autoplay-block / buffering). When it IS playing — including
    // right after a local seek — the element's own onTimeUpdate owns the bar, so it
    // reflects the audio we hear and never hands back to the (latency-lagging) server
    // clock, which was the residual seek rubber-band.
    const tick = () => {
      const el = audioRef.current
      if (el && !el.paused) return
      setCurrentTime(base + (performance.now() - startWall) / 1000)
    }
    const first = setTimeout(tick, 0) // jump to live at once on rejoin, before the interval
    const id = setInterval(tick, 250)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [isShared, serverPlaying, room])

  // Apply + persist output volume. Re-runs on itemId/audioSrc too, since a new
  // track remounts the <audio> element (which resets to full volume).
  useEffect(() => {
    const el = audioRef.current
    if (el) el.volume = volume
    localStorage.setItem('player:volume', String(volume))
  }, [volume, itemId, audioSrc])

  // Autoplay unblock + resync. A refresh (especially mid-jam) can leave us showing
  // the server's "playing" state while our <audio> is actually paused, because the
  // browser blocks gesture-less playback. The user's FIRST interaction anywhere
  // lifts that block — so on any gesture, if the server says we should be playing
  // but we're paused, seek to the live position and resume. Self-disables once
  // playing; never fires while the server is paused (so it won't fight a pause).
  useEffect(() => {
    const resume = (e: Event) => {
      const el = audioRef.current
      const r = roomRef.current
      if (!el || !el.paused || !r?.is_playing || !r.current_item_id) return
      // A passive guest who muted themselves stays muted — don't let an unrelated
      // tap resume them. (Drivers never clear this, so it's a no-op for them.)
      if (!wantsAudio) return
      // Skip only the play/pause button. Its pointerdown fires (this handler)
      // BEFORE its onClick (togglePlay): resuming here would race the click's own
      // pause() on the same element and the first tap would do nothing. Every
      // other gesture — including the rest of the player bar (queue, jam, artwork)
      // — is fair game, which matters on iOS where play() only works synchronously
      // inside a gesture, so a guest who only taps the bar still gets audio.
      if (playPauseRef.current?.contains(e.target as Node)) return
      const t = intendedSeconds(r)
      if (Number.isFinite(t)) el.currentTime = t
      void el.play().catch(() => {})
    }
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
    return () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
    }
  }, [wantsAudio])

  // End-of-track watchdog. `onEnded` handles the clean case, but it can't be relied
  // on here: when the element over-reports its duration (the ~2x AAC quirk), the
  // real audio runs out at the metadata duration while the element thinks it's only
  // half done, so it STALLS (paused or buffering, currentTime stuck) instead of
  // firing `onEnded`. So we advance off the metadata duration: once the playhead is
  // at/near the true end AND no longer progressing (paused, ended, or stalled), move
  // on. The "not progressing" gate means we never cut a still-playing track short.
  // Controller only — guests follow the host's broadcast.
  // Advance at most once per track — both this watchdog and `onEnded` can fire near
  // the end, and the watchdog keeps ticking until the room state updates and the
  // element remounts; without this guard a slow room update would skip several
  // tracks. Reset on the next track's onLoadStart.
  const endHandled = useRef(false)
  const lastTick = useRef(0)
  // While THIS client is actively seeking, it's the authority on its own playhead:
  // ignore the (delayed, possibly out-of-order) echo of the seeks we just broadcast,
  // so rapid arrow-seeks don't jump around chasing stale server frames. Window is
  // pushed forward on each seek, so a burst stays local until it settles + the echo
  // catches up.
  const localSeekUntil = useRef(0)
  // Debounce the authoritative jam-clock sync so a burst of arrow-seeks re-stamps the
  // shared timeline once (the final spot), not on every keystroke.
  const seekSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSeekMs = useRef(0)
  useEffect(
    () => () => {
      if (seekSyncTimer.current) clearTimeout(seekSyncTimer.current)
    },
    [],
  )
  // Desktop reports the real (full-extraction) audio duration when it resolves a
  // track, correcting the approximate flat-search value stored at match/ingest. Pick
  // that up once per track when the audio is ready, so the bar matches the audio.
  const durationSyncedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!audioSrc || !canDrive) return
    lastTick.current = -1
    const id = setInterval(() => {
      const el = audioRef.current
      if (!el || !effectiveDuration || !(room?.is_playing ?? false)) return
      const nearEnd = el.currentTime >= effectiveDuration - 1.5
      const progressed = Math.abs(el.currentTime - lastTick.current) > 0.25
      lastTick.current = el.currentTime
      if (nearEnd && (el.paused || el.ended || !progressed) && !endHandled.current) {
        endHandled.current = true
        next.mutate()
      }
    }, 1500)
    return () => clearInterval(id)
  }, [audioSrc, canDrive, room?.is_playing, effectiveDuration, next])

  // Global player hotkeys (desktop-first): Space = play/pause, ←/→ = seek ∓10s.
  // Routed through the same togglePlay/seek paths as the buttons, so jam permissions
  // and guest-mute behavior carry over. `actions` is refreshed every render so the
  // single listener always calls the latest closures (no re-subscribe churn).
  const actions = useRef<{
    toggle: () => void
    seekBy: (delta: number) => void
    nudgeVolume: (delta: number) => void
  }>({ toggle: () => {}, seekBy: () => {}, nudgeVolume: () => {} })
  useEffect(() => {
    actions.current = {
      toggle: togglePlay,
      seekBy: (delta: number) => {
        if (!canDrive) return // guests follow the host's playhead
        const el = audioRef.current
        if (!el) return
        const dur = effectiveDuration || el.duration || 0
        const target = Math.max(
          0,
          dur > 0 ? Math.min(el.currentTime + delta, dur) : el.currentTime + delta,
        )
        el.currentTime = target
        setCurrentTime(target) // immediate local response
        localSeekUntil.current = performance.now() + 1200 // we own the playhead briefly
        // Preserve play/pause (a skip shouldn't start a paused track), but move the
        // shared playhead so a jam follows — debounced so a burst syncs once.
        pendingSeekMs.current = Math.round(target * 1000)
        const playing = !el.paused
        if (seekSyncTimer.current) clearTimeout(seekSyncTimer.current)
        seekSyncTimer.current = setTimeout(() => {
          syncPlayback.mutate({ positionMs: pendingSeekMs.current, isPlaying: playing })
        }, 300)
      },
      // Output volume is per-client (not shared), so anyone — including a passive
      // jam guest — can adjust their own. The volume effect applies + persists it.
      nudgeVolume: (delta: number) =>
        setVolume((v) => Math.min(1, Math.max(0, +(v + delta).toFixed(2)))),
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (!audioRef.current) return // nothing loaded → don't hijack keys
      // Don't hijack keys while typing or while any modal is open. We check BOTH
      // the event target and document.activeElement (in a dialog the focused input
      // and the key event's target can differ in WKWebView), plus the Radix
      // scroll-lock flag that marks an open dialog — so the jam code box, search,
      // and other dialog inputs always receive their keystrokes.
      const inField = (el: HTMLElement | null) =>
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      if (
        inField(e.target as HTMLElement | null) ||
        inField(document.activeElement as HTMLElement | null) ||
        document.body.hasAttribute('data-scroll-locked')
      )
        return // typing or a modal is open — leave the keys alone
      if (e.code === 'Space') {
        e.preventDefault()
        actions.current.toggle()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        actions.current.seekBy(10)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        actions.current.seekBy(-10)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        actions.current.nudgeVolume(0.05)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        actions.current.nudgeVolume(-0.05)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Lazy match-on-play: resolve the current track's source once; on failure skip.
  const attempted = useRef<string | null>(null)
  useEffect(() => {
    if (!track) {
      attempted.current = null
      return
    }
    if (matched || attempted.current === track.id) return
    attempted.current = track.id
    // The query the desktop runs against YouTube (title + artist). The cloud ignores
    // it on web and searches from the track's own fields.
    const query = [track.title, track.primary_artist].filter(Boolean).join(' ')
    matchTrack.mutate(
      { trackId: track.id, query },
      {
        onError: () => {
          // Only the controller skips on a genuine no-match — a guest's skip would
          // mutate their OWN room and bounce them out of the jam.
          if (!canDrive) return
          toast.error(`No YouTube match for “${track.title}” — skipping.`)
          next.mutate()
        },
      },
    )
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
  // The jam is logically playing but this client is silent — the browser blocked
  // gesture-less audio (a refresh, or a swallowed autoplay reject). The seek bar
  // still advances off the server clock, so without a cue it looks like it's
  // playing while nothing comes out. Surface a "Tap to play" affordance. Excluded:
  // a passive guest who muted on purpose (wantsAudio), and the still-loading gap.
  const audioBlocked =
    isShared && serverPlaying && !localPlaying && !loading && !!audioSrc && wantsAudio

  const queue = room?.queue ?? [] // explicit "Add to queue" (plays first)
  const contextLabel = room?.context_label ?? ''
  // The full context comes from the paginated query (while the panel is open);
  // seed the first paint from the small window the frame carries so it isn't empty
  // before page 1 lands.
  const loadedContext = contextQuery.data?.pages.flatMap((p: ContextPage) => p.results) ?? []
  const context = loadedContext.length ? loadedContext : (room?.context_window ?? [])
  const contextCount = room?.context_count ?? 0
  // Counts come from the frame's metadata (exact, gap-safe) — NOT the loaded slice,
  // which may be only the first page of a long list.
  const upcoming = queue.length + (room?.context_ahead ?? 0)

  function togglePlay() {
    const el = audioRef.current
    if (!el) return
    if (!canDrive) {
      // Passive jam guest: the button controls only THIS client's audio — it never
      // moves the shared jam, just whether you hear it. Record the intent so a
      // later host pause/resume honors it (see the reconcile effect). Tapping on
      // snaps to the live playhead so you rejoin in sync (and this click lifts the
      // autoplay block); tapping off silences you locally. If the jam is paused
      // there's nothing to play yet — just record the opt-in and the reconcile
      // effect starts you the moment the host resumes.
      if (el.paused) {
        setWantsAudio(true)
        if (serverPlaying) {
          const t = intendedSeconds(room)
          if (Number.isFinite(t)) el.currentTime = t
          void el.play().catch(() => {})
        }
      } else {
        setWantsAudio(false)
        el.pause()
      }
      return
    }
    // Intent comes from the shared `playing` (server truth in a jam), NOT the
    // local element — so every client toggles the same direction even if its own
    // <audio> drifted out of sync (e.g. an autoplay reject left it paused).
    const willPlay = !playing
    // Optimistic local response, then report to the server so the whole jam
    // follows — the broadcast echo reconciles everyone (including us). play()
    // rejects if the source failed to load; the <audio> onError surfaces it.
    if (willPlay) {
      // Tapping play is consent to audio. Matters for a guest who muted, then was
      // granted control: without this their wantsAudio would stay false and the
      // reconcile effect would re-mute them on the next jam-play.
      setWantsAudio(true)
      void el.play().catch(() => {})
    } else el.pause()
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
    localSeekUntil.current = performance.now() + 1200 // we own the playhead until the echo lands
    // Scrubbing to a spot means "play from here" — start playback locally and
    // move the shared playhead (is_playing: true) so the whole jam follows.
    void el.play().catch(() => {})
    syncPlayback.mutate({ positionMs: Math.round(seconds * 1000), isPlaying: true })
  }

  // Drag-reorder the user queue: optimistically reorder the cached room.queue so the
  // rows don't snap back, then persist (the mutation re-seeds the room from the echo).
  function reorderQueueItem(itemId: string, toIndex: number) {
    qc.setQueryData<Room>(roomKeys.me(), (r) => {
      if (!r) return r
      const from = r.queue.findIndex((i) => i.id === itemId)
      if (from < 0) return r
      return { ...r, queue: arrayMove([...r.queue], from, toIndex) }
    })
    reorderQueue.mutate({ itemId, position: toIndex })
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
              <Button size="sm" variant="ghost" onClick={() => setSaveQueueOpen(true)}>
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
              (thumb only), capped so a long queue can't run off-screen. Pages in more
              of a long context as you near the bottom. */}
          <div
            onScroll={(e) => {
              const el = e.currentTarget
              if (
                contextQuery.hasNextPage &&
                !contextQuery.isFetchingNextPage &&
                el.scrollHeight - el.scrollTop - el.clientHeight < 64
              ) {
                void contextQuery.fetchNextPage()
              }
            }}
            className="max-h-56 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-y-auto px-4 py-2 sm:max-h-72"
          >
            {queue.length > 0 && (
              <QueueSection
                label="Next in queue"
                items={queue}
                onPlay={(id) => jump.mutate(id)}
                onRemove={(id) => removeItem.mutate(id)}
                canPlay={canDrive}
                canRemove={canEditQueue}
                // Drag to reorder the up-next queue (host-only edit, like remove).
                sortable={canEditQueue}
                onReorder={reorderQueueItem}
              />
            )}
            <QueueSection
              label={contextLabel ? `Playing from ${contextLabel}` : 'Now playing'}
              items={context}
              currentId={itemId}
              onPlay={(id) => jump.mutate(id)}
              onRemove={(id) => removeItem.mutate(id)}
              emptyHint={queue.length === 0 ? 'Nothing queued.' : undefined}
              canPlay={canDrive}
              canRemove={canEditQueue}
            />
            {contextQuery.isFetchingNextPage && (
              <p className="text-muted-foreground py-1 text-center text-xs">Loading…</p>
            )}
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
            ref={playPauseRef}
            size="icon"
            variant="shadow"
            onClick={togglePlay}
            aria-label={
              loading
                ? 'Loading'
                : !canDrive
                  ? playing
                    ? 'Mute'
                    : 'Unmute'
                  : audioBlocked
                    ? 'Play sound'
                    : playing
                      ? 'Pause'
                      : 'Play'
            }
            aria-busy={loading || undefined}
            // A passive jam guest can't move the shared playhead, so for them this
            // is a MUTE toggle (speaker icon) over their own audio — togglePlay
            // branches on canDrive. A driver gets Play/Pause. Only source/loading
            // disables it. Pulse when the browser blocked our audio, to point the
            // user at the one tap that starts it.
            disabled={!audioSrc || loading}
            className={
              audioBlocked ? 'ring-primary/60 ring-2 motion-safe:animate-pulse' : undefined
            }
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : !canDrive ? (
              playing ? (
                <Volume2 className="size-5" />
              ) : (
                <VolumeX className="size-5" />
              )
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
              there and let the full-screen view handle seeking (tap the artwork).
              When the browser has blocked our audio (a refresh mid-jam), the bar
              would advance silently — so replace it with an explicit "Tap to play"
              that resumes this client. Shown on phones too, where there's no bar. */}
          {room?.pending_start ? (
            <p className="text-muted-foreground mt-1 text-xs">Starting…</p>
          ) : !audioSrc ? (
            <p className="text-muted-foreground mt-1 text-xs">Finding audio…</p>
          ) : audioBlocked ? (
            <button
              type="button"
              onClick={togglePlay}
              className="text-primary mt-1 flex items-center gap-1 text-xs font-medium motion-safe:animate-pulse"
            >
              <VolumeX className="size-3.5" />
              Tap to play sound
            </button>
          ) : (
            <div className="mt-1 hidden sm:block">
              <SeekBar
                currentTime={currentTime}
                duration={effectiveDuration}
                onSeek={seek}
                disabled={!canDrive}
              />
            </div>
          )}
        </div>

        {/* Global volume — like play/pause, available from the bar (not just the
            full-screen view). Output volume is per-client, so a passive jam guest
            controls their own too. Compact: just the speaker icon until hover/focus.
            Hidden on phones, where the full-screen view owns volume. */}
        <VolumeControl
          volume={volume}
          onVolumeChange={setVolume}
          compact
          className="group/vol mr-1 hidden sm:flex"
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => shuffle.mutate()}
          aria-label="Shuffle"
          disabled={contextCount < 2 || !canEditQueue}
        >
          <Shuffle className="size-4" />
        </Button>
        {/* Wrapper so the count badge isn't clipped by the Button's
            overflow-hidden (which the ripple needs). */}
        <span className="relative inline-flex">
          <Button size="icon" variant="ghost" onClick={() => setJamOpen(true)} aria-label="Jam">
            <Radio className={`size-4 ${isShared ? 'text-primary' : ''}`} />
          </Button>
          {isShared && memberCount > 0 && (
            <span className="bg-primary text-primary-foreground ring-background motion-safe:animate-pop-in pointer-events-none absolute -top-1 -right-1 flex size-[18px] items-center justify-center rounded-full text-[10px] leading-none font-bold tabular-nums ring-2">
              {memberCount > 9 ? '9+' : memberCount}
            </span>
          )}
        </span>
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
          duration={effectiveDuration}
          audioReady={!!audioSrc}
          canNext={upcoming > 0 && canDrive}
          canDrive={canDrive}
          volume={volume}
          onTogglePlay={togglePlay}
          onPrevious={handlePrevious}
          onNext={() => canDrive && next.mutate()}
          onSeek={seek}
          onVolumeChange={setVolume}
          onClose={() => setExpanded(false)}
        />
      )}

      {audioSrc && (
        <audio
          key={itemId ?? track.id}
          ref={audioRef}
          src={audioSrc}
          // Buffer ahead even while parked (pending_start) so canplay fires and we
          // can report synced-start readiness without the user pressing play.
          preload="auto"
          onCanPlay={maybeReportReady}
          onLoadStart={() => {
            // Just resetting the scrubber. Do NOT mark buffering here: a restored
            // track loads its source without ever playing (no onPlaying/onPause to
            // clear it), which would strand the spinner forever. Buffering is tied
            // to a real play attempt (onPlay) or a mid-play stall (onWaiting).
            setCurrentTime(0)
            setDuration(0)
            endHandled.current = false // fresh track → re-arm the end watchdog
            // This element (keyed per track) just remounted, so it starts paused
            // and fires no onPause. Reset local-playing so a passive guest's button
            // doesn't read "Pause" before their new track's audio actually starts;
            // onPlaying flips it back true the instant playback begins.
            setLocalPlaying(false)
          }}
          onWaiting={() => setBuffering(true)} // re-buffering mid-track
          onCanPlayThrough={() => {
            // The desktop engine resolved this track (and reported its true duration
            // to the cloud) before streaming it; now that it's buffered, refetch the
            // room once so the seek bar picks up the corrected active_source duration.
            if (!IS_DESKTOP || durationSyncedRef.current === itemId) return
            durationSyncedRef.current = itemId
            void qc.invalidateQueries({ queryKey: roomKeys.me() })
          }}
          onPlay={() => {
            setBuffering(true) // requested — spinner until it actually starts
            connectAnalyser() // wire the visualizer on the first play gesture
          }}
          onPlaying={() => {
            // Real playback started — flip to "playing" so the button matches reality.
            setBuffering(false)
            setLocalPlaying(true)
          }}
          onPause={() => {
            setBuffering(false)
            setLocalPlaying(false)
          }}
          onTimeUpdate={(e) => {
            // The element only ticks while it's actually playing, so its time is the
            // truth for the bar — including in a jam (this is the audio we hear, and
            // it never lags the server clock after a seek). The server-clock effect
            // above only drives the bar when the element is paused (blocked/buffering).
            setCurrentTime(e.currentTarget.currentTime)
          }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          // Only the controller advances on end. A passive guest now plays real
          // audio, so their element fires onEnded too — but a guest's next.mutate()
          // hits their OWN room and bounces them out of the jam. They instead wait
          // for the host's next frame (the reconcile effect re-syncs them); if they
          // merely drifted ahead, it seeks them back and resumes the same track.
          onEnded={() => {
            if (!canDrive || endHandled.current) return
            endHandled.current = true
            next.mutate()
          }}
          onError={() => {
            // The stream failed to load (couldn't extract audio from YouTube).
            setBuffering(false)
            setLocalPlaying(false)
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

type QueueRowProps = {
  item: QueueItem
  isCurrent: boolean
  played: boolean
  canPlay: boolean
  canRemove: boolean
  onPlay: (itemId: string) => void
  onRemove: (itemId: string) => void
}

/** The play button + remove button — shared by the plain and the draggable row. */
function QueueRowBody({
  item,
  isCurrent,
  played,
  canPlay,
  canRemove,
  onPlay,
  onRemove,
}: QueueRowProps) {
  return (
    <>
      <button
        type="button"
        onClick={() => canPlay && onPlay(item.id)}
        disabled={!canPlay}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm ${
          played ? 'opacity-50' : ''
        } ${isCurrent ? 'font-medium' : ''} ${!canPlay ? 'cursor-default' : ''}`}
        title={canPlay ? `Play ${item.track.title}` : item.track.title}
      >
        {isCurrent ? (
          <Play className="text-primary size-3 shrink-0" />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <TrackArtwork track={item.track} className="size-7 rounded-sm" />
        {item.track.is_explicit && <ExplicitBadge />}
        <span className="truncate">{item.track.title}</span>
        <span className="text-muted-foreground truncate text-xs">{item.track.primary_artist}</span>
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.track.title}`}
          className="text-muted-foreground hover:text-foreground px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </>
  )
}

/** A draggable queue row (drag handle on the left), styled to match the plain row. */
function SortableQueueRow(props: QueueRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    transition: { duration: 220, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' },
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-1 rounded transition-colors duration-150 ${
        isDragging
          ? 'bg-muted relative z-10 shadow-lg'
          : props.isCurrent
            ? 'bg-muted'
            : 'hover:bg-muted/60'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${props.item.track.title}`}
        className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none px-0.5 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <QueueRowBody {...props} />
    </li>
  )
}

function QueueSection({
  label,
  items,
  onPlay,
  onRemove,
  currentId = null,
  emptyHint,
  canPlay = true,
  canRemove = false,
  sortable = false,
  onReorder,
}: {
  label: string
  items: QueueItem[]
  onPlay: (itemId: string) => void
  onRemove: (itemId: string) => void
  currentId?: string | null
  emptyHint?: string
  // Playing a row is a playback action (a guest with control can); removing is a
  // host-only queue edit — gated separately.
  canPlay?: boolean
  canRemove?: boolean
  // Drag-to-reorder (the user queue only — the context list is pointer-stable).
  sortable?: boolean
  onReorder?: (itemId: string, position: number) => void
}) {
  const curIdx = currentId ? items.findIndex((i) => i.id === currentId) : -1
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const to = items.findIndex((i) => i.id === over.id)
    if (to >= 0) onReorder?.(String(active.id), to)
  }

  const rows = items.map((item, i) => {
    const props: QueueRowProps = {
      item,
      isCurrent: item.id === currentId,
      played: curIdx >= 0 && i < curIdx, // earlier in the list (already passed)
      canPlay,
      canRemove,
      onPlay,
      onRemove,
    }
    return sortable ? (
      <SortableQueueRow key={item.id} {...props} />
    ) : (
      <li
        key={item.id}
        className={`group flex items-center gap-2 rounded transition-colors duration-150 ${
          props.isCurrent ? 'bg-muted' : 'hover:bg-muted/60'
        }`}
      >
        <QueueRowBody {...props} />
      </li>
    )
  })

  return (
    <div className="mb-2">
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      {items.length === 0 && emptyHint && (
        <p className="text-muted-foreground py-1 text-sm">{emptyHint}</p>
      )}
      {sortable && onReorder ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-0.5">{rows}</ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ol className="space-y-0.5">{rows}</ol>
      )}
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
