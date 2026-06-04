import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
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

const urlSchema = z.string().url()

/** Surface the backend's specific message (unsupported host, Spotify not
 *  configured, unreadable link) instead of a generic one. */
function ingestErrorMessage(error: unknown): string | null {
  if (!error) return null
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Something went wrong — try again.'
}

/**
 * The home hub: one centered box that does both. Paste a Spotify / Apple Music /
 * YouTube link → import it. Type anything else → search songs (Spotify metadata,
 * YouTube audio on play) and pick what to play. URL imports fire on submit (you
 * might still be pasting); text searches run live as you type (React Query caches).
 */
export function ImportHub() {
  const ingest = useIngest()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [text, setText] = useState('')

  const trimmed = text.trim()
  const isUrl = urlSchema.safeParse(trimmed).success

  // Debounced query that drives the live search; Enter promotes it immediately.
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(trimmed), 350)
    return () => clearTimeout(id)
  }, [trimmed])
  // Don't search a URL (that's an import) — only free text.
  const search = useSongSearch(isUrl ? '' : q)

  async function doImport() {
    try {
      const result = await ingest.mutateAsync(trimmed)
      setImported(result) // a capped-import warning (result.note) renders in the result view
      setText('')
    } catch (err) {
      toast.error(ingestErrorMessage(err) ?? 'Import failed — check the link and try again.')
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isUrl) doImport()
    else if (trimmed) setQ(trimmed) // search now (don't wait for the debounce)
  }

  const queue = (id: string) =>
    queueTracks.mutate({ trackIds: [id] }, { onSuccess: () => toast.success('Added to queue.') })

  const searching = !isUrl && trimmed.length > 0

  return (
    <div className="space-y-8">
      <section className="mx-auto flex max-w-xl flex-col items-center pt-10 text-center sm:pt-16">
        <h1 className="shimmer-text text-3xl font-semibold tracking-tight">
          What do you want to hear?
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Search for a song, or paste a Spotify, Apple Music, or YouTube link.
        </p>

        <form onSubmit={onSubmit} aria-label="Search or import" className="mt-6 w-full space-y-3">
          <div className="relative">
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
          {/* The Import button appears only once the input is a real link — plain
              text searches live below, no button needed. */}
          {isUrl && (
            <RainbowButton
              type="submit"
              size="lg"
              aria-busy={ingest.isPending || undefined}
              aria-disabled={ingest.isPending || undefined}
              className={`rounded-full ${ingest.isPending ? 'pointer-events-none opacity-60' : ''}`}
            >
              {ingest.isPending ? 'Importing…' : 'Import'}
            </RainbowButton>
          )}
        </form>
      </section>

      {searching ? (
        <SearchResults search={search} q={q} onPlay={playNow.mutate} onQueue={queue} />
      ) : (
        imported && <ImportResultView result={imported} />
      )}
    </div>
  )
}

/** Live song-search results for the home box (free-text, not a link). */
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
  // Toast + nothing-inline on failure (e.g. Spotify down/rate-limited).
  useEffect(() => {
    if (search.isError)
      toast.error(ingestErrorMessage(search.error) ?? 'Search failed.', { id: 'song-search-error' })
  }, [search.isError, search.error])

  const results = search.data ?? []
  const showSkeleton = q.length > 0 && search.isLoading
  const empty = q.length > 0 && !search.isPending && !search.isError && results.length === 0

  return (
    <section aria-label="Search results" className="mx-auto max-w-2xl space-y-2">
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

/** The just-imported tracks, with play / queue verbs (no playlist created). */
function ImportResultView({ result }: { result: ImportResult }) {
  const play = usePlay()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const createPlaylist = useCreatePlaylist()
  const trackIds = result.tracks.map((t) => t.id)

  async function saveAsPlaylist() {
    // Prompt for a name, pre-filled with the source's title (editable / optional).
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
      className="border-border mx-auto max-w-2xl space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 id="import-result-heading" className="font-medium">
            {result.title}
          </h2>
          <p className="text-muted-foreground text-sm">{result.track_count} tracks imported</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => play.mutate({ trackIds, label: result.title })}
          >
            Play all
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() =>
              queueTracks.mutate({ trackIds }, { onSuccess: () => toast.success('Added to queue.') })
            }
          >
            Add all to queue
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={saveAsPlaylist}>
            Save as playlist
          </Button>
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
        {result.tracks.map((track, i) => (
          <li key={track.id} className="border-border flex items-center gap-3 rounded-lg border p-3">
            <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
              {i + 1}
            </span>
            <TrackArtwork track={track} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {track.is_explicit && <ExplicitBadge />}
                <p className="truncate font-medium">{track.title}</p>
              </div>
              <p className="text-muted-foreground truncate text-sm">
                {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => playNow.mutate(track.id)}>
                Play
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  queueTracks.mutate(
                    { trackIds: [track.id] },
                    { onSuccess: () => toast.success('Added to queue.') },
                  )
                }
              >
                Add
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
