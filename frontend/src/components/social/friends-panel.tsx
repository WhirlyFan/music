import { Check, Inbox, Search, UserPlus, Users, UserX, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/components/ui/reveal'
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
import { cn } from '@/lib/utils'

export type FriendsView = 'friends' | 'requests' | 'add'

/** The friends hub: a segmented Friends / Requests / Add view. Each list lives on its
 *  own tab so they're never stacked, and searching to add happens on a dedicated tab
 *  (so results never push the rest of the page around). The active tab is owned by the
 *  caller (persisted in the URL by the route), so it survives refresh + Back. */
export function FriendsPanel({
  view,
  onViewChange,
}: {
  view: FriendsView
  onViewChange: (v: FriendsView) => void
}) {
  const session = useSession()
  const myUsername = (session.data?.data as { user?: { username?: string } } | undefined)?.user
    ?.username
  const friends = useFriends()
  const requests = useFriendRequests()
  const incoming = requests.data?.incoming ?? []
  const outgoing = requests.data?.outgoing ?? []
  const friendList = friends.data?.pages.flatMap((p) => p.results) ?? []
  const friendCount = friends.data?.pages[0]?.count ?? 0
  const pendingCount = incoming.length + outgoing.length

  return (
    <div className="space-y-5">
      <Segmented
        value={view}
        onChange={onViewChange}
        options={[
          { value: 'friends', label: 'Friends', count: friendCount || undefined, icon: Users },
          {
            value: 'requests',
            label: 'Requests',
            count: incoming.length || undefined,
            icon: Inbox,
          },
          { value: 'add', label: 'Add', icon: UserPlus },
        ]}
      />

      {/* One Reveal per tab — switching collapses the old panel and expands the new one
          (so each tab both enters and exits), and the page height eases between them
          instead of snapping. Only one is open at a time. */}
      <div>
        <Reveal open={view === 'friends'}>
          <Card>
            {friends.isLoading ? (
              <RowSkeletons />
            ) : friendList.length > 0 ? (
              <div
                className="max-h-[28rem] [scrollbar-width:thin] overflow-y-auto"
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (
                    friends.hasNextPage &&
                    !friends.isFetchingNextPage &&
                    el.scrollHeight - el.scrollTop - el.clientHeight < 64
                  ) {
                    void friends.fetchNextPage()
                  }
                }}
              >
                {friendList.map((f) => {
                  const other = f.requester.username === myUsername ? f.addressee : f.requester
                  return <FriendRow key={f.id} id={f.id} user={other} />
                })}
                {friends.isFetchingNextPage && (
                  <p className="text-muted-foreground px-5 py-2 text-center text-xs">Loading…</p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground px-5 py-10 text-center text-sm">
                No friends yet — switch to “Add” to send your first request.
              </p>
            )}
          </Card>
        </Reveal>

        <Reveal open={view === 'requests'}>
          {requests.isLoading ? (
            <Card>
              <RowSkeletons />
            </Card>
          ) : pendingCount > 0 ? (
            // One list — incoming first, then sent. No sub-labels now that "Requests"
            // is its own tab; the Accept/Decline vs Cancel actions tell them apart.
            <Card>
              {incoming.map((f) => (
                <IncomingRow key={f.id} id={f.id} user={f.requester} />
              ))}
              {outgoing.map((f) => (
                <OutgoingRow key={f.id} id={f.id} user={f.addressee} />
              ))}
            </Card>
          ) : (
            <Card>
              <p className="text-muted-foreground px-5 py-10 text-center text-sm">
                No pending requests.
              </p>
            </Card>
          )}
        </Reveal>

        <Reveal open={view === 'add'}>
          <AddFriend />
        </Reveal>
      </div>
    </div>
  )
}

/** App-styled segmented control — the single source for switching Friends/Requests. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: {
    value: T
    label: string
    count?: number
    icon: React.ComponentType<{ className?: string }>
  }[]
}) {
  return (
    <div className="bg-muted/60 inline-flex w-full gap-1 rounded-full p-1 sm:w-auto">
      {options.map(({ value: v, label, count, icon: Icon }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                  active ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/15',
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function AddFriend() {
  const [term, setTerm] = useState('')
  const q = useDebounced(term, 300)
  const results = useUserSearch(q)
  const send = useSendFriendRequest()
  const people = results.data?.pages.flatMap((p) => p.results) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search
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
          {/* First 25 land as you type; scrolling near the bottom loads the next page. */}
          <div
            className="max-h-72 [scrollbar-width:thin] overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget
              if (
                hasNextPage &&
                !isFetchingNextPage &&
                el.scrollHeight - el.scrollTop - el.clientHeight < 64
              ) {
                void fetchNextPage()
              }
            }}
          >
            {results.isLoading ? (
              <RowSkeletons />
            ) : people.length > 0 ? (
              <>
                {people.map((u) => (
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
                ))}
                {isFetchingNextPage && (
                  <p className="text-muted-foreground px-5 py-2 text-center text-xs">Loading…</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground px-5 py-6 text-center text-sm">
                No one found for “{q}”.
              </p>
            )}
          </div>
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
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <UserRow
        user={user}
        action={
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive rounded-full"
            disabled={remove.isPending}
            onClick={() => setConfirm(true)}
            aria-label={`Remove ${user.username}`}
          >
            <UserX className="size-4" aria-hidden />
          </Button>
        }
      />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove @{user.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ll no longer be friends. You can send a new request anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(id, {
                  onSuccess: () => toast.success(`Removed @${user.username}.`),
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
