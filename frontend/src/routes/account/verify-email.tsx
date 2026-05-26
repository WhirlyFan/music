import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, MailCheck, RefreshCw } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { bannerError } from '@/lib/auth/errors'
import { useLogout, useResendEmailVerification, useSession } from '@/lib/auth/hooks'

export const Route = createFileRoute('/account/verify-email')({
  component: VerifyEmailWaitingPage,
  head: () => ({ meta: [{ title: 'Check your email — react-django-template' }] }),
})

/**
 * "Awaiting verification" screen — shown right after signup, or when an
 * unverified user logs in. ACCOUNT_EMAIL_VERIFICATION = "mandatory" means
 * allauth won't grant a real authenticated session until verification, so
 * this is effectively a holding page with one purpose: get the user to
 * click the link in their email.
 */
function VerifyEmailWaitingPage() {
  const session = useSession()
  const resend = useResendEmailVerification()
  const logout = useLogout()

  // Pull the in-progress email if allauth surfaces it; otherwise generic message.
  const emailHint = (session.data?.data as { user?: { email?: string } })?.user?.email

  const resendError = bannerError(resend.data, 'Could not resend the email. Try again in a moment.')
  const resent = resend.data?.status === 200

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-3 text-center">
        <MailCheck className="text-primary mx-auto h-12 w-12" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground text-sm">
          We sent a verification link to {emailHint ? <strong>{emailHint}</strong> : 'your inbox'}.
          Click the link to continue. The link expires in a few hours.
        </p>
      </div>

      {resendError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          {resendError}
        </div>
      ) : null}

      {resent ? (
        <div
          role="status"
          aria-live="polite"
          className="border-success/30 bg-success/10 text-success-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
        >
          <CheckCircle2 className="text-success h-4 w-4 shrink-0" aria-hidden="true" />
          Verification email sent.
        </div>
      ) : null}

      <div className="space-y-3">
        <Button
          variant="outline"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          aria-busy={resend.isPending || undefined}
          className="w-full"
        >
          {resend.isPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Resending…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Resend verification email
            </>
          )}
        </Button>

        <Button
          variant="ghost"
          onClick={async () => {
            await logout.mutateAsync()
          }}
          disabled={logout.isPending}
          className="w-full"
        >
          {logout.isPending ? 'Logging out…' : 'Use a different account'}
        </Button>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Already verified?{' '}
        <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Log in
        </Link>
      </p>
    </div>
  )
}
