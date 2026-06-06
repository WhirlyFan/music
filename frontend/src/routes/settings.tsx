import { createFileRoute, Link } from '@tanstack/react-router'
import { KeyRound, Loader2, Mail, Pencil, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { GoogleIcon } from '@/components/auth/google-button'
import { PageHeader } from '@/components/layout/page-header'
import { SectionSidebar, type SidebarItem } from '@/components/layout/section-sidebar'
import { settingsCard } from '@/components/layout/settings-page-shell'
import { FriendsPanel } from '@/components/social/friends-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
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
type SessionUser = { email?: string; username?: string; first_name?: string; last_name?: string }
type Tab = 'profile' | 'friends' | 'account' | 'security'

const TABS: SidebarItem<Tab>[] = [
  { key: 'profile', label: 'Profile', icon: UserRound },
  { key: 'friends', label: 'Friends', icon: Users },
  { key: 'account', label: 'Account', icon: KeyRound },
  { key: 'security', label: 'Security', icon: ShieldCheck },
]

// 3–30 chars, letters/digits/_/- — mirrors the backend rule (apps/users/views.py).
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/

function SettingsPage() {
  const session = useSession()
  const user = (session.data?.data as { user?: SessionUser } | undefined)?.user
  const [tab, setTab] = useState<Tab>('profile')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Manage your profile, friends, account, and security." />
      <div className="flex flex-col gap-6 sm:flex-row">
        <aside className="sm:w-52 sm:shrink-0">
          <SectionSidebar items={TABS} value={tab} onChange={setTab} />
        </aside>
        <div className="min-w-0 flex-1 space-y-6">
          {tab === 'profile' && <ProfileBanner user={user} />}
          {tab === 'friends' && <FriendsPanel />}
          {tab === 'account' && <AccountSection />}
          {tab === 'security' && <SecuritySection />}
        </div>
      </div>
    </div>
  )
}

/** Account section — password + connected accounts. */
function AccountSection() {
  const social = useSocialProviders()
  const { hasGoogle } = social
  return (
    <>
      <Section title="Account" description="How you sign in.">
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
    </>
  )
}

/** Security section — multi-factor authentication. */
function SecuritySection() {
  const authenticators = useAuthenticators()
  const data = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const types = new Set(data.map((a) => a.type))
  const mfaEnrolled = types.has('totp') || types.has('webauthn')
  return (
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
  )
}

/** Identity banner: avatar + name + handle, with an Edit that reveals inline username
 *  editing and the email (the two things that used to be their own rows). */
function ProfileBanner({ user }: { user?: SessionUser }) {
  const [editing, setEditing] = useState(false)
  const username = user?.username ?? ''
  const fullName = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()

  return (
    <header className="border-border/70 bg-card relative overflow-hidden rounded-3xl border shadow-sm">
      <div
        aria-hidden
        className="from-primary/25 via-accent/10 pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-gradient-to-br to-transparent blur-3xl"
      />
      <div className="relative flex items-center gap-4 px-6 py-6">
        <span className="from-primary to-accent shadow-primary/30 inline-flex shrink-0 rounded-full bg-gradient-to-br p-[3px] shadow-lg">
          {username ? (
            <UserAvatar
              username={username}
              size="size-16"
              icon="size-7"
              className="border-background border-2"
              link
            />
          ) : (
            <Skeleton className="size-16 rounded-full" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">{fullName || username}</h2>
          {username ? (
            <p className="text-muted-foreground truncate text-sm">@{username}</p>
          ) : (
            <Skeleton className="mt-1 h-4 w-24" />
          )}
          {user?.email && (
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil className="mr-1.5 size-4" aria-hidden />
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>

      {editing && (
        <div className="border-border/60 space-y-4 border-t px-6 py-4">
          <UsernameField username={username} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground inline-flex min-h-9 flex-1 items-center gap-2 truncate text-sm">
                <Mail className="size-4 shrink-0" aria-hidden />
                {user?.email ?? '—'}
              </span>
              <Button asChild variant="outline" size="sm">
                <Link to="/account/email">Change</Link>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Changing your email requires verifying the new address.
            </p>
          </div>
        </div>
      )}
    </header>
  )
}

/** Inline username editor — input + Save. Format validated client-side; the server
 *  has the final say on uniqueness (409 → "taken"). */
function UsernameField({ username }: { username: string }) {
  const change = useChangeUsername()
  const [value, setValue] = useState(username)

  function save() {
    const next = value.trim()
    if (next === username) return
    if (!USERNAME_RE.test(next)) {
      toast.error('3–30 characters: letters, numbers, “_” or “-”.')
      return
    }
    change.mutate(next.toLowerCase(), {
      onSuccess: () => toast.success('Username updated.'),
      onError: (e) => {
        const taken = e instanceof ApiError && e.status === 409
        toast.error(taken ? 'That username is taken.' : 'Couldn’t update your username.')
      },
    })
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="settings-username" className="text-sm font-medium">
        Username
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="settings-username"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={30}
          aria-label="Username"
          className="h-9 max-w-xs"
        />
        <Button size="sm" onClick={save} disabled={change.isPending || value.trim() === username}>
          {change.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/** Connect / disconnect Google for the signed-in user. */
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

/** The round gradient icon badge used on each settings row. `brand` swaps in a
 *  neutral tile so a multicolor logo (e.g. Google) sits on a plain surface. */
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
            <Skeleton className="h-4 w-44" />
          ) : (
            <p className="text-muted-foreground truncate text-xs">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">{loading ? <Skeleton className="h-9 w-20 rounded-lg" /> : action}</div>
    </div>
  )
}
