import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, parseAllAuthErrors } from '@/lib/auth/errors'
import {
  isEmailVerificationPending,
  isMfaChallenge,
  useLogin,
  useMfaAuthenticate,
} from '@/lib/auth/hooks'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  head: () => ({ meta: [{ title: 'Log in — react-django-template' }] }),
})

// `identifier` accepts either an email (contains @) or a username
// (3-30 chars, [a-zA-Z0-9_-]). The api wrapper picks which field name
// to submit based on the @.
const loginSchema = z.object({
  identifier: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
})

function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  // `mfaRequired` flips to true after a successful password step where the
  // server signaled `mfa_authenticate` is pending. Kept in state so it
  // survives unrelated re-renders.
  const [mfaRequired, setMfaRequired] = useState(false)

  const form = useForm({
    defaultValues: { identifier: '', password: '' },
    onSubmit: async ({ value }) => {
      // Idempotency guard — pairs with `disabled` on the submit button.
      if (login.isPending) return
      const result = await login.mutateAsync(value)
      if (result.status === 200) {
        navigate({ to: '/' })
      } else if (isMfaChallenge(result)) {
        setMfaRequired(true)
      } else if (isEmailVerificationPending(result)) {
        // Unverified user attempted to log in. Send them to the waiting
        // page where they can resend the verification email.
        navigate({ to: '/account/verify-email' })
      }
    },
    // Submit-time validation only — errors on every keystroke is hostile UX.
    validators: { onSubmit: loginSchema },
  })

  if (mfaRequired) {
    return <MfaChallenge onCancel={() => setMfaRequired(false)} />
  }

  // Parse allauth's structured error response so we can show actionable copy
  // instead of "400 Bad Request". The shape is { status, errors:[{message,param}] }.
  const parsed = parseAllAuthErrors(login.data)
  // Banner only for form-level errors (no specific field). MFA challenge
  // and verify-email-pending both have their own UI paths, not error banners.
  const summary =
    isMfaChallenge(login.data) || isEmailVerificationPending(login.data)
      ? null
      : bannerError(login.data, 'Login failed — check your credentials and try again.')

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>

      {/* Form-level error banner — assertive aria-live so screen readers
          interrupt with the message. Inline field errors below still
          appear under the specific input that caused the failure. */}
      {summary ? (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          id="login-form-error"
        >
          {summary}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-describedby={summary ? 'login-form-error' : undefined}
        className="space-y-4"
      >
        <form.Field name="identifier">
          {(field) => {
            const fieldErrors =
              parsed.byField['identifier'] ??
              parsed.byField['email'] ??
              parsed.byField['username'] ??
              []
            const errMsg = fieldErrors[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Email or username
                </label>
                <Input
                  id={field.name}
                  type="text"
                  autoComplete="username"
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

        <form.Field name="password">
          {(field) => {
            const errMsg = parsed.byField['password']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="current-password"
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

        <div className="flex items-center justify-end">
          <Link
            to="/account/password/forgot"
            className="text-muted-foreground hover:text-foreground text-xs hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={login.isPending}
          aria-busy={login.isPending || undefined}
          className="w-full"
        >
          {login.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Logging in…
            </>
          ) : (
            'Log in'
          )}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}

/**
 * Second step of login: prompt for the TOTP or recovery code. allauth has
 * already accepted the password on the server side; this finalizes the
 * session by hitting /_allauth/browser/v1/auth/2fa/authenticate.
 */
function MfaChallenge({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const mfa = useMfaAuthenticate()
  const codeForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      if (mfa.isPending) return
      const result = await mfa.mutateAsync(value.code.trim())
      if (result.status === 200) navigate({ to: '/' })
    },
  })
  const parsedMfa = parseAllAuthErrors(mfa.data)
  const mfaError = bannerError(mfa.data, 'Invalid code — try again.')

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor code</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          codeForm.handleSubmit()
        }}
        aria-describedby={mfaError ? 'mfa-form-error' : undefined}
        className="space-y-4"
      >
        <codeForm.Field name="code">
          {(field) => {
            const fieldErr = parsedMfa.byField['code']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Code
                </label>
                <Input
                  id={field.name}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={fieldErr ? true : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={fieldErr} />
              </div>
            )
          }}
        </codeForm.Field>

        <Button
          type="submit"
          disabled={mfa.isPending}
          aria-busy={mfa.isPending || undefined}
          className="w-full"
        >
          {mfa.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Verifying…
            </>
          ) : (
            'Verify'
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="w-full"
          disabled={mfa.isPending}
        >
          Cancel
        </Button>

        <FormError id="mfa-form-error" message={mfaError} />
      </form>
    </div>
  )
}
