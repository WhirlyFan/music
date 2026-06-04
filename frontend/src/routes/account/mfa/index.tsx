import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button, buttonVariants } from '@/components/ui/button'
import { bannerError } from '@/lib/auth/errors'
import { useAuthenticators, useDeactivateTotp } from '@/lib/auth/mfa'
import { confirm } from '@/lib/overlay'

// `?required=true&next=/admin/` is set by RequireMfaForStaffMiddleware when a
// staff user is redirected from /admin/ for missing MFA. We surface the
// banner copy + redirect-after-enrollment from it.
const searchSchema = z.object({
  required: z.coerce.boolean().optional(),
  next: z.string().optional(),
})

export const Route = createFileRoute('/account/mfa/')({
  validateSearch: searchSchema,
  component: TwoFactorOverview,
  head: () => ({ meta: [{ title: 'MFA — music' }] }),
})

type AuthenticatorEntry = {
  type?: string
  last_used_at?: number | null
  created_at?: number | null
}

function TwoFactorOverview() {
  const search = Route.useSearch()
  const authenticators = useAuthenticators()
  const deactivateTotp = useDeactivateTotp()

  const data = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const enrolledTypes = new Set(data.map((a) => a.type))
  const hasTotp = enrolledTypes.has('totp')
  const hasWebAuthn = enrolledTypes.has('webauthn')
  const hasRecoveryCodes = enrolledTypes.has('recovery_codes')

  const handleRemoveTotp = async () => {
    if (deactivateTotp.isPending) return
    // Destructive + auth-weakening — confirm explicitly. WCAG 3.3.4 calls
    // out reversibility/confirmation for actions like this. Same `confirm`
    // overlay used for delete-note.
    const ok = await confirm({
      title: 'Remove authenticator app?',
      description:
        "You'll lose your second factor. Recovery codes will also be invalidated. You can always re-enroll later.",
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    const res = await deactivateTotp.mutateAsync()
    if (res.status === 200) {
      toast.success('Authenticator removed.')
    } else {
      const msg = bannerError(res, 'Could not remove authenticator. Try again.')
      if (msg) toast.error(msg)
    }
  }

  return (
    <SettingsPageShell
      breadcrumbs={[
        { label: 'Settings', to: '/settings' },
        { label: 'Multi-factor authentication' },
      ]}
      title="Multi-factor authentication"
      description="Add a second step to log in. Optional for most users; required to access the admin area."
    >
      {search.required ? (
        <div
          role="alert"
          className="border-warning/30 bg-warning/10 flex items-start gap-3 rounded-md border p-4"
        >
          <ShieldAlert className="text-warning mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Multi-factor authentication is required for admin access.</p>
            <p className="text-muted-foreground">
              Enroll any one method below to continue
              {search.next ? (
                <>
                  {' '}
                  to <span className="font-mono">{search.next}</span>
                </>
              ) : null}
              .
            </p>
          </div>
        </div>
      ) : null}

      <ul className="divide-border bg-card divide-y rounded-md border" role="list">
        <MethodRow
          name="Authenticator app (TOTP)"
          enrolled={hasTotp}
          description="Use Google Authenticator, 1Password, Authy, or similar. Recommended."
          enrollLink={
            <Link
              to="/account/mfa/totp"
              className={buttonVariants({ variant: hasTotp ? 'outline' : 'default', size: 'sm' })}
            >
              {hasTotp ? 'Manage' : 'Enroll'}
            </Link>
          }
          onRemove={hasTotp ? handleRemoveTotp : undefined}
          removeBusy={deactivateTotp.isPending}
        />
        <MethodRow
          name="Passkey / security key"
          enrolled={hasWebAuthn}
          description="Touch ID, Face ID, YubiKey, or another WebAuthn device."
          enrollLink={
            <Link
              to="/account/mfa/webauthn"
              className={buttonVariants({
                variant: hasWebAuthn ? 'outline' : 'default',
                size: 'sm',
              })}
            >
              {hasWebAuthn ? 'Manage' : 'Enroll'}
            </Link>
          }
        />
        {/* Recovery codes are intrinsically tied to TOTP — allauth refuses
            to mint them until an authenticator factor is enrolled. Hide
            the row entirely until that's true, so users don't see a
            "Generate" button that's guaranteed to fail. Once TOTP is
            enrolled, recovery codes auto-exist and the action becomes
            "View" / regenerate. */}
        {hasTotp ? (
          <MethodRow
            name="Recovery codes"
            enrolled={hasRecoveryCodes}
            description="Single-use backup codes. Use one if you lose your authenticator."
            enrollLink={
              <Link
                to="/account/mfa/recovery-codes"
                className={buttonVariants({
                  variant: hasRecoveryCodes ? 'outline' : 'default',
                  size: 'sm',
                })}
              >
                {hasRecoveryCodes ? 'View' : 'Generate'}
              </Link>
            }
          />
        ) : null}
      </ul>
    </SettingsPageShell>
  )
}

function MethodRow({
  name,
  enrolled,
  description,
  enrollLink,
  onRemove,
  removeBusy,
}: {
  name: string
  enrolled: boolean
  description: string
  enrollLink: React.ReactNode
  onRemove?: () => void
  removeBusy?: boolean
}) {
  return (
    <li className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
            enrolled ? 'bg-success' : 'bg-muted-foreground/40'
          }`}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{name}</p>
            {enrolled ? (
              <span className="text-success inline-flex items-center gap-1 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Enrolled
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {enrolled && onRemove ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={removeBusy}
            aria-busy={removeBusy || undefined}
          >
            {removeBusy ? 'Removing…' : 'Remove'}
          </Button>
        ) : null}
        {enrollLink}
      </div>
    </li>
  )
}
