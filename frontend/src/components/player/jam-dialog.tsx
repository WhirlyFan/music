import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Crown, Link2, LogOut, Radio, User, UserMinus, Users } from 'lucide-react'
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
import { isSessionAuthenticated, sessionUserId } from '@/lib/auth/guards'
import { roomKeys } from '@/lib/hooks/keys'
import {
  useJoinRoom,
  useKickMember,
  useLeaveRoom,
  useSetGuestControl,
  useShareRoom,
  useUnshareRoom,
} from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useJamMembers, useRoom } from '@/lib/hooks/queries/rooms'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

/**
 * The single Jam modal — opened from the player's Jam button, the FAB, or the
 * account menu (open state in the player-ui store). Self-contained: it reads the
 * current room and shows the right state — Start/Join when you're not in a jam,
 * or the live roster + controls when you are. The roster is a paginated infinite
 * query (frames carry only members_count).
 */
export function JamDialog() {
  const open = usePlayerUiStore((s) => s.jamOpen)
  const setOpen = usePlayerUiStore((s) => s.setJamOpen)
  const qc = useQueryClient()

  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const myUserId = sessionUserId(session)
  const { data: room } = useRoom(authed)

  const share = useShareRoom()
  const unshare = useUnshareRoom()
  const leave = useLeaveRoom()
  const join = useJoinRoom()
  const setGuestControl = useSetGuestControl()
  const kick = useKickMember()

  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [wiggle, setWiggle] = useState(false)

  const isHost = !!myUserId && room?.host_id === myUserId
  const shared = room?.is_shared ?? false
  const count = room?.members_count ?? 0
  const link = room?.code ? `${window.location.origin}/?jam=${room.code}` : ''

  const membersQuery = useJamMembers(open && shared)
  const members = membersQuery.data?.pages.flatMap((p) => p.results) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = membersQuery

  useEffect(() => {
    if (open && shared) void qc.invalidateQueries({ queryKey: roomKeys.members() })
  }, [open, shared, count, qc])

  const copy = async (kind: 'code' | 'link', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      toast.error('Couldn’t copy — select it manually.')
    }
  }

  const submitJoin = () => {
    const c = joinCode.trim()
    if (!c) return
    join.mutate(c, {
      onSuccess: () => setJoinCode(''),
      onError: () => {
        setWiggle(true)
        setTimeout(() => setWiggle(false), 450)
        toast.error('That jam code didn’t work — it may have ended.')
      },
    })
  }

  if (!room) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 text-left">
            <span className="from-primary to-accent text-primary-foreground shadow-primary/30 relative flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
              {shared && (
                <span className="bg-primary/50 absolute inset-0 rounded-full motion-safe:animate-ping" />
              )}
              <Radio className="relative size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{shared ? 'Jam in progress' : 'Jam'}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {shared
                  ? 'Everyone hears the same track, in sync.'
                  : 'Listen together — same track, same spot.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Not in a jam → start one, or join with a code. */}
        {!shared && (
          <div className="space-y-4">
            <Button
              variant="shadow"
              className="w-full"
              disabled={share.isPending}
              onClick={() => share.mutate()}
            >
              <Radio className="mr-2 size-4" />
              {share.isPending ? 'Starting…' : 'Start a jam'}
            </Button>

            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="bg-border h-px flex-1" /> or join with a code{' '}
              <span className="bg-border h-px flex-1" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitJoin()
              }}
              className="space-y-2"
            >
              <input
                value={joinCode}
                onChange={(e) =>
                  setJoinCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6),
                  )
                }
                placeholder="ABC123"
                aria-label="Jam code"
                autoComplete="off"
                autoCapitalize="characters"
                className={`border-input bg-background focus-visible:ring-ring placeholder:text-muted-foreground/40 w-full rounded-xl border py-2.5 text-center font-mono text-xl font-bold tracking-[0.35em] uppercase focus-visible:ring-2 focus-visible:outline-none ${
                  wiggle ? 'border-destructive animate-wiggle' : ''
                }`}
              />
              <Button type="submit" className="w-full" disabled={!joinCode || join.isPending}>
                {join.isPending ? 'Joining…' : 'Join jam'}
              </Button>
            </form>
          </div>
        )}

        {/* In a jam — code (host), roster, controls. */}
        {shared && (
          <div className="space-y-5">
            {isHost && (
              <div className="space-y-2.5">
                <div className="flex justify-center gap-1 sm:gap-1.5">
                  {(room.code ?? '').split('').map((ch, i) => (
                    <span
                      key={`${ch}-${i}`}
                      style={{ animationDelay: `${i * 45}ms` }}
                      className="from-primary/10 to-accent/10 border-border/70 motion-safe:animate-pop-in flex size-10 items-center justify-center rounded-xl border bg-gradient-to-br font-mono text-xl font-bold sm:size-12 sm:text-2xl"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => copy('link', link)}>
                    {copied === 'link' ? (
                      <Check className="mr-2 size-4" />
                    ) : (
                      <Link2 className="mr-2 size-4" />
                    )}
                    {copied === 'link' ? 'Copied' : 'Copy link'}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => copy('code', room.code ?? '')}
                  >
                    {copied === 'code' ? (
                      <Check className="mr-2 size-4" />
                    ) : (
                      <Copy className="mr-2 size-4" />
                    )}
                    {copied === 'code' ? 'Copied' : 'Copy code'}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <Users className="size-3.5" /> Listening · {count}
              </p>
              <ul
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (
                    hasNextPage &&
                    !isFetchingNextPage &&
                    el.scrollHeight - el.scrollTop - el.clientHeight < 48
                  ) {
                    void fetchNextPage()
                  }
                }}
                className="max-h-72 min-h-12 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] space-y-1.5 overflow-y-auto"
              >
                {members.map((m, i) => (
                  <li
                    key={m.user_id}
                    style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                    className="group motion-safe:animate-fade-in flex items-center gap-2.5"
                  >
                    <div className="relative shrink-0">
                      <span className="from-primary to-accent text-primary-foreground flex size-8 items-center justify-center rounded-full bg-gradient-to-br">
                        <User className="size-4" />
                      </span>
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
                {membersQuery.isPending && (
                  <li className="text-muted-foreground py-1 text-sm">Loading…</li>
                )}
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
                onClick={() => unshare.mutate(undefined, { onSuccess: () => setOpen(false) })}
              >
                End jam
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                disabled={leave.isPending}
                onClick={() => leave.mutate(undefined, { onSuccess: () => setOpen(false) })}
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
