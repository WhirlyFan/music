import { ListPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { useRoom, useRoomContext } from '@/lib/hooks/queries/rooms'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

type Head = { currentId: string | null; currentItemId: string | null; queueIds: string[] }

/** Save what's lined up (now-playing + queue + remaining context) as a new
 *  playlist. Opened from the queue panel or the FAB (open state in the store).
 *
 *  The played-from context can be huge and isn't in the room frame, so we pull it
 *  from the paginated context query (loading every page while the dialog is open).
 *  The head (now-playing + queue + the pointer) is frozen the moment the dialog
 *  opens, so a track ending mid-dialog doesn't change what gets saved; the server
 *  receives the resolved list verbatim. */
export function SaveQueueDialog() {
  const open = usePlayerUiStore((s) => s.saveQueueOpen)
  const setOpen = usePlayerUiStore((s) => s.setSaveQueueOpen)
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const { data: room } = useRoom(authed)
  const ctx = useRoomContext(authed && open)
  const save = useSaveQueueAsPlaylist()
  const [name, setName] = useState('')
  // The head, frozen at open (the big context list is stable during playback, so we
  // read it from the query and slice by the frozen pointer).
  const [head, setHead] = useState<Head>({ currentId: null, currentItemId: null, queueIds: [] })

  // On open: default the name + freeze the head. Adjusted during render (not an
  // effect) per the React "reset on prop change" pattern, so it doesn't cascade.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(room?.context_label ?? '')
      setHead({
        currentId: room?.current?.id ?? null,
        currentItemId: room?.current_item_id ?? null,
        queueIds: (room?.queue ?? []).map((i) => i.track.id),
      })
    }
  }

  // Eagerly page through the whole context while open, so the snapshot is complete.
  useEffect(() => {
    if (open && ctx.hasNextPage && !ctx.isFetchingNextPage) void ctx.fetchNextPage()
  }, [open, ctx.hasNextPage, ctx.isFetchingNextPage, ctx])

  const ready = !ctx.isLoading && !ctx.hasNextPage // full context loaded → snapshot is complete

  const trackIds = () => {
    const full = ctx.data?.pages.flatMap((p) => p.results) ?? []
    const idx = full.findIndex((i) => i.id === head.currentItemId)
    const after = idx >= 0 ? full.slice(idx + 1) : full // context remaining after the current item
    return [head.currentId, ...head.queueIds, ...after.map((i) => i.track.id)].filter(
      (id): id is string => !!id,
    )
  }

  const submit = () => {
    const title = name.trim()
    if (!title || !ready) return
    save.mutate(
      { title, trackIds: trackIds() },
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
            disabled={!name.trim() || !ready || save.isPending}
          >
            {save.isPending ? 'Saving…' : ready ? 'Save playlist' : 'Preparing…'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
