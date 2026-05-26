import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { z } from 'zod'

import { Button, buttonVariants } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, parseAllAuthErrors } from '@/lib/auth/errors'
import { useRequestPasswordReset } from '@/lib/auth/hooks'

export const Route = createFileRoute('/account/password/forgot')({
  component: ForgotPasswordPage,
  head: () => ({ meta: [{ title: 'Reset password — react-django-template' }] }),
})

const schema = z.object({
  email: z.email('Enter a valid email address'),
})

function ForgotPasswordPage() {
  const request = useRequestPasswordReset()

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      if (request.isPending) return
      await request.mutateAsync(value.email)
    },
    // Submit-time validation only — errors on every keystroke is hostile UX.
    validators: { onSubmit: schema },
  })

  // allauth always returns 200 here — successful "request" doesn't disclose
  // whether the email actually exists. We treat any 2xx response as success
  // and show the "check your email" state.
  const submitted = request.data?.status === 200

  if (submitted) {
    return (
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <MailCheck className="text-success mx-auto h-12 w-12" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground text-sm">
            If an account exists for that email, we sent a link to reset your password. The link
            expires in a few hours.
          </p>
        </div>
        <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Back to log in
        </Link>
      </div>
    )
  }

  const parsed = parseAllAuthErrors(request.data)
  const summary = bannerError(request.data, 'Could not send reset email. Try again.')

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground text-sm">
          Enter the email address for your account. We&apos;ll send you a link to set a new
          password.
        </p>
      </div>

      {summary ? (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          id="forgot-form-error"
        >
          {summary}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-describedby={summary ? 'forgot-form-error' : undefined}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => {
            const fieldErr = parsed.byField['email']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
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
          disabled={request.isPending}
          aria-busy={request.isPending || undefined}
          className="w-full"
        >
          {request.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Remember your password?{' '}
        <Link to="/login" className="text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
