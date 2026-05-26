import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { MailCheck, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { bannerError } from '@/lib/auth/errors'
import {
  isEmailVerificationPending,
  useResendEmailVerification,
  useSession,
} from '@/lib/auth/hooks'

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
  const navigate = useNavigate()
  const resend = useResendEmailVerification()

  // Self-healing: if the user verifies in another tab (or browser) and
  // session.data refetches into "authenticated + not pending verification",
  // bounce this tab to /. Without this, the signup tab would sit on the
  // waiting page forever after the user completed verification elsewhere.
  const sessionAuthenticated = Boolean(
    (session.data?.meta as { is_authenticated?: boolean } | undefined)?.is_authenticated,
  )
  const stillPending = isEmailVerificationPending(session.data)
  useEffect(() => {
    if (sessionAuthenticated && !stillPending) {
      toast.success('Email verified.')
      navigate({ to: '/' })
    }
  }, [sessionAuthenticated, stillPending, navigate])

  // Pull the in-progress email if allauth surfaces it; otherwise generic message.
  const emailHint = (session.data?.data as { user?: { email?: string } })?.user?.email

  const handleResend = async () => {
    if (resend.isPending) return
    const res = await resend.mutateAsync()
    if (res.status === 200) {
      toast.success('Verification email sent.')
    } else {
      const msg = bannerError(res, 'Could not resend the email. Try again in a moment.')
      if (msg) toast.error(msg)
    }
  }

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

      <Button
        variant="outline"
        onClick={handleResend}
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

      <p className="text-muted-foreground text-center text-xs">
        Already verified?{' '}
        <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Log in
        </Link>
      </p>
    </div>
  )
}
