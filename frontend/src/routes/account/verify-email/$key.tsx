import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { CircleAlert, Loader2, LogIn, MailCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { auth } from '@/lib/auth/api'
import { hasVerifiedPrimaryEmail } from '@/lib/auth/guards'
import { emailKeys } from '@/lib/hooks/keys'

// Verify endpoint is single-use — Strict Mode double-mounts, double-clicks,
// and pre-fetchers can all fire the POST more than once, so we read the
// final state from the email list rather than the POST response. allauth
// also no longer auto-logs in on link click (2024 change), so a successful
// verify from a different browser / incognito still requires login here.

type Outcome = 'verified-not-logged-in' | 'failed'
type LoaderData = { outcome: Outcome }

export const Route = createFileRoute('/account/verify-email/$key')({
  head: () => ({ meta: [{ title: 'Verify email — music' }] }),
  loader: async ({ params, context }): Promise<LoaderData> => {
    const key = decodeURIComponent(params.key)

    let verifyStatus = 0
    try {
      const verifyRes = await auth.verifyEmail(key)
      verifyStatus = verifyRes.status
    } catch {
      // Network error — fall through; emails are the source of truth.
    }

    // staleTime: 0 → bypass the 5-min cache so we see post-verify state.
    const emailsRes = await context.queryClient.fetchQuery({
      queryKey: emailKeys.list(),
      queryFn: () => auth.listEmails(),
      staleTime: 0,
    })

    if (hasVerifiedPrimaryEmail(emailsRes)) {
      toast.success('Email verified.')
      throw redirect({ to: '/' })
    }

    // 200 verify + 401 emails → clicked in a different browser / incognito.
    // The email IS verified server-side, but this session can't see it.
    if (verifyStatus === 200 && emailsRes?.status === 401) {
      return { outcome: 'verified-not-logged-in' }
    }

    return { outcome: 'failed' }
  },
  pendingComponent: VerifyingPlaceholder,
  component: VerifyEmailPage,
})

function VerifyingPlaceholder() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-4 text-center">
        <Loader2
          className="text-muted-foreground mx-auto h-10 w-10 animate-spin"
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Verifying your email…
        </p>
      </div>
    </div>
  )
}

function VerifyEmailPage() {
  const { outcome } = Route.useLoaderData()

  if (outcome === 'verified-not-logged-in') {
    return (
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <MailCheck className="text-success mx-auto h-12 w-12" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
          <p className="text-muted-foreground text-sm">
            Your email is verified. Log in on this device to continue.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link to="/login">
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            Log in
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 text-center">
      <CircleAlert className="text-warning mx-auto h-12 w-12" aria-hidden="true" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Link no longer works</h1>
        <p className="text-muted-foreground text-sm">
          This verification link is invalid, expired, or belongs to a different account.
          Verification links are single-use.
        </p>
      </div>

      <Button asChild className="w-full">
        <Link to="/account/verify-email">
          <MailCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          Get a new link
        </Link>
      </Button>

      <p className="text-muted-foreground text-xs">
        Wrong account?{' '}
        <Link to="/login" className="hover:text-foreground underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
