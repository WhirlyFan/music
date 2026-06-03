import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
 * A single-line text prompt as a modal. Resolves the trimmed string, or `null`
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
    <AlertDialog open={isOpen} onOpenChange={(o) => !o && close(null)}>
      <AlertDialogContent onCloseAutoFocus={() => !isOpen && unmount()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
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
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!name} onClick={() => name && close(name)}>
            {opts.confirmLabel ?? 'Save'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
