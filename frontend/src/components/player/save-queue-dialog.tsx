import { ListPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Room } from '@/lib/api/models'
import { isSessionAuthenticated } from '@/lib/auth/guards'
import { useSaveQueueAsPlaylist } from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useRoom } from '@/lib/hooks/queries/rooms'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

/** The track ids lined up to play, in order: now-playing, then the explicit queue,
 *  then the context remaining after the current item. Mirrors the server's
 *  save-as-playlist ordering so the snapshot matches what it would otherwise save. */
function linedUpTrackIds(room: Room | undefined): string[] {
  if (!room) return []
  const ids: string[] = []
  if (room.current?.id) ids.push(room.current.id)
  for (const i of room.queue ?? []) ids.push(i.track.id)
  const context = room.context ?? []
  const ctxIdx = context.findIndex((i) => i.id === room.current_item_id)
  const after = ctxIdx >= 0 ? context.slice(ctxIdx + 1) : context
  for (const i of after) ids.push(i.track.id)
  return ids
}

/** Save what's lined up (now-playing + queue + remaining context) as a new
 *  playlist. Opened from the queue panel or the FAB (open state in the store). */
export function SaveQueueDialog() {
  const open = usePlayerUiStore((s) => s.saveQueueOpen)
  const setOpen = usePlayerUiStore((s) => s.setSaveQueueOpen)
  const { data: session } = useSession()
  const { data: room } = useRoom(isSessionAuthenticated(session))
  const save = useSaveQueueAsPlaylist()
  const [name, setName] = useState('')
  // A snapshot of the lined-up track ids, frozen when the dialog opens — so if a
  // song ends while the dialog is open we still save what was playing then.
  const [snapshot, setSnapshot] = useState<string[]>([])

  // On open: default the name to where the queue is playing from, and freeze the
  // lined-up tracks (now-playing → queue → context after the current item, in play
  // order). Adjusted during render (not an effect) per the React "reset on prop
  // change" pattern, so it doesn't cascade renders.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(room?.context_label ?? '')
      setSnapshot(linedUpTrackIds(room))
    }
  }

  const submit = () => {
    const title = name.trim()
    if (!title) return
    save.mutate(
      { title, trackIds: snapshot },
      {
        onSuccess: () => {
          toast.success('Saved to your playlists.')
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 text-left">
            <span className="from-primary to-accent text-primary-foreground shadow-primary/30 flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
              <ListPlus className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Save queue</DialogTitle>
              <DialogDescription className="mt-0.5">
                Save what’s lined up as a new playlist.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            aria-label="Playlist name"
            maxLength={255}
          />
          <Button
            type="submit"
            variant="shadow"
            className="w-full"
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save playlist'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
