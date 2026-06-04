import { Music, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { useCreatePlaylist, useIngest, useSongSearch } from '@/lib/query/catalog'
import { usePlay, usePlayNow, useQueueTracks } from '@/lib/query/rooms'
import { cn } from '@/lib/utils'

const urlSchema = z.string().url()

/** Surface the backend's specific message (unsupported host, Spotify not
 *  configured, unreadable link) instead of a generic one. */
function ingestErrorMessage(error: unknown): string | null {
  if (!error) return null
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Something went wrong — try again.'
}

/**
 * The home hub: one box that does both. Paste a Spotify / Apple Music / YouTube
 * link → import it; type anything else → search songs. Google-style: it starts as
 * a centered hero (heading + box), and once you search or import it moves up into
 * a results/list view. Searching happens on submit (Enter or the button), not as
 * you type — React Query caches by term, so re-searching is free.
 */
export function ImportHub() {
  const ingest = useIngest()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [text, setText] = useState('')
  const [q, setQ] = useState('') // the submitted search term (drives the query)
  const fieldRef = useRef<HTMLDivElement>(null)

  const trimmed = text.trim()
  const isUrl = urlSchema.safeParse(trimmed).success
  const search = useSongSearch(q)
  const hasResults = q.length > 0 || imported !== null // → move to the list view

  async function doImport() {
    try {
      const result = await ingest.mutateAsync(trimmed)
      setQ('')
      setImported(result) // a capped-import warning (result.note) renders in the result view
      setText('')
    } catch (err) {
      toast.error(ingestErrorMessage(err) ?? 'Import failed — check the link and try again.')
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isUrl) {
      doImport()
    } else if (trimmed) {
      setImported(null)
      setQ(trimmed)
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

  const queue = (id: string) =>
    queueTracks.mutate({ trackIds: [id] }, { onSuccess: () => toast.success('Added to queue.') })

  return (
    <div className={cn('flex flex-col', hasResults ? 'gap-6 pt-2' : 'min-h-[60vh] justify-center gap-8')}>
      <section className="mx-auto w-full max-w-xl text-center">
        {!hasResults && (
          <>
            <h1 className="shimmer-text text-3xl font-semibold tracking-tight">
              What do you want to hear?
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Search for a song, or paste a Spotify, Apple Music, or YouTube link.
            </p>
          </>
        )}

        <form
          onSubmit={onSubmit}
          aria-label="Search or import"
          className={cn('flex w-full items-center gap-2', !hasResults && 'mt-6')}
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
              autoFocus
              aria-label="Search a song or paste a link"
              placeholder="Search a song, or paste a link"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-12 rounded-full pr-4 pl-11 text-base shadow-sm"
            />
          </div>
          {/* One button, labelled for what the input is: a link → Import, text → Search. */}
          <RainbowButton
            type="submit"
            size="lg"
            aria-busy={ingest.isPending || undefined}
            className={cn('h-12 shrink-0 rounded-full', ingest.isPending && 'pointer-events-none opacity-60')}
          >
            {ingest.isPending ? 'Importing…' : isUrl ? 'Import' : 'Search'}
          </RainbowButton>
        </form>
      </section>

      {q.length > 0 ? (
        <SearchResults search={search} q={q} onPlay={playNow.mutate} onQueue={queue} />
      ) : (
        imported && <ImportResultView result={imported} />
      )}
    </div>
  )
}

/** Song-search results for the home box (free text, not a link). */
function SearchResults({
  search,
  q,
  onPlay,
  onQueue,
}: {
  search: ReturnType<typeof useSongSearch>
  q: string
  onPlay: (id: string) => void
  onQueue: (id: string) => void
}) {
  // Toast on failure (e.g. Spotify down/rate-limited) — no inline red text.
  useEffect(() => {
    if (search.isError)
      toast.error(ingestErrorMessage(search.error) ?? 'Search failed.', { id: 'song-search-error' })
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
                <SongRow key={i} onPlay={onPlay} onQueue={onQueue} />
              ))
            : results.map((track) => (
                <SongRow key={track.id} track={track} onPlay={onPlay} onQueue={onQueue} />
              ))}
        </ol>
      </SkeletonZone>
    </section>
  )
}

/** Just-imported tracks, presented like a playlist detail page: cover + title +
 *  count + actions, then the track rows (shared SongRow). No playlist is created
 *  until "Save as playlist". */
function ImportResultView({ result }: { result: ImportResult }) {
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
    <section aria-labelledby="import-result-heading" className="mx-auto w-full max-w-2xl space-y-4 pb-28">
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
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Imported</p>
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
                queueTracks.mutate({ trackIds }, { onSuccess: () => toast.success('Added to queue.') })
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
