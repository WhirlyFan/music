import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { MailCheck, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { bannerError } from '@/lib/auth/errors'
import {
  hasVerifiedPrimaryEmail,
  useEmails,
  useResendEmailVerification,
  useSession,
} from '@/lib/auth/hooks'

export const Route = createFileRoute('/account/verify-email/')({
  component: VerifyEmailWaitingPage,
  head: () => ({ meta: [{ title: 'Check your email — react-django-template' }] }),
})

/**
 * "Awaiting verification" holding page. The user is authenticated (allauth
 * is in "optional" mode) but their EmailAddress.verified is False. The
 * root-route guard puts them here whenever they try to reach a protected
 * route, and the backend's RequireVerifiedEmailMiddleware blocks API calls
 * until they verify. Two ways out: click the link in the email, or use
 * the footer "Log in" link to switch accounts.
 */
function VerifyEmailWaitingPage() {
  const navigate = useNavigate()
  const session = useSession()
  const emails = useEmails()
  const resend = useResendEmailVerification()

  // Self-healing: if the user verifies in another tab and the email-list
  // cache refetches into "verified" (we invalidate it on verify), this tab
  // notices and navigates home. Without this, the signup tab would sit on
  // the waiting page forever after the user completed verification elsewhere.
  const verified = hasVerifiedPrimaryEmail(emails.data)
  useEffect(() => {
    if (verified) {
      navigate({ to: '/' })
    }
  }, [verified, navigate])

  // Pull the in-progress email from the session payload — it carries
  // `data.user.email` for both verified and unverified users in optional mode.
  const email = (session.data?.data as { user?: { email?: string } } | undefined)?.user?.email

  const handleResend = async () => {
    if (resend.isPending) return
    if (!email) {
      // Defensive — should never happen because the root guard only sends
      // authenticated users here, and authenticated users always have an
      // email on the session.
      toast.error('Could not determine which email to resend to.')
      return
    }
    const res = await resend.mutateAsync(email)
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
          We sent a verification link to {email ? <strong>{email}</strong> : 'your inbox'}. Click
          the link to continue. The link expires in a few hours.
        </p>
      </div>

      <Button
        variant="default"
        onClick={handleResend}
        disabled={resend.isPending || !email}
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
        Wrong account?{' '}
        <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Log in
        </Link>
      </p>
    </div>
  )
}
