import { ListPlus } from 'lucide-react'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { Skeleton, SkeletonText, useSkeletonZone } from '@/components/ui/skeleton'
import type { Track } from '@/lib/api/models'

/**
 * One song result row: full-row play target + add-to-queue. Zone-driven skeleton
 * (same shell as the real row) when inside an active <SkeletonZone> or while the
 * track is still loading. Shared by the home search results.
 */
export function SongRow({
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
