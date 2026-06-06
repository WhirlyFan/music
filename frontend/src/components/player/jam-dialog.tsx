import { Check, Copy, LogOut, Radio, Users } from 'lucide-react'
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
import type { Room } from '@/lib/api/models'
import {
  useLeaveRoom,
  useSetGuestControl,
  useShareRoom,
  useUnshareRoom,
} from '@/lib/hooks/mutations/rooms'

type Member = { user_id: string; username: string; role: string }

/**
 * Jam controls. Listening together is built on the room: the host shares a code,
 * guests join and follow in sync. Host sees the code + member list + "End jam";
 * a guest sees who's listening + "Leave". (Control stays host-only for now.)
 */
export function JamDialog({
  room,
  myUserId,
  open,
  onOpenChange,
}: {
  room: Room
  myUserId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const share = useShareRoom()
  const unshare = useUnshareRoom()
  const leave = useLeaveRoom()
  const setGuestControl = useSetGuestControl()
  const [copied, setCopied] = useState(false)

  const isHost = !!myUserId && room.host_id === myUserId
  const members = (room.members ?? []) as Member[]
  const link = room.code ? `${window.location.origin}/?jam=${room.code}` : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy — select the code manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5" /> Jam
          </DialogTitle>
          <DialogDescription>
            Listen together — everyone hears the same track, in sync.
          </DialogDescription>
        </DialogHeader>

        {/* Not a jam yet → only the host (their own room) can start one. */}
        {!room.is_shared && isHost && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Start a jam to get a code you can share. Anyone with it follows your playback.
            </p>
            <Button className="w-full" disabled={share.isPending} onClick={() => share.mutate()}>
              {share.isPending ? 'Starting…' : 'Start a jam'}
            </Button>
          </div>
        )}

        {/* Active jam — code + members. */}
        {room.is_shared && (
          <div className="space-y-4">
            {isHost && (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Share this code
                </p>
                <div className="flex items-center gap-2">
                  <code className="bg-muted flex-1 rounded-md px-3 py-2 text-center text-lg font-semibold tracking-[0.3em]">
                    {room.code}
                  </code>
                  <Button variant="outline" size="icon" onClick={copy} aria-label="Copy invite link">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <Users className="size-3.5" /> Listening ({members.length})
              </p>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between text-sm">
                    <span className={m.user_id === myUserId ? 'font-medium' : ''}>
                      {m.username}
                      {m.user_id === myUserId && ' (you)'}
                    </span>
                    {m.role === 'host' && (
                      <span className="text-muted-foreground text-xs">host</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {isHost && (
              <button
                type="button"
                role="switch"
                aria-checked={room.allow_guest_control ?? false}
                disabled={setGuestControl.isPending}
                onClick={() => setGuestControl.mutate(!room.allow_guest_control)}
                className="border-border flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>Let guests play/pause</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    room.allow_guest_control
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {room.allow_guest_control ? 'On' : 'Off'}
                </span>
              </button>
            )}

            {isHost ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={unshare.isPending}
                onClick={() => unshare.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
              >
                End jam
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                disabled={leave.isPending}
                onClick={() => leave.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
              >
                <LogOut className="mr-2 size-4" /> Leave jam
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
