import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Settings, UserPlus, Users, UserX, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useSession } from '@/lib/hooks/queries/auth'
import {
  type FriendUser,
  useAcceptFriend,
  useDeclineFriend,
  useFriendRequests,
  useFriends,
  useRemoveFriend,
  useSendFriendRequest,
  useUserSearch,
} from '@/lib/hooks/queries/friends'
import { useDebounced } from '@/lib/use-debounced'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
  head: () => ({ meta: [{ title: 'Profile — music' }] }),
})

type SessionUser = { username?: string; first_name?: string; last_name?: string; email?: string }

function ProfilePage() {
  const session = useSession()
  const user = (session.data?.data as { user?: SessionUser } | undefined)?.user
  const username = user?.username ?? ''
  const fullName = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()

  const friends = useFriends()
  const requests = useFriendRequests()
  const incoming = requests.data?.incoming ?? []
  const outgoing = requests.data?.outgoing ?? []
  const friendCount = friends.data?.length ?? 0

  return (
    <div className="motion-safe:animate-fade-in mx-auto max-w-2xl space-y-8">
      <ProfileHero
        username={username}
        fullName={fullName}
        email={user?.email}
        friendCount={friendCount}
        loadingCount={friends.isLoading}
      />

      <AddFriend />

      {incoming.length > 0 && (
        <Section icon={UserPlus} title="Friend requests" badge={incoming.length}>
          {incoming.map((f) => (
            <IncomingRow key={f.id} id={f.id} user={f.requester} />
          ))}
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section icon={Users} title="Sent" subdued>
          {outgoing.map((f) => (
            <OutgoingRow key={f.id} id={f.id} user={f.addressee} />
          ))}
        </Section>
      )}

      <Section icon={Users} title="Friends" badge={friendCount || undefined}>
        {friends.isLoading ? (
          <RowSkeletons />
        ) : friends.data && friends.data.length > 0 ? (
          friends.data.map((f) => {
            // The friend is whichever side of the row isn't me.
            const other = f.requester.username === username ? f.addressee : f.requester
            return <FriendRow key={f.id} id={f.id} user={other} />
          })
        ) : (
          <p className="text-muted-foreground px-5 py-8 text-center text-sm">
            No friends yet — search above to send your first request.
          </p>
        )}
      </Section>
    </div>
  )
}

/** The showcase header: avatar in a glowing gradient ring, name, handle, a friend
 *  count chip, and a quiet jump to Settings. */
function ProfileHero({
  username,
  fullName,
  email,
  friendCount,
  loadingCount,
}: {
  username: string
  fullName: string
  email?: string
  friendCount: number
  loadingCount: boolean
}) {
  return (
    <header className="border-border/70 bg-card relative overflow-hidden rounded-3xl border shadow-sm">
      {/* Soft brand glow bleeding from the top-right — the non-flat signature. */}
      <div
        aria-hidden
        className="from-primary/25 via-accent/10 pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-gradient-to-br to-transparent blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:gap-5 sm:text-left">
        {/* Gradient ring around the person-on-glass avatar. */}
        <span className="from-primary to-accent shadow-primary/30 inline-flex shrink-0 rounded-full bg-gradient-to-br p-[3px] shadow-lg">
          <UserAvatar
            username={username}
            size="size-20"
            icon="size-9"
            className="border-background border-2"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{fullName || username}</h1>
          <p className="text-muted-foreground truncate text-sm">@{username}</p>
          <div className="mt-3 flex items-center justify-center gap-2 sm:justify-start">
            <span className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
              <Users className="size-3.5" aria-hidden />
              {loadingCount ? '—' : friendCount} {friendCount === 1 ? 'friend' : 'friends'}
            </span>
            {email && (
              <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                {email}
              </span>
            )}
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full">
          <Link to="/settings">
            <Settings className="mr-1.5 size-4" aria-hidden />
            Edit
          </Link>
        </Button>
      </div>
    </header>
  )
}

/** Username search → results with an Add button. */
function AddFriend() {
  const [term, setTerm] = useState('')
  const q = useDebounced(term, 300)
  const results = useUserSearch(q)
  const send = useSendFriendRequest()

  return (
    <section className="space-y-3">
      <div className="relative">
        <UserPlus
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Find people by username…"
          aria-label="Find people"
          className="rounded-full pl-9"
        />
      </div>
      {q && (
        <Card>
          {results.isLoading ? (
            <RowSkeletons />
          ) : results.data && results.data.length > 0 ? (
            results.data.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                action={
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={send.isPending}
                    onClick={() => send.mutate(u.id)}
                  >
                    <UserPlus className="mr-1.5 size-4" aria-hidden />
                    Add
                  </Button>
                }
              />
            ))
          ) : (
            <p className="text-muted-foreground px-5 py-6 text-center text-sm">
              No one found for “{q}”.
            </p>
          )}
        </Card>
      )}
    </section>
  )
}

function IncomingRow({ id, user }: { id: string; user: FriendUser }) {
  const accept = useAcceptFriend()
  const decline = useDeclineFriend()
  const busy = accept.isPending || decline.isPending
  return (
    <UserRow
      user={user}
      action={
        <span className="flex gap-2">
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={() => accept.mutate(id)}
          >
            <Check className="mr-1 size-4" aria-hidden />
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={busy}
            onClick={() => decline.mutate(id)}
            aria-label={`Decline ${user.username}`}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </span>
      }
    />
  )
}

function OutgoingRow({ id, user }: { id: string; user: FriendUser }) {
  const cancel = useRemoveFriend()
  return (
    <UserRow
      user={user}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(id)}
        >
          Cancel
        </Button>
      }
    />
  )
}

function FriendRow({ id, user }: { id: string; user: FriendUser }) {
  const remove = useRemoveFriend()
  return (
    <UserRow
      user={user}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive rounded-full"
          disabled={remove.isPending}
          onClick={() => remove.mutate(id)}
          aria-label={`Remove ${user.username}`}
        >
          <UserX className="size-4" aria-hidden />
        </Button>
      }
    />
  )
}

function UserRow({ user, action }: { user: FriendUser; action: React.ReactNode }) {
  return (
    <div className="hover:bg-muted/40 flex items-center justify-between gap-4 px-5 py-3 transition-colors">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar username={user.username} size="size-10" icon="size-5" link />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.display_name || user.username}</p>
          <p className="text-muted-foreground truncate text-xs">@{user.username}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="border-border/70 bg-card divide-border/60 divide-y overflow-hidden rounded-2xl border shadow-sm">
    {children}
  </div>
)

/** Section with a gradient icon badge header + a card body — the house style
 *  (mirrors the settings icon badges), so it doesn't read as a flat list. */
function Section({
  icon: Icon,
  title,
  badge,
  subdued = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  badge?: number
  subdued?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span
          className={
            subdued
              ? 'bg-muted text-muted-foreground grid size-7 place-items-center rounded-lg'
              : 'from-primary to-accent text-primary-foreground shadow-primary/30 grid size-7 place-items-center rounded-lg bg-gradient-to-br shadow-sm'
          }
        >
          <Icon className="size-4" />
        </span>
        <h2 className="text-lg font-medium">{title}</h2>
        {badge !== undefined && (
          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
            {badge}
          </span>
        )}
      </div>
      <Card>{children}</Card>
    </section>
  )
}

function RowSkeletons() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </>
  )
}
