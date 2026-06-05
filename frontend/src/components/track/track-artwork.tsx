import { useQueryClient } from '@tanstack/react-query'
import { Music } from 'lucide-react'
import { useState } from 'react'

import { api } from '@/lib/api/client'
import type { Track } from '@/lib/api/models'
import { playlistKeys, roomKeys } from '@/lib/hooks/keys'
import { cn } from '@/lib/utils'

// Self-heal: external cover URLs (scdn.co / mzstatic / ytimg) can rot. When an
// <img> fails to load we ask the backend to re-resolve the cover from the source.
// Dedupe per track id so a dead cover doesn't trigger a storm of re-resolves.
const healing = new Set<string>()
async function healArtwork(id: string): Promise<string> {
  const t = await api<Track>(`/catalog/tracks/${id}/refresh-artwork/`, { method: 'POST' })
  return t.artwork_url ?? ''
}

/** Square cover for a track, normalized from the ingest source (Apple/Spotify),
 *  or a placeholder when none is available. Self-heals a broken cover URL by
 *  re-resolving it from the source (when a track `id` is provided). */
export function TrackArtwork({
  track,
  className,
}: {
  track: Pick<Track, 'artwork_url' | 'title'> & { id?: string }
  className?: string
}) {
  const qc = useQueryClient()
  const initial = track.artwork_url ?? ''
  const [src, setSrc] = useState(initial)
  const [shownFor, setShownFor] = useState(initial)
  if (initial !== shownFor) {
    // Prop changed (new track / freshly-resolved cover) → resync, allow a re-heal.
    setShownFor(initial)
    setSrc(initial)
  }

  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => {
          if (track.id && !healing.has(track.id)) {
            healing.add(track.id)
            healArtwork(track.id)
              .then((url) => {
                setSrc(url)
                // Propagate the re-resolved cover to every view (e.g. full-screen).
                void qc.invalidateQueries({ queryKey: roomKeys.all() })
                void qc.invalidateQueries({ queryKey: playlistKeys.all() })
              })
              .catch(() => setSrc(''))
          } else {
            setSrc('') // can't heal → placeholder
          }
        }}
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
