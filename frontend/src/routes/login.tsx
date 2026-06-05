import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { GoogleButton } from '@/components/auth/google-button'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, parseAllAuthErrors } from '@/lib/auth/errors'
import { isEmailVerificationPending, isMfaChallenge, isMfaTrustPending } from '@/lib/auth/guards'
import { useLogin, useMfaAuthenticate, useMfaTrust } from '@/lib/hooks/mutations/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  // Optional return-path set by the auth guard in __root. Only same-origin
  // internal paths are honored (must start with a single '/') — guards against
  // open-redirect abuse via a crafted ?redirect=https://evil.com.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search.redirect
    return {
      redirect: typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : undefined,
    }
  },
  head: () => ({ meta: [{ title: 'Log in — music' }] }),
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
  const { redirect: redirectTo } = Route.useSearch()
  const dest = redirectTo ?? '/'
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
        navigate({ to: dest })
      } else if (isMfaChallenge(result)) {
        setMfaRequired(true)
      } else if (isEmailVerificationPending(result)) {
        // An existing user who never verified is logging in. allauth puts
        // them in the same pending-verification flow as a fresh signup —
        // route to the holding page so they can resend if needed.
        navigate({ to: '/account/verify-email' })
      } else {
        // Form-level failure (wrong credentials, account locked by axes, etc.)
        // Field-bound errors stay inline; this toast catches the rest.
        const msg = bannerError(result, 'Login failed — check your credentials and try again.')
        if (msg) toast.error(msg)
      }
    },
    // Submit-time validation only — errors on every keystroke is hostile UX.
    validators: { onSubmit: loginSchema },
  })

  if (mfaRequired) {
    return <MfaChallenge onCancel={() => setMfaRequired(false)} dest={dest} />
  }

  // Parse allauth's structured error response so we can show actionable copy
  // instead of "400 Bad Request". The shape is { status, errors:[{message,param}] }.
  // Field-bound errors are rendered inline below each input; form-level
  // failures bubble up via toast.error() from the onSubmit handler.
  const parsed = parseAllAuthErrors(login.data)

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
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

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <GoogleButton />

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
 * session by hitting the headless MFA-authenticate endpoint.
 *
 * If MFA_TRUST_ENABLED on the backend, a successful code submit advances to
 * the `mfa_trust` stage — we surface that inline with a "Remember this
 * browser for 30 days" choice and complete the stage in the same submit.
 */
function MfaChallenge({ onCancel, dest }: { onCancel: () => void; dest: string }) {
  const navigate = useNavigate()
  const mfa = useMfaAuthenticate()
  const trust = useMfaTrust()
  // Opt-in (unchecked by default). When checked, after the code is accepted
  // we silently POST trust:true so allauth mints the 30-day cookie.
  // Unchecked → we still post {trust: false} because allauth's trust stage
  // blocks the login until *some* answer is given.
  const [trustChoice, setTrustChoice] = useState(false)

  const codeForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      if (mfa.isPending || trust.isPending) return
      const result = await mfa.mutateAsync(value.code.trim())
      // With MFA_TRUST_ENABLED, an accepted code advances allauth to the
      // trust stage — the response is 401 + `mfa_trust: is_pending: true`,
      // NOT 200. Check trust-pending FIRST. Only then treat non-200 as a
      // genuine code rejection.
      if (isMfaTrustPending(result)) {
        const trustRes = await trust.mutateAsync(trustChoice)
        if (trustRes.status !== 200) {
          const msg = bannerError(trustRes, 'Could not finish login. Try again.')
          if (msg) toast.error(msg)
          return
        }
        navigate({ to: dest })
        return
      }
      if (result.status === 200) {
        // Trust not enabled (or already trusted) — code accepted, fully in.
        navigate({ to: dest })
        return
      }
      const msg = bannerError(result, 'Invalid code — try again.')
      if (msg) toast.error(msg)
    },
  })
  const parsedMfa = parseAllAuthErrors(mfa.data)
  const busy = mfa.isPending || trust.isPending

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Multi-factor code</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          codeForm.handleSubmit()
        }}
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

        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={trustChoice}
            onChange={(e) => setTrustChoice(e.target.checked)}
            disabled={busy}
          />
          <span>Remember this browser for 30 days</span>
        </label>

        <Button type="submit" disabled={busy} aria-busy={busy || undefined} className="w-full">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Verifying…
            </>
          ) : (
            'Verify'
          )}
        </Button>

        <Button type="button" variant="ghost" onClick={onCancel} className="w-full" disabled={busy}>
          Cancel
        </Button>
      </form>
    </div>
  )
}
