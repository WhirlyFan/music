import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { bannerError } from '@/lib/auth/errors'
import { useVerifyEmail } from '@/lib/auth/hooks'

// $key is the opaque token from the verification email. allauth's
// HEADLESS_FRONTEND_URLS.account_confirm_email maps to this route
// (via FRONTEND_ORIGIN + /account/verify-email/{key}).
export const Route = createFileRoute('/account/verify-email/$key')({
  component: VerifyEmailPage,
  head: () => ({ meta: [{ title: 'Verify email — react-django-template' }] }),
})

function VerifyEmailPage() {
  const { key } = Route.useParams()
  const navigate = useNavigate()
  const verify = useVerifyEmail()
  // Guard against double-fire in React strict mode + StrictMode double-renders.
  // We only want to POST once per page load.
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    verify.mutate(key, {
      onSuccess: (res) => {
        if (res.status === 200) navigate({ to: '/' })
      },
    })
  }, [key, navigate, verify])

  // While the POST is in flight OR on success (we navigate away on 200,
  // so the success state never lingers — just show the spinner until
  // the route changes).
  if (verify.isPending || !verify.data || verify.data.status === 200) {
    return (
      <div className="mx-auto max-w-sm space-y-4 text-center">
        <Loader2
          className="text-muted-foreground mx-auto h-10 w-10 animate-spin"
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Verifying your email…
        </p>
      </div>
    )
  }

  // Anything else — expired key, invalid key, server error.
  const summary = bannerError(
    verify.data,
    'This verification link is invalid or expired. Sign in to request a new one.',
  )

  return (
    <div className="mx-auto max-w-sm space-y-6 text-center">
      <XCircle className="text-destructive mx-auto h-12 w-12" aria-hidden="true" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Couldn’t verify email</h1>
        <p className="text-muted-foreground text-sm">{summary}</p>
      </div>
      <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Back to log in
      </Link>
    </div>
  )
}
