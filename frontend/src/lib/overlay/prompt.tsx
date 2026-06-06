import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { overlay, type OverlayAsyncProps } from './overlay'

type PromptOpts = {
  title: string
  description?: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
}

/**
 * A single-line text prompt as a plain modal (a regular Dialog, not an
 * AlertDialog — this isn't an interruptive confirmation, so clicking the scrim
 * or pressing Escape should dismiss it). Resolves the trimmed string, or `null`
 * if cancelled/dismissed. Pre-fill with `defaultValue` (e.g. an imported
 * playlist's source name); it's selected on focus so typing replaces it.
 */
export function promptText(opts: PromptOpts): Promise<string | null> {
  return overlay.openAsync<string | null>((props) => <PromptDialog {...props} opts={opts} />)
}

function PromptDialog({
  isOpen,
  close,
  unmount,
  opts,
}: OverlayAsyncProps<string | null> & { opts: PromptOpts }) {
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const name = value.trim()

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close(null)}>
      <DialogContent onCloseAutoFocus={() => !isOpen && unmount()}>
        <DialogHeader>
          <DialogTitle>{opts.title}</DialogTitle>
          {opts.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (name) close(name)
          }}
        >
          {opts.label && (
            <label htmlFor="prompt-input" className="text-sm font-medium">
              {opts.label}
            </label>
          )}
          <Input
            id="prompt-input"
            autoFocus
            value={value}
            placeholder={opts.placeholder}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
            aria-label={opts.label ?? opts.title}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button disabled={!name} onClick={() => name && close(name)}>
            {opts.confirmLabel ?? 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
