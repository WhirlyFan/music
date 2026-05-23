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
import { buttonVariants } from '@/components/ui/button'

import { overlay } from './overlay'

type ConfirmOpts = {
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
}

export async function confirm(opts: ConfirmOpts): Promise<boolean> {
  const result = await overlay.openAsync<boolean>(({ isOpen, close, unmount }) => (
    <AlertDialog open={isOpen} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent onCloseAutoFocus={() => !isOpen && unmount()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={opts.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
          >
            {opts.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ))
  return result === true
}
