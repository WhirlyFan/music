import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useState } from 'react'

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

/** Inline Accept / Decline for a friend-request notification, acting on the
 *  friendship id carried in the payload. */
function FriendRequestActions({ friendshipId }: { friendshipId: string }) {
  const accept = useAcceptFriend()
  const decline = useDeclineFriend()
  const busy = accept.isPending || decline.isPending
  return (
    <span className="mt-1.5 flex gap-2">
      <Button
        size="sm"
        className="h-7 px-2.5 text-xs"
        disabled={busy}
        onClick={() => accept.mutate(friendshipId)}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2.5 text-xs"
        disabled={busy}
        onClick={() => decline.mutate(friendshipId)}
      >
        Decline
      </Button>
    </span>
  )
}

/** Inline Accept / Decline for a collaboration invite, acting on the playlist id. */
function PlaylistInviteActions({ playlistId }: { playlistId: string }) {
  const accept = useAcceptCollabInvite()
  const decline = useDeclineCollabInvite()
  const busy = accept.isPending || decline.isPending
  return (
    <span className="mt-1.5 flex gap-2">
      <Button
        size="sm"
        className="h-7 px-2.5 text-xs"
        disabled={busy}
        onClick={() => accept.mutate(playlistId)}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2.5 text-xs"
        disabled={busy}
        onClick={() => decline.mutate(playlistId)}
      >
        Decline
      </Button>
    </span>
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
                          <FriendRequestActions friendshipId={n.payload.friendship_id} />
                        )}
                      {n.kind === 'playlist_invite' && pid && (
                        <PlaylistInviteActions playlistId={pid} />
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
