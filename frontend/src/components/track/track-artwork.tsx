import { Music } from 'lucide-react'

import type { Track } from '@/lib/query/catalog'
import { cn } from '@/lib/utils'

/** Square cover for a track, normalized from the ingest source (Apple/Spotify),
 *  or a placeholder when none is available (e.g. a keyless-Spotify editorial track
 *  or a bare YouTube import). */
export function TrackArtwork({
  track,
  className,
}: {
  track: Pick<Track, 'artwork_url' | 'title'>
  className?: string
}) {
  if (track.artwork_url) {
    return (
      <img
        src={track.artwork_url}
        alt=""
        loading="lazy"
        className={cn('size-10 shrink-0 rounded-md object-cover', className)}
      />
    )
  }
  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-md',
        className,
      )}
    >
      <Music className="size-4" aria-hidden />
    </div>
  )
}

/** The standard "E" explicit badge. */
export function ExplicitBadge() {
  return (
    <span
      aria-label="Explicit"
      title="Explicit"
      className="bg-muted text-muted-foreground inline-grid size-4 shrink-0 place-items-center rounded-[3px] text-[10px] leading-none font-semibold"
    >
      E
    </span>
  )
}
