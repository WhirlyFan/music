import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Music, Search } from 'lucide-react'
import { useEffect } from 'react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { SongRow } from '@/components/track/song-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RainbowButton } from '@/components/ui/rainbow-button'
import { SkeletonZone } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'
import type { ImportResult } from '@/lib/api/models'
import { useCreatePlaylist } from '@/lib/hooks/mutations/catalog'
import { usePlay, usePlayNow, useQueueTracks } from '@/lib/hooks/mutations/rooms'
import { importQuery, searchQuery, useImport, useSongSearch } from '@/lib/hooks/queries/catalog'
import { promptText } from '@/lib/overlay'
import { prefersReducedMotion } from '@/lib/reduced-motion'

const urlSchema = z.string().url()

/** Surface the backend's specific message (unsupported host, Spotify not
 *  configured, unreadable/private link) instead of a generic one. */
function apiErrorMessage(error: unknown): string | null {
  if (!error) return null
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Something went wrong — try again.'
}

/**
 * The Search/Import button label. Re-keying on `text` remounts the characters, so the
 * letters cascade up (char-roll) when the word swaps as the input becomes a link.
 *
 * While `waving`, the letters do a looping "Mexican wave" (char-wave). Each pass is a
 * single CSS iteration; when the last (most-delayed) letter finishes a pass we re-arm it
 * by bumping `cycle` (remounts the inner spans → replays) — but only if still hovered. On
 * mouse-leave we stop re-arming, so the in-flight pass runs to its rest state instead of
 * cutting abruptly. Nested spans keep the two transforms from fighting (outer rolls, inner
 * waves). Chars are decorative (`aria-hidden`); an `sr-only` copy names the control. Under
 * reduced motion we never start the wave (the global guard would otherwise zero its
 * duration and spin the re-arm loop); the swap roll is flattened to an instant swap.
 */
function RollingLabel({ text, waving }: { text: string; waving: boolean }) {
  const [cycle, setCycle] = useState(0)
  const [inFlight, setInFlight] = useState(false)
  // Snapshot reduced-motion once: gate the wave off so the zeroed-duration animation
  // can't spin the re-arm loop. Initializer runs once, no impure render.
  const [calm] = useState(prefersReducedMotion)
  const lastIndex = text.length - 1
  // Hovering OR mid-pass keeps the wave applied — so leaving mid-pass lets it finish.
  const active = (waving || inFlight) && !calm

  return (
    <>
      <span className="sr-only">{text}</span>
      <span key={text} aria-hidden className="flex overflow-hidden py-2 leading-none">
        {Array.from(text).map((ch, i) => (
          <span key={i} className="char-roll" style={{ animationDelay: `${i * 28}ms` }}>
            <span
              key={cycle}
              className={active ? 'char-wave is-waving' : 'char-wave'}
              style={{ animationDelay: `${i * 70}ms` }}
              onAnimationStart={(e) => {
                if (e.animationName === 'char-wave' && i === 0) setInFlight(true)
              }}
              onAnimationEnd={(e) => {
                if (e.animationName !== 'char-wave' || i !== lastIndex) return
                // Pass complete (ends on the last letter): re-arm if still hovered, else rest.
                if (waving) setCycle((c) => c + 1)
                else setInFlight(false)
              }}
            >
              {ch}
            </span>
          </span>
        ))}
      </span>
    </>
  )
}

/**
 * The shared search/import box. Type a song → navigate to `/search?q=`; paste a
 * Spotify / Apple Music / YouTube link → run the import (a mutation) then navigate
 * to `/import` to show the result. Used by the home, search, and import routes, so
 * you can search or import from any of them.
 *
 * `submit` shows the action button under the field (home hero): always visible, its
 * label rolling between "Search" and "Import" as the input becomes a link. Results
 * pages omit it — there the box is a compact re-search, submitted with Enter.
 */
