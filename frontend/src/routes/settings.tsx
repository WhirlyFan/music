import { createFileRoute, Link } from '@tanstack/react-router'
import { AtSign, KeyRound, Loader2, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { GoogleIcon } from '@/components/auth/google-button'
import { settingsCard, SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/client'
import { providerRedirect } from '@/lib/auth/api'
import { useAuthenticators } from '@/lib/auth/mfa'
import { useChangeUsername, useDisconnectProvider } from '@/lib/hooks/mutations/auth'
import { useProviderAccounts, useSession, useSocialProviders } from '@/lib/hooks/queries/auth'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: 'Settings — music' }] }),
})

type AuthenticatorEntry = { type?: string }

// 3–30 chars, letters/digits/_/- — mirrors the backend rule (apps/users/views.py).
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/

function SettingsPage() {
  const authenticators = useAuthenticators()
  const session = useSession()
  const social = useSocialProviders()
  const { hasGoogle } = social
  const data = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const types = new Set(data.map((a) => a.type))
  const mfaEnrolled = types.has('totp') || types.has('webauthn')
  const user = (session.data?.data as { user?: { email?: string; username?: string } } | undefined)
    ?.user

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
          icon={<UserRound className="size-4" aria-hidden="true" />}
          title="Profile"
          description="Your public profile and friends."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/profile">View</Link>
            </Button>
          }
        />
        <SettingsRow
          icon={<Mail className="size-4" aria-hidden="true" />}
          title="Email"
          description={user?.email ?? 'The address you sign in and receive mail at.'}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/account/email">Change</Link>
            </Button>
          }
        />
        <UsernameRow username={user?.username} />
        <SettingsRow
          icon={<KeyRound className="size-4" aria-hidden="true" />}
          title="Password"
          description="Set a new password. At least 12 characters."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/account/password/change">Change</Link>
            </Button>
          }
        />
      </Section>

      {/* Reserve the section while we learn whether Google is configured, so it
          doesn't pop in after load. (Hidden once we know it isn't.) */}
      {(social.isPending || hasGoogle) && (
        <Section title="Connected accounts" description="Sign in faster with a linked account.">
          <GoogleConnectionRow loading={social.isPending} />
        </Section>
      )}

      <Section title="Security" description="How you sign in to your account.">
        <SettingsRow
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          title="Multi-factor authentication"
          loading={authenticators.isPending}
          description={
            mfaEnrolled
              ? 'Enrolled. A code or passkey is required every time you log in.'
              : 'Add an authenticator app, passkey, or hardware key.'
          }
          status={mfaEnrolled ? 'on' : 'off'}
          action={
            <Button asChild variant={mfaEnrolled ? 'outline' : 'default'} size="sm">
              <Link to="/account/mfa">{mfaEnrolled ? 'Manage' : 'Set up'}</Link>
            </Button>
          }
        />
      </Section>
    </SettingsPageShell>
  )
}

/** Inline-editable handle. Display shows the current username + Change; editing swaps
 *  in an input with Save/Cancel. Validates the format client-side, lets the server have
 *  the final say on uniqueness (409 → "taken"). */
function UsernameRow({ username }: { username?: string }) {
  const change = useChangeUsername()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  function start() {
    setValue(username ?? '')
    setEditing(true)
  }

  function save() {
    const next = value.trim()
    if (next === username) return setEditing(false)
    if (!USERNAME_RE.test(next)) {
      toast.error('3–30 characters: letters, numbers, “_” or “-”.')
      return
    }
    change.mutate(next.toLowerCase(), {
      onSuccess: () => {
        toast.success('Username updated.')
        setEditing(false)
      },
      onError: (e) => {
        const taken = e instanceof ApiError && e.status === 409
        toast.error(taken ? 'That username is taken.' : 'Couldn’t update your username.')
      },
    })
  }

  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconBadge>
          <AtSign className="size-4" aria-hidden="true" />
        </IconBadge>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Username</p>
          {editing ? (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              maxLength={30}
              aria-label="New username"
              className="h-8 w-48"
            />
          ) : (
            <p className="text-muted-foreground truncate text-xs">
              {username ? `@${username}` : 'Your public handle.'}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={change.isPending}>
              {change.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Save'}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={start}>
            Change
          </Button>
        )}
      </div>
    </div>
  )
}

/** Connect / disconnect Google for the signed-in user. Connect uses allauth's
 *  process=connect redirect, returning to /settings; disconnect calls the headless
 *  manage-providers endpoint (allauth refuses if it'd lock you out of every login). */
function GoogleConnectionRow({ loading: parentLoading }: { loading?: boolean }) {
  const { google, isPending } = useProviderAccounts()
  const disconnect = useDisconnectProvider()
  const connected = Boolean(google)

  return (
    <SettingsRow
      icon={<GoogleIcon />}
      brand
      title="Google"
      loading={parentLoading || isPending}
      description={connected ? (google?.display ?? 'Connected.') : 'Link your Google account.'}
      status={connected ? 'on' : 'off'}
      action={
        google ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() =>
              disconnect.mutate(
                { provider: 'google', account: google.uid },
                {
                  onSuccess: () => toast.success('Google disconnected.'),
                  onError: () =>
                    toast.error(
                      'Couldn’t disconnect — set a password first so you can still log in.',
                    ),
                },
              )
            }
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() =>
              void providerRedirect('google', {
                process: 'connect',
                callbackUrl: '/auth/callback?from=/settings',
              })
            }
          >
            Connect
          </Button>
        )
      }
    />
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
      <div className={`${settingsCard} divide-border divide-y overflow-hidden`}>{children}</div>
    </section>
  )
}

/** The round gradient icon badge used on each settings row — matches the dialog +
 *  auth-card header icons. `brand` swaps in a neutral tile so a multicolor logo
 *  (e.g. Google) sits on a plain surface instead of the gradient. */
function IconBadge({ children, brand = false }: { children: React.ReactNode; brand?: boolean }) {
  return (
    <span
      className={
        brand
          ? 'bg-background ring-border flex size-9 shrink-0 items-center justify-center rounded-full ring-1'
          : 'from-primary to-accent text-primary-foreground shadow-primary/30 flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm'
      }
    >
      {children}
    </span>
  )
}

function SettingsRow({
  icon,
  title,
  description,
  status,
  action,
  loading = false,
  brand = false,
}: {
  icon: React.ReactNode
  title: string
  description: string
  status?: 'on' | 'off'
  action: React.ReactNode
  loading?: boolean
  brand?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconBadge brand={brand}>{icon}</IconBadge>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {!loading && status === 'on' ? (
              <span className="bg-success/10 text-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                On
              </span>
            ) : !loading && status === 'off' ? (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                Off
              </span>
            ) : null}
          </div>
          {loading ? (
            // h-4 matches the loaded description's text-xs line box (16px), so the
            // row doesn't grow when the real text replaces the skeleton.
            <Skeleton className="h-4 w-44" />
          ) : (
            <p className="text-muted-foreground truncate text-xs">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {loading ? <Skeleton className="h-9 w-20 rounded-lg" /> : action}
      </div>
    </div>
  )
}
