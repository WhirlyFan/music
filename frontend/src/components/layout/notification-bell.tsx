import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useState } from 'react'

import { ApiError } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAcceptCollabInvite, useDeclineCollabInvite } from '@/lib/hooks/queries/collaborators'
import { useAcceptFriend, useDeclineFriend } from '@/lib/hooks/queries/friends'
import {
  type AppNotification,
  useDismissNotification,
  useMarkNotificationsRead,
  useNotifications,
  useUnreadCount,
} from '@/lib/hooks/queries/notifications'

/** Human-readable line for a notification kind. New kinds (playlist invites, …)
 *  slot in here. */
function describe(n: AppNotification): string {
  const who = n.actor_username ?? 'Someone'
  switch (n.kind) {
    case 'jam_join':
      return `${who} joined your jam`
    case 'friend_request':
      return `${who} sent you a friend request`
    case 'friend_accept':
      return `${who} accepted your friend request`
    case 'playlist_invite':
      return `${who} invited you to collaborate on “${title(n)}”`
    case 'playlist_invite_accept':
      return `${who} joined “${title(n)}”`
    case 'playlist_tracks':
      return `${who} ${summary(n) || `updated “${title(n)}”`}`
    default:
      return 'New notification'
  }
}

const title = (n: AppNotification) =>
  typeof n.payload.title === 'string' ? n.payload.title : 'a playlist'
const summary = (n: AppNotification) =>
  typeof n.payload.summary === 'string' ? n.payload.summary : ''

/** Playlist notifications deep-link to the playlist; others don't link. */
function playlistId(n: AppNotification): string | null {
  const id = n.payload.playlist_id
  const linked =
    n.kind === 'playlist_invite' ||
    n.kind === 'playlist_invite_accept' ||
    n.kind === 'playlist_tracks'
  return linked && typeof id === 'string' ? id : null
}

/** Accept / Decline buttons that, once the action lands, dismiss the originating
 *  notification so it's consumed (no stale buttons left behind). */
function InviteActions({
  notificationId,
  onAccept,
  onDecline,
  busy,
}: {
  notificationId: string
  onAccept: (onDone: () => void) => void
  onDecline: (onDone: () => void) => void
  busy: boolean
}) {
  const dismiss = useDismissNotification()
  const consume = () => dismiss.mutate(notificationId)
  return (
    <span className="mt-1.5 flex gap-2">
      <Button
        size="sm"
        className="h-7 px-2.5 text-xs"
        disabled={busy || dismiss.isPending}
        onClick={() => onAccept(consume)}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2.5 text-xs"
        disabled={busy || dismiss.isPending}
        onClick={() => onDecline(consume)}
      >
        Decline
      </Button>
    </span>
  )
}

// If the request is already gone (a stale notification → 404), still consume the
// notification so the dead buttons disappear instead of erroring on a re-click.
const settle = (done: () => void) => ({
  onSuccess: done,
  onError: (e: unknown) => {
    if (e instanceof ApiError && e.status === 404) done()
  },
})

/** Inline Accept / Decline for a friend-request notification. */
function FriendRequestActions({
  friendshipId,
  notificationId,
}: {
  friendshipId: string
  notificationId: string
}) {
  const accept = useAcceptFriend()
  const decline = useDeclineFriend()
  return (
    <InviteActions
      notificationId={notificationId}
      busy={accept.isPending || decline.isPending}
      onAccept={(done) => accept.mutate(friendshipId, settle(done))}
      onDecline={(done) => decline.mutate(friendshipId, settle(done))}
    />
  )
}

/** Inline Accept / Decline for a collaboration invite. */
function PlaylistInviteActions({
  playlistId,
  notificationId,
}: {
  playlistId: string
  notificationId: string
}) {
  const accept = useAcceptCollabInvite()
  const decline = useDeclineCollabInvite()
  return (
    <InviteActions
      notificationId={notificationId}
      busy={accept.isPending || decline.isPending}
      onAccept={(done) => accept.mutate(playlistId, settle(done))}
      onDecline={(done) => decline.mutate(playlistId, settle(done))}
    />
  )
}

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (secs < 60) return 'just now'
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Bell + unread badge in the top chrome; the dropdown lists recent notifications.
 *  Opening it marks them read (clears the badge); the durable rows still list. */
export function NotificationBell() {
  const { data: unread } = useUnreadCount()
  const notifications = useNotifications()
  const markRead = useMarkNotificationsRead()
  const [open, setOpen] = useState(false)
  const count = unread?.count ?? 0
  const items = notifications.data?.results ?? []

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && count > 0) markRead.mutate(undefined)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-5" />
          {count > 0 && (
            <span className="bg-primary text-primary-foreground ring-background motion-safe:animate-pop-in pointer-events-none absolute -top-1 -right-1 flex size-[18px] items-center justify-center rounded-full text-[10px] leading-none font-bold tabular-nums ring-2">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-border/60 border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
        </div>
        <div className="max-h-80 [scrollbar-width:thin] overflow-y-auto">
          {notifications.isLoading ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              No notifications yet.
            </p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {items.map((n) => {
                const pid = playlistId(n)
                return (
                  <li
                    key={n.id}
                    className={`flex items-start gap-2 px-3 py-2.5 text-sm ${
                      n.read_at ? '' : 'bg-primary/5'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        n.read_at ? 'bg-transparent' : 'bg-primary'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      {pid ? (
                        <Link
                          to="/playlists/$playlistId"
                          params={{ playlistId: pid }}
                          onClick={() => setOpen(false)}
                          className="block hover:underline"
                        >
                          {describe(n)}
                        </Link>
                      ) : (
                        <span className="block">{describe(n)}</span>
                      )}
                      <span className="text-muted-foreground text-xs">{timeAgo(n.created_at)}</span>
                      {n.kind === 'friend_request' &&
                        typeof n.payload.friendship_id === 'string' && (
                          <FriendRequestActions
                            friendshipId={n.payload.friendship_id}
                            notificationId={n.id}
                          />
                        )}
                      {n.kind === 'playlist_invite' && pid && (
                        <PlaylistInviteActions playlistId={pid} notificationId={n.id} />
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
