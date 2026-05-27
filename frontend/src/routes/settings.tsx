import { createFileRoute, Link } from '@tanstack/react-router'
import { KeyRound, Mail, ShieldCheck } from 'lucide-react'

import { SettingsPageShell } from '@/components/layout/settings-page-shell'
import { buttonVariants } from '@/components/ui/button'
import { useSession } from '@/lib/auth/hooks'
import { useAuthenticators } from '@/lib/auth/mfa'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: 'Settings — react-django-template' }] }),
})

type AuthenticatorEntry = { type?: string }

function SettingsPage() {
  const authenticators = useAuthenticators()
  const session = useSession()
  const data = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const types = new Set(data.map((a) => a.type))
  const mfaEnrolled = types.has('totp') || types.has('webauthn')
  const email = (session.data?.data as { user?: { email?: string } } | undefined)?.user?.email

  return (
    // No breadcrumbs on the top-level settings page — a single-item trail
    // is redundant with the page title and confuses users who click it and
    // get sent to themselves. Breadcrumbs are intentional UI, not chrome.
    <SettingsPageShell
      title="Settings"
      description="Manage your account, security, and preferences."
    >
      <Section title="Account" description="Your sign-in identity.">
        <SettingsRow
          icon={<Mail className="h-5 w-5" aria-hidden="true" />}
          title="Email"
          description={email ?? 'The address you sign in and receive mail at.'}
          action={
            <Link
              to="/account/email"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Change
            </Link>
          }
        />
        <SettingsRow
          icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
          title="Password"
          description="Set a new password. At least 12 characters."
          action={
            <Link
              to="/account/password/change"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Change
            </Link>
          }
        />
      </Section>

      <Section title="Security" description="How you sign in to your account.">
        <SettingsRow
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Multi-factor authentication"
          description={
            mfaEnrolled
              ? 'Enrolled. A code or passkey is required every time you log in.'
              : 'Add an authenticator app, passkey, or hardware key.'
          }
          status={mfaEnrolled ? 'on' : 'off'}
          action={
            <Link
              to="/account/mfa"
              className={buttonVariants({
                variant: mfaEnrolled ? 'outline' : 'default',
                size: 'sm',
              })}
            >
              {mfaEnrolled ? 'Manage' : 'Set up'}
            </Link>
          }
        />
      </Section>
    </SettingsPageShell>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      <div className="bg-card divide-border divide-y rounded-md border">{children}</div>
    </section>
  )
}

function SettingsRow({
  icon,
  title,
  description,
  status,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  status?: 'on' | 'off'
  action: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground shrink-0">{icon}</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {status === 'on' ? (
              <span className="text-success inline-flex items-center gap-1 text-xs">On</span>
            ) : status === 'off' ? (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                Off
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