export function OmniBox({
  initial = '',
  autoFocus = false,
  submit = false,
}: {
  initial?: string
  autoFocus?: boolean
  submit?: boolean
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState(() => initial)
  const [waving, setWaving] = useState(false) // pointer/focus over the action button
  const [validating, setValidating] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)

  const trimmed = text.trim()
  const isUrl = urlSchema.safeParse(trimmed).success

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed) {
      // Empty submit → wiggle the field (the placeholder says what to do).
      const el = fieldRef.current
      if (el) {
        el.classList.remove('animate-wiggle')
        void el.offsetWidth
        el.classList.add('animate-wiggle')
      }
      return
    }
    if (validating) return
    // Run the request HERE and only navigate once it succeeds — so a failed
    // import/search never strands the user on a broken results page. The fetch is
    // cached under the same key the destination reads, so it isn't run twice.
    setValidating(true)
    try {
      if (isUrl) {
        await qc.fetchQuery(importQuery(trimmed))
        navigate({ to: '/import', search: { url: trimmed } })
      } else {
        await qc.fetchQuery(searchQuery(trimmed))
        navigate({ to: '/search', search: { q: trimmed } })
      }
    } catch {
      toast.error(
        isUrl
          ? 'Couldn’t import that link — check it’s a Spotify, Apple Music, or YouTube URL.'
          : 'Search failed — try again in a moment.',
      )
    } finally {
      setValidating(false)
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Search or import" className="w-full">
      <div
        ref={fieldRef}
        className="relative"
        onAnimationEnd={(e) => e.currentTarget.classList.remove('animate-wiggle')}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 z-10 size-5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus={autoFocus}
          aria-label="Search a song or paste a link"
          placeholder="Search a song, or paste a link"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-12 rounded-full pr-4 pl-11 text-base shadow-sm"
        />
      </div>
      {/* The action button sits under the field and is always present on the hero; its
          label rolls between "Search" and "Import" as the input becomes a link. (Results
          pages don't pass `submit` — there the box re-searches on Enter.) */}
      {submit && (
        <div className="mt-8 flex justify-center">
          <RainbowButton
            type="submit"
            className="min-w-36"
            disabled={validating}
            onMouseEnter={() => setWaving(true)}
            onMouseLeave={() => setWaving(false)}
            onFocus={() => setWaving(true)}
            onBlur={() => setWaving(false)}
          >
            <RollingLabel
              text={
                validating ? (isUrl ? 'Importing…' : 'Searching…') : isUrl ? 'Import' : 'Search'
              }
              waving={waving}
            />
          </RainbowButton>
        </div>
      )}
    </form>
  )
}

/** Song-search results for the /search route (free text, not a link). Self-contained:
 *  reads the query + wires play/queue itself, so the route just passes `q`. */
export function SearchResults({ q }: { q: string }) {
  const search = useSongSearch(q)
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const queue = (id: string) =>
    queueTracks.mutate({ trackIds: [id] }, { onSuccess: () => toast.success('Added to queue.') })

  // Toast on failure (e.g. Spotify down/rate-limited) — no inline red text.
  useEffect(() => {
    if (search.isError)
      toast.error(apiErrorMessage(search.error) ?? 'Search failed.', { id: 'song-search-error' })
  }, [search.isError, search.error])

  const results = search.data ?? []
  const showSkeleton = search.isLoading
  const empty = !search.isPending && !search.isError && results.length === 0

  return (
    <section aria-label="Search results" className="mx-auto w-full max-w-2xl space-y-2 pb-28">
      {empty && <p className="text-muted-foreground text-center text-sm">No songs match “{q}”.</p>}
      <SkeletonZone active={showSkeleton}>
        <ol className="space-y-2">
          {showSkeleton
            ? Array.from({ length: 8 }).map((_, i) => (
                <SongRow key={i} onPlay={playNow.mutate} onQueue={queue} />
              ))
            : results.map((track) => (
                <SongRow key={track.id} track={track} onPlay={playNow.mutate} onQueue={queue} />
              ))}
        </ol>
      </SkeletonZone>
    </section>
  )
}

