import { ExternalLink, Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { AudioVisualizer } from '@/components/player/audio-visualizer'
import { SeekBar } from '@/components/player/seek-bar'
import { ExplicitBadge } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import type { Track } from '@/lib/query/catalog'

/** Human label + so we can show the right "open on …" verb for the origin link. */
function sourceLabel(url: string): string {
  if (url.includes('spotify.com')) return 'Spotify'
  if (url.includes('music.apple.com')) return 'Apple Music'
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube'
  return 'the source'
}

/** A small play/pause toggle for the 30s preview clip (the official Spotify/Apple
 *  snippet) — distinct from the full YouTube stream. Pauses the main player while
 *  it plays so they never overlap; self-contained <audio>, stops on unmount. */
function PreviewButton({ url, onStart }: { url: string; onStart: () => void }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = new Audio(url)
    ref.current = el
    el.onended = () => setPlaying(false)
    return () => {
      el.pause()
      ref.current = null
    }
  }, [url])

  function toggle() {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      onStart() // pause the full track first
      void el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={toggle}>
      {playing ? <Pause className="mr-1 size-3.5" /> : <Volume2 className="mr-1 size-3.5" />}
      {playing ? 'Stop preview' : '30s preview'}
    </Button>
  )
}

/**
 * Full-screen "now playing" view (Apple-style), expanded from the bottom bar by
 * clicking the artwork. Drives the same <audio> in the bar via props — no
 * duplicated playback state. Immersive blurred-cover backdrop; Esc / × to close.
 */
export function FullScreenPlayer({
  track,
  analyser,
  playing,
  currentTime,
  duration,
  audioReady,
  canNext,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onPauseMain,
  onCorrect,
  onClose,
}: {
  track: Track
  analyser: AnalyserNode | null
  playing: boolean
  currentTime: number
  duration: number
  audioReady: boolean
  canNext: boolean
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
  onSeek: (seconds: number) => void
  onPauseMain: () => void
  onCorrect: (videoId: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const source = track.active_source
  const ytUrl =
    source?.locator_kind === 'video_id' ? `https://www.youtube.com/watch?v=${source.locator}` : null
  const subtitle = [track.primary_artist, track.album_name].filter(Boolean).join(' · ')

  // Portal to <body>: the bottom bar uses backdrop-blur, which makes it the
  // containing block for fixed descendants — rendering inside it would pin this
  // overlay to the bar's ~64px box instead of the viewport.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${track.title}`}
      className="motion-safe:animate-fade-in fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Immersive backdrop: the cover, blurred + darkened (no canvas/CORS needed). */}
      {track.artwork_url ? (
        <div
          aria-hidden
          className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl brightness-50"
          style={{ backgroundImage: `url(${track.artwork_url})` }}
        />
      ) : (
        <div aria-hidden className="bg-background absolute inset-0" />
      )}
      <div aria-hidden className="bg-background/70 absolute inset-0" />

      <Button
        size="icon"
        variant="ghost"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 z-10"
      >
        <X className="size-5" />
      </Button>

      <div className="motion-safe:animate-slide-up relative z-10 flex w-full max-w-md flex-col items-center gap-5 px-6">
        <div className="relative grid size-96 place-items-center">
          <AudioVisualizer analyser={analyser} artworkUrl={track.artwork_url} />
          {track.artwork_url ? (
            <img
              src={track.artwork_url}
              alt=""
              className="relative z-10 aspect-square w-48 rounded-xl object-cover shadow-2xl"
            />
          ) : (
            <div className="bg-muted relative z-10 aspect-square w-48 rounded-xl shadow-2xl" />
          )}
        </div>

        <div className="w-full text-center">
          <div className="flex items-center justify-center gap-2">
            {track.is_explicit && <ExplicitBadge />}
            <h2 className="truncate text-xl font-semibold tracking-tight">{track.title}</h2>
          </div>
          {subtitle && <p className="text-muted-foreground mt-1 truncate text-sm">{subtitle}</p>}
        </div>

        {/* Transport + seek (required — the bar is covered by this overlay). */}
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-center gap-4">
            <Button size="icon" variant="ghost" onClick={onPrevious} aria-label="Previous">
              <SkipBack className="size-6" />
            </Button>
            <Button
              size="icon"
              variant="shadow"
              onClick={onTogglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={!audioReady}
              className="size-14 rounded-full"
            >
              {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onNext}
              aria-label="Next"
              disabled={!canNext}
            >
              <SkipForward className="size-6" />
            </Button>
          </div>
          {audioReady ? (
            <SeekBar currentTime={currentTime} duration={duration} onSeek={onSeek} />
          ) : (
            <p className="text-muted-foreground text-center text-xs">Finding audio…</p>
          )}
        </div>

        {/* Details: where it came from, what's actually playing, and the clip. */}
        <dl className="border-border/60 w-full space-y-2 border-t pt-4 text-sm">
          {track.source_url && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                <a
                  href={track.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-1 font-medium"
                >
                  Open on {sourceLabel(track.source_url)} <ExternalLink className="size-3.5" />
                </a>
              </dd>
            </div>
          )}
          {ytUrl && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground shrink-0">Audio</dt>
              <dd className="text-right">
                <a
                  href={ytUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-1"
                  title={source?.title ?? undefined}
                >
                  <span className="max-w-[12rem] truncate">via YouTube</span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const id = window.prompt('Paste the correct YouTube video ID:')
                    if (id) onCorrect(id)
                  }}
                  className="text-muted-foreground hover:text-foreground ml-3 text-xs underline"
                >
                  Wrong song?
                </button>
              </dd>
            </div>
          )}
          {track.isrc && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">ISRC</dt>
              <dd className="font-mono text-xs">{track.isrc}</dd>
            </div>
          )}
          {track.preview_url && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Preview</dt>
              <dd>
                <PreviewButton url={track.preview_url} onStart={onPauseMain} />
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>,
    document.body,
  )
}
