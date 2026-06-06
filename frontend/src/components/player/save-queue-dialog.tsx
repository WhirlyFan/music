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
import { isSessionAuthenticated } from '@/lib/auth/guards'
import { useSaveQueueAsPlaylist } from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useRoom } from '@/lib/hooks/queries/rooms'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

/** Save what's lined up (now-playing + queue + remaining context) as a new
 *  playlist. Opened from the queue panel or the FAB (open state in the store). */
export function SaveQueueDialog() {
  const open = usePlayerUiStore((s) => s.saveQueueOpen)
  const setOpen = usePlayerUiStore((s) => s.setSaveQueueOpen)
  const { data: session } = useSession()
  const { data: room } = useRoom(isSessionAuthenticated(session))
  const save = useSaveQueueAsPlaylist()
  const [name, setName] = useState('')

  // Default the name to where the queue is playing from each time it opens —
  // adjusted during render (not an effect) per the React "reset on prop change"
  // pattern, so it doesn't cascade renders.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(room?.context_label ?? '')
  }

  const submit = () => {
    const title = name.trim()
    if (!title) return
    save.mutate(title, {
      onSuccess: () => {
        toast.success('Saved to your playlists.')
        setOpen(false)
      },
    })
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
