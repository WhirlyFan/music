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
 * "Awaiting verification" holding page. The user has signed up (or logged
 * in as an unverified existing user) and allauth is holding the session
 * in a `verify_email` pending flow. Two ways out: click the link in the
 * email (which we wired to /account/verify-email/$key), or hit "Resend".
 */
function VerifyEmailWaitingPage() {
  const navigate = useNavigate()
  const session = useSession()
  const emails = useEmails()
  const resend = useResendEmailVerification()

  // Self-healing: if the user verifies in another tab (or just clicks the
  // link in the email and gets fully authenticated), the email list flips
  // to "verified" — this tab notices and goes home so the user isn't
  // stuck on the waiting page after the side trip succeeded.
  const verified = hasVerifiedPrimaryEmail(emails.data)
  useEffect(() => {
    if (verified) {
      navigate({ to: '/' })
    }
  }, [verified, navigate])

  // The email might come from either the session (fully-authenticated user)
  // or from the pending-verification flow's user object. Both shapes carry
  // `data.user.email`. Used for display only — the resend endpoint takes
  // no body; allauth resends to whichever address is in the pending entry.
  const email = (session.data?.data as { user?: { email?: string } } | undefined)?.user?.email

  const handleResend = async () => {
    if (resend.isPending) return
    if (!email) {
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
