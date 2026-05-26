import { cn } from '@/lib/utils'

/**
 * Inline form/field error. Wrapped in role="alert" so screen readers
 * announce the message as soon as it appears in the DOM.
 *
 * Use for both field-level errors (associate with input via id +
 * aria-errormessage) and form-level summaries.
 */
export function FormError({
  id,
  message,
  className,
}: {
  id?: string
  message?: string | null
  className?: string
}) {
  if (!message) return null
  return (
    <p id={id} role="alert" className={cn('text-xs text-destructive', className)}>
      {message}
    </p>
  )
}
