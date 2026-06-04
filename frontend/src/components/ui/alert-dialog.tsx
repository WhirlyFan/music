import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

function AlertDialogOverlay({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      data-slot="alert-dialog-overlay"
      // Scrim is always dark (bg-black/40, not bg-foreground/X) so it dims
      // the page in both light + dark modes — using --foreground would
      // invert and brighten the page in dark mode. backdrop-blur-sm adds
      // a soft macOS-style blur to the content behind the dialog.
      className={cn(
        'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out fixed inset-0 z-50 bg-black/40 backdrop-blur-sm',
        'focus:outline-hidden',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        className={cn(
          'bg-background fixed top-[50%] left-[50%] z-50 grid w-[95vw] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-4 shadow-lg sm:rounded-lg',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          'focus:outline-hidden',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

function AlertDialogTitle({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      data-slot="alert-dialog-title"
      className={cn('text-foreground text-lg leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      data-slot="alert-dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

// asChild → render our <Button> so dialog actions get the same press ripple.
function AlertDialogAction({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button data-slot="alert-dialog-action" className={className} {...props} />
    </AlertDialogPrimitive.Action>
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button
        variant="outline"
        data-slot="alert-dialog-cancel"
        className={cn('mt-2 sm:mt-0', className)}
        {...props}
      />
    </AlertDialogPrimitive.Cancel>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
