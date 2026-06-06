import { Check, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAddTracksToPlaylist } from '@/lib/hooks/queries/collaborators'
import { useSongSearch } from '@/lib/hooks/queries/catalog'
import { useDebounced } from '@/lib/use-debounced'

/** Search the catalog and add songs to this playlist — the write path collaborators
 *  (and owners) use to grow a shared playlist. Shown in edit mode. */
export function AddSongs({ playlistId }: { playlistId: string }) {
  const [term, setTerm] = useState('')
  const q = useDebounced(term, 350)
  const results = useSongSearch(q)
  const add = useAddTracksToPlaylist(playlistId)
  // Track ids added this session so the button can flip to a checkmark without a refetch.
  const [added, setAdded] = useState<Set<string>>(() => new Set())

  const onAdd = (trackId: string, title: string) =>
    add.mutate([trackId], {
      onSuccess: (res) => {
        setAdded((prev) => new Set(prev).add(trackId))
        toast.success(res.added > 0 ? `Added “${title}”.` : 'Already in this playlist.')
      },
    })

  return (
    <section className="bg-card border-border/60 space-y-3 rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="from-primary to-accent text-primary-foreground shadow-primary/30 flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
          <Plus className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium">Add songs</p>
          <p className="text-muted-foreground text-xs">Search and add tracks to this playlist.</p>
        </div>
      </div>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search songs…"
          aria-label="Search songs to add"
          className="rounded-full pl-9"
        />
      </div>

      {q && (
        <div className="border-border/60 divide-border/60 max-h-80 divide-y overflow-y-auto rounded-lg border [scrollbar-width:thin]">
          {results.isLoading ? (
            <RowSkeletons />
          ) : results.data && results.data.length > 0 ? (
            results.data.map((t) => {
              const done = added.has(t.id)
              return (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <TrackArtwork track={t} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-muted-foreground truncate text-xs">{t.primary_artist}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={done ? 'ghost' : 'default'}
                    className="rounded-full"
                    disabled={done || add.isPending}
                    onClick={() => onAdd(t.id, t.title)}
                  >
                    {done ? <Check className="size-4" aria-hidden /> : 'Add'}
                  </Button>
                </div>
              )
            })
          ) : (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {results.isError ? 'Search is unavailable right now.' : `No songs found for “${q}”.`}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function RowSkeletons() {
  return (
    <div className="space-y-3 p-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}
