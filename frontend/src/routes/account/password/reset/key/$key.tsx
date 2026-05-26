import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { z } from 'zod'

import { Button, buttonVariants } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { useCompletePasswordReset } from '@/lib/auth/hooks'

// $key is captured from the URL by TanStack Router's file-based routing.
// The reset email contains a link of the form
//   /account/password/reset/key/<long-opaque-token>
// allauth's HEADLESS_FRONTEND_URLS maps account_reset_password_from_key to
// this URL pattern in config/settings/base.py.
export const Route = createFileRoute('/account/password/reset/key/$key')({
  component: ResetPasswordPage,
  head: () => ({ meta: [{ title: 'Set new password — react-django-template' }] }),
})

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'At least 12 characters (NIST 2026 minimum, no other complexity required)'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords don’t match',
    path: ['confirm'],
  })

function ResetPasswordPage() {
  const { key } = Route.useParams()
  const navigate = useNavigate()
  const complete = useCompletePasswordReset()

  const form = useForm({
    defaultValues: { password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      if (complete.isPending) return
      const res = await complete.mutateAsync({ key, password: value.password })
      // 200 = password updated AND user logged in.
      if (res.status === 200) {
        // Brief pause so the success state is visible, then off to /notes.
        setTimeout(() => navigate({ to: '/notes' }), 1200)
      }
    },
    // Submit-time validation only — errors on every keystroke is hostile UX.
    validators: { onSubmit: schema },
  })

  if (complete.data?.status === 200) {
    return (
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <CheckCircle2 className="text-success mx-auto h-12 w-12" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
          <p className="text-muted-foreground text-sm">
            You&apos;re logged in. Redirecting to your notes…
          </p>
        </div>
      </div>
    )
  }

  const parsed = parseAllAuthErrors(complete.data)
  // 410 GONE = expired or already-used key. Show a distinct message — the
  // user can't recover by retrying with the same link.
  const expired = complete.data?.status === 410
  const summary = expired
    ? 'This reset link has expired or already been used. Request a new one.'
    : bannerError(complete.data, 'Could not reset password. The link may be invalid.')

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground text-sm">
          Pick a strong password — 12 characters or more. We screen against breached-password
          databases.
        </p>
      </div>

      {summary ? (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/30 bg-destructive/10 text-destructive space-y-2 rounded-md border p-3 text-sm"
          id="reset-form-error"
        >
          <p>{summary}</p>
          {expired ? (
            <Link
              to="/account/password/forgot"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Request a new link
            </Link>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-describedby={summary ? 'reset-form-error' : undefined}
        className="space-y-4"
      >
        <form.Field name="password">
          {(field) => {
            const fieldErr =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['password']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  New password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  aria-invalid={fieldErr ? true : undefined}
                  aria-errormessage={fieldErr ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={fieldErr} />
              </div>
            )
          }}
        </form.Field>

        <form.Field name="confirm">
          {(field) => {
            const fieldErr = fieldErrorMessage(field.state.meta.errors[0])
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Confirm password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  aria-invalid={fieldErr ? true : undefined}
                  aria-errormessage={fieldErr ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={fieldErr} />
              </div>
            )
          }}
        </form.Field>

        <Button
          type="submit"
          disabled={complete.isPending}
          aria-busy={complete.isPending || undefined}
          className="w-full"
        >
          {complete.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Updating…
            </>
          ) : (
            'Update password'
          )}
        </Button>
      </form>
    </div>
  )
}
