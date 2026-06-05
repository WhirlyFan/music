import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, parseAllAuthErrors } from '@/lib/auth/errors'
import { useRequestPasswordReset } from '@/lib/hooks/mutations/auth'

export const Route = createFileRoute('/account/password/forgot')({
  component: ForgotPasswordPage,
  head: () => ({ meta: [{ title: 'Reset password — music' }] }),
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
      const result = await request.mutateAsync(value.email)
      // allauth always returns 200 here (don't leak which emails exist).
      // The page renders its "check your email" state below on result.status===200,
      // so we only toast on the rare error cases (5xx, network, etc).
      if (result.status !== 200) {
        const msg = bannerError(result, 'Could not send reset email. Try again.')
        if (msg) toast.error(msg)
      }
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
        <Button asChild variant="outline" size="sm">
          <Link to="/login">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back to log in
          </Link>
        </Button>
      </div>
    )
  }

  // Field errors stay inline via parsed.byField; form-level failures
  // surface as toast.error from onSubmit above.
  const parsed = parseAllAuthErrors(request.data)

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground text-sm">
          Enter the email address for your account. We&apos;ll send you a link to set a new
          password.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
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
