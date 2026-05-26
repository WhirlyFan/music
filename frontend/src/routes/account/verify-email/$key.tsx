import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { useVerifyEmail } from '@/lib/auth/hooks'

// $key is the opaque token from the verification email. allauth's
// HEADLESS_FRONTEND_URLS.account_confirm_email maps to this URL pattern.
// This route is transient — it POSTs the key, toasts the outcome, and
// navigates to / regardless. Clicking the link N times always lands
// the user on home with a "verified" toast.
export const Route = createFileRoute('/account/verify-email/$key')({
  component: VerifyEmailPage,
  head: () => ({ meta: [{ title: 'Verify email — react-django-template' }] }),
})

function VerifyEmailPage() {
  const { key } = Route.useParams()
  const navigate = useNavigate()
  const verify = useVerifyEmail()
  // React strict mode double-mounts in dev; only fire the POST once.
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    verify.mutate(key, {
      onSettled: (res) => {
        // Optimistic-success UX: any response → navigate home with a
        // toast. The 200 case confirms verification. Non-2xx most often
        // means the key was already consumed (clicked twice) — the user
        // IS verified. If the link is actually bad and they're still
        // unverified, the next login attempt routes them back to
        // /account/verify-email to resend. Self-correcting.
        if (res?.status === 200) {
          toast.success('Email verified.')
        } else {
          toast.success('Email already verified.')
        }
        navigate({ to: '/' })
      },
    })
  }, [key, navigate, verify])

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
