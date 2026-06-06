import { ListMusic } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useInfinitePlaylists } from '@/lib/hooks/queries/catalog'
import { useAddTrackToPlaylist } from '@/lib/hooks/queries/collaborators'

/**
 * Per-song "add to a playlist" picker — a dropdown listing the user's playlists.
 * This is the add-to-playlist entry point (the playlist edit page no longer carries
 * its own song search). The playlists query only runs when the menu is opened (the
 * list lives in a child that mounts on open) and shares the wall's cache key.
 */
export function AddToPlaylistButton({
  trackId,
  trackTitle,
}: {
  trackId: string
  trackTitle: string
}) {
  const add = useAddTrackToPlaylist()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Add ${trackTitle} to a playlist`}
          title="Add to a playlist"
        >
          <ListMusic className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <PickerList
          onPick={(playlistId, title) =>
            add.mutate(
              { playlistId, trackId },
              {
                onSuccess: (res) =>
                  toast.success(res.added ? `Added to “${title}”.` : `Already in “${title}”.`),
              },
            )
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PickerList({ onPick }: { onPick: (playlistId: string, title: string) => void }) {
  // Mounts only when the menu opens → lazy; reuses the playlists-wall cache key.
  const { data, isLoading } = useInfinitePlaylists('')
  const playlists = data?.pages.flatMap((p) => p.results) ?? []

  if (isLoading) {
    return <p className="text-muted-foreground px-2 py-3 text-center text-sm">Loading…</p>
  }
  if (playlists.length === 0) {
    return <p className="text-muted-foreground px-2 py-3 text-center text-sm">No playlists yet.</p>
  }
  return (
    <div className="max-h-64 [scrollbar-width:thin] overflow-y-auto">
      {playlists.map((p) => (
        <DropdownMenuItem key={p.id} onSelect={() => onPick(p.id, p.title)}>
          <span className="truncate">{p.title}</span>
        </DropdownMenuItem>
      ))}
    </div>
  )
}
