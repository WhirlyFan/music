import { useForm } from '@tanstack/react-form'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { useReauthenticate } from '@/lib/auth/mfa'

/**
 * Re-confirm the user's password before a sensitive operation. allauth
 * gates a handful of endpoints (adding/removing a passkey, viewing
 * recovery codes, etc.) with a `reauthenticate` flow when the session
 * isn't "fresh" — this card handles that step.
 *
 * Behavior:
 *   - Submit password → POST /_allauth/browser/v1/auth/reauthenticate
 *   - On 200: call `onConfirmed()` (the caller proceeds with the
 *     sensitive op + refetches whatever data was previously 401'd)
 *   - Wrong password → server returns 400 with a field-bound error;
 *     surfaces inline via `parseAllAuthErrors` + `<FormError>` (no
 *     toast — inline is already announced via `role="alert"`)
 *   - Form-level / network failures → toast via `bannerError`
 */
const schema = z.object({ password: z.string().min(1, 'Required') })

export function ReauthenticateStep({
  description = 'Re-enter your password to continue.',
  onConfirmed,
  onCancel,
}: {
  description?: string
  onConfirmed: () => void
  onCancel?: () => void
}) {
  const reauth = useReauthenticate()
  const form = useForm({
    defaultValues: { password: '' },
    onSubmit: async ({ value }) => {
      if (reauth.isPending) return
      const res = await reauth.mutateAsync(value.password)
      if (res.status === 200) {
        onConfirmed()
        return
      }
      // Wrong password is field-bound → it renders inline below. Only
      // toast for unparseable / form-level failures.
      const msg = bannerError(res, 'Could not confirm your password. Try again.')
      if (msg) toast.error(msg)
    },
    validators: { onSubmit: schema },
  })
  const parsed = parseAllAuthErrors(reauth.data)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="bg-card space-y-4 rounded-md border p-4"
      aria-labelledby="reauth-heading"
    >
      <div>
        <h2 id="reauth-heading" className="font-medium">
          Confirm it’s you
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      <form.Field name="password">
        {(field) => {
          const errorMsg =
            fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['password']?.[0]
          return (
            <div className="space-y-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                Password
              </label>
              <Input
                id={field.name}
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                aria-required="true"
                aria-invalid={errorMsg ? true : undefined}
                aria-errormessage={errorMsg ? `${field.name}-error` : undefined}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FormError id={`${field.name}-error`} message={errorMsg} />
            </div>
          )
        }}
      </form.Field>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={reauth.isPending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={reauth.isPending} aria-busy={reauth.isPending || undefined}>
          {reauth.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Confirming…
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </form>
  )
}

/**
 * Detects allauth's "reauthenticate" pending flow on any response. Use to
 * decide whether to render the ReauthenticateStep card before the
 * sensitive content.
 */
export function requiresReauth(res: { status?: number; data?: unknown } | undefined): boolean {
  if (!res || res.status !== 401) return false
  const flows = (res.data as { flows?: Array<{ id?: string }> })?.flows
  return Boolean(flows?.some((f) => f.id === 'reauthenticate'))
}
