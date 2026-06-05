import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button, buttonVariants } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api/client'
import { auth } from '@/lib/auth/api'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { isEmailVerificationPending, isSessionAuthenticated, sessionEmail } from '@/lib/auth/guards'
import { sessionKeys } from '@/lib/hooks/keys'
import { resetForSession, useSignup } from '@/lib/hooks/mutations/auth'

export const Route = createFileRoute('/signup')({
  // Invite links arrive as /signup?invite=<token>. The loader redeems it (proving the
  // signer controls the address) — the backend stashes the email as verified for this
  // signup, so the new account is created already-verified with no confirmation mail.
  validateSearch: (search: Record<string, unknown>): { invite?: string } =>
    typeof search.invite === 'string' && search.invite ? { invite: search.invite } : {},
  // Reaching signup while already logged in needs handling — allauth's signup rejects
  // an active session with 409 Conflict. We surface the signed-in email so the page can
  // confirm a sign-out before accepting an invite (rather than destroying the session
  // silently). A logged-in visitor with no invite is already a member → send them home.
  beforeLoad: async ({ context, search }): Promise<{ signedInAs: string | null }> => {
    const session = await context.queryClient.fetchQuery({
      queryKey: sessionKeys.all(),
      queryFn: () => auth.session(),
      staleTime: 5 * 60 * 1000,
    })
    if (!isSessionAuthenticated(session)) return { signedInAs: null }
    if (!search.invite) throw redirect({ to: '/' })
    return { signedInAs: sessionEmail(session) }
  },
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: async ({ deps }): Promise<{ invitedEmail: string }> => {
    if (!deps.invite) return { invitedEmail: '' }
    try {
      const { email } = await api<{ email: string }>('/users/invite/redeem/', {
        method: 'POST',
        body: { token: deps.invite },
      })
      return { invitedEmail: email }
    } catch {
      // Invalid/expired invite → fall back to a normal signup + email verification.
      return { invitedEmail: '' }
    }
  },
  component: SignupPage,
  head: () => ({ meta: [{ title: 'Sign up — music' }] }),
})

// Keep this regex in sync with backend USERNAME_REGEX in apps/users/models.py.
const usernameRegex = /^[a-zA-Z0-9_-]+$/

const signupSchema = z
  .object({
    email: z.string().email(),
    username: z
      .string()
      .min(3, 'At least 3 characters')
      .max(30, 'At most 30 characters')
      .regex(usernameRegex, 'Letters, numbers, underscore, dash only'),
    // NIST 2026 guidance: length over complexity. No special-char / mixed-case
    // rules. Backend additionally screens against haveibeenpwned breach list.
    password: z.string().min(12, 'At least 12 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords don’t match',
    path: ['confirm'],
  })

/**
 * Shown when an invite link is opened while signed in as someone else. Confirms the
 * sign-out instead of doing it behind the user's back (per Microsoft/Clerk guidance for
 * the active-session conflict). "Continue" logs out + re-enters the route as anonymous,
 * where the normal redeem-and-stash path runs and the signup form renders.
 */
function ConfirmSignOut({
  signedInAs,
  invitedEmail,
}: {
  signedInAs: string
  invitedEmail: string
}) {
  const qc = useQueryClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // Invalid/expired invite while signed in → nothing to accept, and no reason to sign
  // the user out. Let them carry on as themselves.
  if (!invitedEmail) {
    return (
      <div className="mx-auto max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Invite unavailable</h1>
        <p className="text-muted-foreground text-sm">
          This invite link is invalid or has expired. You’re still signed in as{' '}
          <span className="font-medium">{signedInAs}</span>.
        </p>
        <Link to="/" className={buttonVariants({ className: 'w-full' })}>
          Go home
        </Link>
      </div>
    )
  }

  const onContinue = async () => {
    setBusy(true)
    try {
      await auth.logout()
      resetForSession(qc)
      // Re-run beforeLoad/loader: now anonymous, so the loader redeems + stashes the
      // verified email and this component is replaced by the signup form.
      await router.invalidate()
    } catch {
      setBusy(false)
      toast.error('Could not sign out. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Accept this invite?</h1>
      <p className="text-muted-foreground text-sm">
        You’re signed in as <span className="font-medium">{signedInAs}</span>. This invite is for{' '}
        <span className="font-medium">{invitedEmail}</span>. Continuing will sign you out so you can
        create that account.
      </p>
      <div className="flex gap-3">
        <Link to="/" className={buttonVariants({ variant: 'outline', className: 'flex-1' })}>
          Cancel
        </Link>
        <Button
          className="flex-1"
          onClick={onContinue}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Signing out…' : 'Sign out & continue'}
        </Button>
      </div>
    </div>
  )
}

function SignupPage() {
  const { signedInAs } = Route.useRouteContext()
  const { invitedEmail } = Route.useLoaderData()

  // Already signed in (only reachable with an invite — beforeLoad sends invite-less
  // members home). For a *signup* invite the address has no account, so the signed-in
  // user is necessarily a different identity → confirm a sign-out before continuing.
  // (Future: room/membership invites where signedInAs === invitedEmail would instead
  // be accepted in-place, no sign-out — the loader's redeem already no-ops its stash
  // for an authenticated caller, so that branch can hook in here.) Splitting the form
  // into its own component keeps its hooks out of this conditional (rules-of-hooks).
  if (signedInAs) return <ConfirmSignOut signedInAs={signedInAs} invitedEmail={invitedEmail} />
  return <SignupForm invitedEmail={invitedEmail} />
}

function SignupForm({ invitedEmail }: { invitedEmail: string }) {
  const navigate = useNavigate()
  const signup = useSignup()

  const form = useForm({
    defaultValues: { email: invitedEmail, username: '', password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      // Idempotency guard: if a request is already in-flight, ignore the
      // submission. Belt-and-suspenders with the `disabled` button below.
      if (signup.isPending) return
      // Drop `confirm` — allauth doesn't expect it. Schema already ensured
      // it matches `password`.
      const result = await signup.mutateAsync({
        email: value.email,
        username: value.username,
        password: value.password,
      })
      // Success in allauth's headless flow takes two shapes:
      //   - 200 + authenticated session (rare; only when verification is
      //     genuinely disabled)
      //   - 401 + verify_email pending flow (the common case — allauth
      //     created the user, sent the email, and is waiting for the
      //     verification click). Both are successful signups.
      if (result.status === 200) {
        navigate({ to: '/' })
      } else if (isEmailVerificationPending(result)) {
        navigate({ to: '/account/verify-email' })
      } else {
        // Form-level errors (rate limit, server error, etc.) — field-bound
        // errors stay inline.
        const msg = bannerError(result, 'Could not create account.')
        if (msg) toast.error(msg)
      }
    },
    // Submit-time validation only. Showing errors on every keystroke is
    // hostile UX — the user is mid-thought. After the first failed
    // submit, errors stay visible until the next submit attempt clears
    // them by re-running validation.
    validators: { onSubmit: signupSchema },
  })

  // Field-bound errors stay inline via parsed.byField; form-level failures
  // surface as toast.error from onSubmit above.
  const parsed = parseAllAuthErrors(signup.data)

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
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

        <form.Field name="confirm">
          {(field) => {
            const errMsg = fieldErrorMessage(field.state.meta.errors[0])
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
