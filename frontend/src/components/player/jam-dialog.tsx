import { Check, Copy, Crown, LogOut, Radio, UserMinus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Room } from '@/lib/api/models'
import { dicebearAvatarUrl } from '@/lib/auth/avatar'
import {
  useKickMember,
  useLeaveRoom,
  useSetGuestControl,
  useShareRoom,
  useUnshareRoom,
} from '@/lib/hooks/mutations/rooms'

type Member = { user_id: string; username: string; role: string }

/**
 * Jam controls. Listening together is built on the room: the host shares a code,
 * guests join and follow in sync. Host sees the code + members + the guest-control
 * toggle + "End jam"; a guest sees who's listening + "Leave".
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
  const kick = useKickMember()
  const [copied, setCopied] = useState(false)

  const isHost = !!myUserId && room.host_id === myUserId
  const shared = room.is_shared ?? false
  const members = (room.members ?? []) as Member[]
  const link = room.code ? `${window.location.origin}/?jam=${room.code}` : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Couldn’t copy — select the code manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 text-left">
            <span className="from-primary to-accent text-primary-foreground shadow-primary/30 relative flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
              {shared && (
                <span className="bg-primary/50 absolute inset-0 rounded-full motion-safe:animate-ping" />
              )}
              <Radio className="relative size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{shared ? 'Jam in progress' : 'Start a jam'}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {shared
                  ? 'Everyone hears the same track, in sync.'
                  : 'Listen together — same track, same spot.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Not a jam yet → the host starts one. */}
        {!shared && isHost && (
          <Button
            variant="shadow"
            className="w-full"
            disabled={share.isPending}
            onClick={() => share.mutate()}
          >
            <Radio className="mr-2 size-4" />
            {share.isPending ? 'Starting…' : 'Start a jam'}
          </Button>
        )}

        {/* Active jam — code, members, controls. */}
        {shared && (
          <div className="space-y-5">
            {isHost && (
              <div className="space-y-2.5">
                <div className="flex justify-center gap-1.5">
                  {(room.code ?? '').split('').map((ch, i) => (
                    <span
                      key={`${ch}-${i}`}
                      style={{ animationDelay: `${i * 45}ms` }}
                      className="from-primary/10 to-accent/10 border-border/70 motion-safe:animate-pop-in flex size-11 items-center justify-center rounded-xl border bg-gradient-to-br font-mono text-2xl font-bold"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
                <Button variant="outline" className="w-full" onClick={copy}>
                  {copied ? (
                    <>
                      <Check className="mr-2 size-4" /> Copied invite link
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 size-4" /> Copy invite link
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <Users className="size-3.5" /> Listening · {members.length}
              </p>
              <ul className="space-y-1.5">
                {members.map((m, i) => (
                  <li
                    key={m.user_id}
                    style={{ animationDelay: `${i * 60}ms` }}
                    className="group motion-safe:animate-fade-in flex items-center gap-2.5"
                  >
                    <div className="relative shrink-0">
                      <Avatar className="size-8">
                        <AvatarImage src={dicebearAvatarUrl(m.username)} alt="" />
                        <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="bg-success ring-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {m.username}
                      {m.user_id === myUserId && (
                        <span className="text-muted-foreground font-normal"> (you)</span>
                      )}
                    </span>
                    {m.role === 'host' ? (
                      <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                        <Crown className="size-3" /> Host
                      </span>
                    ) : (
                      isHost && (
                        <button
                          type="button"
                          onClick={() => kick.mutate(m.user_id)}
                          disabled={kick.isPending}
                          aria-label={`Remove ${m.username}`}
                          title={`Remove ${m.username}`}
                          className="text-muted-foreground hover:text-destructive ease-standard rounded-md p-1 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <UserMinus className="size-4" />
                        </button>
                      )
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
                className="border-border bg-muted/30 hover:bg-muted/50 ease-standard flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Let guests control</span>
                  <span className="text-muted-foreground text-xs">
                    Play, pause, seek &amp; skip
                  </span>
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                    room.allow_guest_control ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`ease-out-back absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      room.allow_guest_control ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
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
