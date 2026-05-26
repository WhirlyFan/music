import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { useAuthenticators } from '@/lib/auth/mfa'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: 'Settings — react-django-template' }] }),
})

type AuthenticatorEntry = { type?: string }

function SettingsPage() {
  const authenticators = useAuthenticators()
  const data = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const types = new Set(data.map((a) => a.type))
  const mfaEnrolled = types.has('totp') || types.has('webauthn')

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account, security, and preferences.
        </p>
      </div>

      <Section title="Security" description="How you sign in to your account.">
        <SettingsRow
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Two-factor authentication"
          description={
            mfaEnrolled
              ? 'Enrolled. Codes are required every time you log in.'
              : 'Add a second factor (authenticator app or passkey).'
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
    </div>
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
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="text-muted-foreground mt-0.5">{icon}</div>
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
