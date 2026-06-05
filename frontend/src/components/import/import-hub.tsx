import { useNavigate } from '@tanstack/react-router'
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
import { promptText } from '@/lib/overlay'
import type { ImportResult } from '@/lib/query/catalog'
import { useCreatePlaylist, useImport, useSongSearch } from '@/lib/query/catalog'
import { usePlay, usePlayNow, useQueueTracks } from '@/lib/query/rooms'

const urlSchema = z.string().url()

/** Surface the backend's specific message (unsupported host, Spotify not
 *  configured, unreadable/private link) instead of a generic one. */
function apiErrorMessage(error: unknown): string | null {
  if (!error) return null
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Something went wrong — try again.'
}

/**
 * The shared search/import box. Type a song → navigate to `/search?q=`; paste a
 * Spotify / Apple Music / YouTube link → run the import (a mutation) then navigate
 * to `/import` to show the result. Used by the home, search, and import routes, so
 * you can search or import from any of them.
 */
export function OmniBox({
  initial = '',
  autoFocus = false,
}: {
  initial?: string
  autoFocus?: boolean
}) {
  const navigate = useNavigate()
  const [text, setText] = useState(() => initial)
  const fieldRef = useRef<HTMLDivElement>(null)

  const trimmed = text.trim()
  const isUrl = urlSchema.safeParse(trimmed).success

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isUrl) {
      navigate({ to: '/import', search: { url: trimmed } })
    } else if (trimmed) {
      navigate({ to: '/search', search: { q: trimmed } })
    } else {
      // Empty submit → wiggle the field (the placeholder says what to do).
      const el = fieldRef.current
      if (el) {
        el.classList.remove('animate-wiggle')
        void el.offsetWidth
        el.classList.add('animate-wiggle')
      }
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Search or import"
      className="flex w-full items-center gap-2"
    >
      <div
        ref={fieldRef}
        className="relative flex-1"
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
      {/* A button only for the explicit action — importing a pasted link. Searching
          is just Enter (it's a search box; a "Search" button would be redundant). The
          import itself runs on /import, which shows the loading state. */}
      {isUrl && (
        <RainbowButton type="submit" size="lg" className="h-12 shrink-0 rounded-full">
          Import
        </RainbowButton>
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
      { title: name, trackIds, artworkUrl: result.cover ?? undefined },
      { onSuccess: () => toast.success(`Saved “${name}”.`) },
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
            <Button size="sm" variant="outline" onClick={saveAsPlaylist}>
              Save as playlist
            </Button>
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
