import { UserPlus } from 'lucide-react'
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
import { ApiError } from '@/lib/api/client'
import { useInvite } from '@/lib/hooks/mutations/auth'

/** Pull the backend's specific message (e.g. "already has an account") off a 400. */
function inviteErrorMessage(e: unknown): string {
  if (e instanceof ApiError && typeof e.detail === 'object' && e.detail) {
    const detail = (e.detail as { detail?: string }).detail
    if (detail) return detail
  }
  return 'Couldn’t send the invite — try again.'
}

/** Invite a friend by email — they get a link to join. Matches the jam dialogs. */
export function InviteFriendDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const invite = useInvite()
  const [email, setEmail] = useState('')

  const submit = () => {
    const e = email.trim()
    if (!e) return
    invite.mutate(e, {
      onSuccess: () => {
        toast.success(`Invite sent to ${e}.`)
        setEmail('')
        onOpenChange(false)
      },
      onError: (err) => toast.error(inviteErrorMessage(err)),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setEmail('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 text-left">
            <span className="from-primary to-accent text-primary-foreground shadow-primary/30 flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
              <UserPlus className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Invite a friend</DialogTitle>
              <DialogDescription className="mt-0.5">
                They’ll get an email with a link to join.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            submit()
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="their@email.com"
            aria-label="Friend's email address"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
          <Button
            type="submit"
            variant="shadow"
            className="w-full"
            disabled={!email.trim() || invite.isPending}
          >
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
