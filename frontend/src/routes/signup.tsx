import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { isEmailVerificationPending, useSignup } from '@/lib/auth/hooks'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
  head: () => ({ meta: [{ title: 'Sign up — react-django-template' }] }),
})

// Keep this regex in sync with backend USERNAME_REGEX in apps/users/models.py.
const usernameRegex = /^[a-zA-Z0-9_-]+$/

const signupSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3, 'At least 3 characters')
    .max(30, 'At most 30 characters')
    .regex(usernameRegex, 'Letters, numbers, underscore, dash only'),
  // NIST 2026 guidance: length over complexity. No special-char / mixed-case
  // rules. Backend additionally screens against haveibeenpwned breach list.
  password: z.string().min(12, 'At least 12 characters'),
})

function SignupPage() {
  const navigate = useNavigate()
  const signup = useSignup()

  const form = useForm({
    defaultValues: { email: '', username: '', password: '' },
    onSubmit: async ({ value }) => {
      // Idempotency guard: if a request is already in-flight, ignore the
      // submission. Belt-and-suspenders with the `disabled` button below.
      if (signup.isPending) return
      const result = await signup.mutateAsync(value)
      // With ACCOUNT_EMAIL_VERIFICATION=mandatory, signup returns a
      // `verify_email` flow instead of an authenticated session. Send the
      // user to the "check your email" holding page until they click the link.
      if (isEmailVerificationPending(result)) {
        navigate({ to: '/account/verify-email' })
      } else if (result.status === 200) {
        navigate({ to: '/' })
      }
    },
    // Submit-time validation only. Showing errors on every keystroke is
    // hostile UX — the user is mid-thought. After the first failed
    // submit, errors stay visible until the next submit attempt clears
    // them by re-running validation.
    validators: { onSubmit: signupSchema },
  })

  const parsed = parseAllAuthErrors(signup.data)
  // Banner shows ONLY form-level errors (no field). When errors are
  // bound to specific fields, the inline FormError below each input
  // is the single source of truth — no duplicate banner.
  const summary = bannerError(signup.data, 'Could not create account.')

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

      {summary ? (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          id="signup-form-error"
        >
          {summary}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-describedby={summary ? 'signup-form-error' : undefined}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['email']?.[0]
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
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
              </div>
            )
          }}
        </form.Field>

        <form.Field name="username">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['username']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id={field.name}
                  type="text"
                  autoComplete="username"
                  placeholder="your-handle"
                  required
                  aria-required="true"
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  aria-describedby={`${field.name}-hint`}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
                <p id={`${field.name}-hint`} className="text-muted-foreground text-xs">
                  3–30 characters: letters, numbers, underscores, dashes.
                </p>
              </div>
            )
          }}
        </form.Field>

        <form.Field name="password">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['password']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  aria-describedby={`${field.name}-hint`}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
                <p id={`${field.name}-hint`} className="text-muted-foreground text-xs">
                  At least 12 characters. Avoid passwords used on other sites.
                </p>
              </div>
            )
          }}
        </form.Field>

        <Button
          type="submit"
          disabled={signup.isPending}
          aria-busy={signup.isPending || undefined}
          className="w-full"
        >
          {signup.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </div>
  )
}