/** Just-imported tracks, presented like a playlist detail page: cover + title +
 *  count + actions, then the track rows (shared SongRow). No playlist is created
 *  until "Save as playlist". Rendered by the /import route from the last result. */
export function ImportResultView({ result }: { result: ImportResult }) {
  const navigate = useNavigate()
  const play = usePlay()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const createPlaylist = useCreatePlaylist()
  const trackIds = result.tracks.map((t) => t.id)

  const queue = (id: string) =>
    queueTracks.mutate({ trackIds: [id] }, { onSuccess: () => toast.success('Added to queue.') })

  async function saveAsPlaylist() {
    const name = await promptText({
      title: 'Save as playlist',
      label: 'Playlist name',
      defaultValue: result.title,
      confirmLabel: 'Save playlist',
    })
    if (!name) return
    createPlaylist.mutate(
      {
        title: name,
        trackIds,
        artworkUrl: result.cover ?? undefined,
        sourcePlaylist: result.source_playlist, // stamp origin → enables refresh
      },
      {
        onSuccess: (playlist) => {
          toast.success(`Saved “${name}”.`)
          // Land on the new playlist; the create invalidates the list cache, so
          // the top-left "playlists" pill (gated on having any) also appears.
          void navigate({
            to: '/playlists/$playlistId',
            params: { playlistId: playlist.id },
          })
        },
      },
    )
  }

  return (
    <section
      aria-labelledby="import-result-heading"
      className="mx-auto w-full max-w-2xl space-y-4 pb-28"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="bg-muted size-28 shrink-0 overflow-hidden rounded-lg shadow-md sm:size-36">
          {result.cover ? (
            <img src={result.cover} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center">
              <Music className="text-muted-foreground size-8" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Imported
          </p>
          <h2 id="import-result-heading" className="truncate text-2xl font-semibold tracking-tight">
            {result.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {result.track_count} track{result.track_count === 1 ? '' : 's'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => play.mutate({ trackIds, label: result.title })}>
              Play all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                queueTracks.mutate(
                  { trackIds },
                  { onSuccess: () => toast.success('Added to queue.') },
                )
              }
            >
              Add all to queue
            </Button>
            {result.already_saved ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/playlists/$playlistId" params={{ playlistId: result.already_saved }}>
                  Open saved playlist
                </Link>
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={saveAsPlaylist}>
                Save as playlist
              </Button>
            )}
          </div>
        </div>
      </div>

      {result.note && (
        <p
          role="status"
          className="motion-safe:animate-in motion-safe:fade-in rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          {result.note}
        </p>
      )}

      <ol className="space-y-2">
        {result.tracks.map((track) => (
          <SongRow key={track.id} track={track} onPlay={playNow.mutate} onQueue={queue} />
        ))}
      </ol>
    </section>
  )
}

/** The /import route body: runs the import for `url` (cached per URL) and renders a
 *  loading skeleton → the result. Errors surface as a toast; the route shows a hint. */
export function ImportView({ url }: { url: string }) {
  const imp = useImport(url)

  // Toast on failure (unsupported host, unreadable/private link) — no inline red text.
  useEffect(() => {
    if (imp.isError)
      toast.error(apiErrorMessage(imp.error) ?? 'Import failed — check the link and try again.', {
        id: 'import-error',
      })
  }, [imp.isError, imp.error])

  if (imp.isError) return null // toast shown; the route renders its hint instead
  if (imp.isLoading || !imp.data)
    return (
      <section aria-label="Importing" className="mx-auto w-full max-w-2xl space-y-2 pb-28">
        <SkeletonZone active>
          <ol className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <SongRow key={i} onPlay={() => {}} onQueue={() => {}} />
            ))}
          </ol>
        </SkeletonZone>
      </section>
    )
  return <ImportResultView result={imp.data} />
}
