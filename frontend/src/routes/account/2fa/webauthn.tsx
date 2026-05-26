import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'

export const Route = createFileRoute('/account/2fa/webauthn')({
  component: WebAuthnPlaceholder,
  head: () => ({ meta: [{ title: 'Passkeys — react-django-template' }] }),
})

/**
 * Passkey / WebAuthn enrollment.
 *
 * Stub for now. The headless allauth endpoints exist
 * (/_allauth/browser/v1/account/authenticators/webauthn) but the registration
 * flow is involved — the server returns a challenge that we have to hand off
 * to `navigator.credentials.create()`, then post the attestation back. Worth
 * building once a real user asks for it; in the meantime TOTP + recovery
 * codes cover the second-factor story.
 */
function WebAuthnPlaceholder() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        to="/account/2fa"
        className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' -ml-3'}
      >
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
        Back to two-factor settings
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Passkeys</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Passkey support is wired in the backend but the enrollment UI isn’t built yet. For now,
          use an authenticator app (TOTP) and recovery codes.
        </p>
      </div>
    </div>
  )
}
