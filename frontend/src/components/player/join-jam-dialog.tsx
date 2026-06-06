import { Radio } from 'lucide-react'
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
import { useJoinRoom } from '@/lib/hooks/mutations/rooms'

/** Enter a code to join someone's jam. Matches the Jam dialog's look. */
export function JoinJamDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const join = useJoinRoom()
  const [code, setCode] = useState('')
  const [wiggle, setWiggle] = useState(false)

  const submit = () => {
    const c = code.trim()
    if (!c) return
    join.mutate(c, {
      onSuccess: () => {
        setCode('')
        onOpenChange(false)
      },
      onError: () => {
        setWiggle(true)
        setTimeout(() => setWiggle(false), 450)
        toast.error('That jam code didn’t work — it may have ended.')
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setCode('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 text-left">
            <span className="from-primary to-accent text-primary-foreground shadow-primary/30 flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
              <Radio className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Join a jam</DialogTitle>
              <DialogDescription className="mt-0.5">
                Enter the code a host shared with you.
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
          <input
            autoFocus
            value={code}
            onChange={(e) =>
              setCode(
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
            className={`border-input bg-background focus-visible:ring-ring placeholder:text-muted-foreground/40 w-full rounded-xl border py-3 text-center font-mono text-2xl font-bold tracking-[0.4em] uppercase focus-visible:ring-2 focus-visible:outline-none ${wiggle ? 'border-destructive animate-wiggle' : ''}`}
          />
          <Button
            type="submit"
            variant="shadow"
            className="w-full"
            disabled={!code || join.isPending}
          >
            {join.isPending ? 'Joining…' : 'Join jam'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
