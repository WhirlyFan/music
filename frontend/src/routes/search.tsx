import { createFileRoute } from '@tanstack/react-router'
import { ListPlus, Search as SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton, SkeletonText, SkeletonZone, useSkeletonZone } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'
import { useSongSearch, type Track } from '@/lib/query/catalog'
import { usePlayNow, useQueueTracks } from '@/lib/query/rooms'

export const Route = createFileRoute('/search')({
  component: SearchPage,
  head: () => ({ meta: [{ title: 'Search — music' }] }),
})

/** Pull the backend's specific message (e.g. Spotify not configured) off an error. */
function errorMessage(error: unknown): string {
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Search failed — try again in a moment.'
}

function SearchPage() {
  const [text, setText] = useState('')
  // The query that actually drives the request. It trails typing by 350ms, but
  // Enter promotes the current text immediately — React Query caches by term, so
  // a typed-then-Enter (or repeat) search costs no extra request.
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350)
    return () => clearTimeout(id)
  }, [text])
  const search = useSongSearch(q)
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()

  const results = search.data ?? []
  const showSkeleton = q.length > 0 && search.isLoading // first load for a term
  const empty = q.length > 0 && !search.isPending && !search.isError && results.length === 0

  // Surface failures as a toast + a wiggle of the field (not inline red text). A
  // fixed toast id means a repeated failure replaces rather than stacks. This is a
  // real side-effect reaction to the query's error state, so it belongs in an effect.
  const fieldRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!search.isError) return
    toast.error(errorMessage(search.error), { id: 'song-search-error' })
    const el = fieldRef.current
    if (el) {
      el.classList.remove('animate-wiggle')
      void el.offsetWidth
      el.classList.add('animate-wiggle')
    }
  }, [search.isError, search.error])

  const queue = (id: string) =>
    queueTracks.mutate({ trackIds: [id] }, { onSuccess: () => toast.success('Added to queue.') })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Find any song — we pull the details and stream the YouTube audio on play.
        </p>
        <div
          ref={fieldRef}
          className="relative mt-4"
          onAnimationEnd={(e) => e.currentTarget.classList.remove('animate-wiggle')}
        >
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 z-10 size-5 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            autoFocus
            aria-label="Search songs"
            placeholder="Songs, artists, albums…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQ(text.trim())}
            className="h-12 rounded-full pr-4 pl-11 text-base shadow-sm"
          />
        </div>
      </div>

      {empty && <p className="text-muted-foreground text-sm">No songs match “{q}”.</p>}

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
    </div>
  )
}

/** One result row — zone-driven skeleton (same shell as the real row) when loading. */
function SongRow({
  track,
  onPlay,
  onQueue,
}: {
  track?: Track
  onPlay: (id: string) => void
  onQueue: (id: string) => void
}) {
  const skeleton = useSkeletonZone()

  if (skeleton || !track) {
    return (
      <li aria-hidden className="border-border flex items-center gap-3 rounded-lg border p-3">
        <Skeleton className="size-10 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <SkeletonText className="max-w-[14rem]" />
          <SkeletonText className="max-w-[9rem] text-sm" />
        </div>
      </li>
    )
  }

  return (
    <li className="border-border hover:bg-accent/40 relative flex items-center gap-3 overflow-hidden rounded-lg border p-3">
      {/* Full-row play target. */}
      <button
        type="button"
        aria-label={`Play ${track.title}`}
        onClick={() => onPlay(track.id)}
        className="absolute inset-0 rounded-lg"
      />
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
      <div className="relative z-10 flex items-center" onPointerDown={(e) => e.stopPropagation()}>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Add ${track.title} to queue`}
          title="Add to queue"
          onClick={() => onQueue(track.id)}
        >
          <ListPlus className="size-4" />
        </Button>
      </div>
    </li>
  )
}
