import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Clock, Settings, TriangleAlert, UserPlus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  type PublicProfile,
  useAcceptFriend,
  useDeclineFriend,
  useRemoveFriend,
  useSendFriendRequest,
  useUserProfile,
} from '@/lib/hooks/queries/friends'

export const Route = createFileRoute('/u/$username')({
  component: UserProfilePage,
  head: () => ({ meta: [{ title: 'Profile — music' }] }),
})

function UserProfilePage() {
  const { username } = Route.useParams()
  const { data: profile, isLoading, error } = useUserProfile(username)

  if (error) {
    return (
      <EmptyState
        tone="error"
        icon={TriangleAlert}
        title="User not found"
        description={`There's no one with the handle @${username}.`}
        className="py-24"
      />
    )
  }

  return (
    <div className="motion-safe:animate-fade-in mx-auto max-w-xl">
      <header className="border-border/70 bg-card relative overflow-hidden rounded-3xl border shadow-sm">
        <div
          aria-hidden
          className="from-primary/25 via-accent/10 pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-gradient-to-br to-transparent blur-3xl"
        />
        <div className="relative flex flex-col items-center gap-4 px-6 py-10 text-center">
          <span className="from-primary to-accent shadow-primary/30 inline-flex shrink-0 rounded-full bg-gradient-to-br p-[3px] shadow-lg">
            <UserAvatar
              username={profile?.username ?? username}
              size="size-24"
              icon="size-10"
              className="border-background border-2"
            />
          </span>
          {isLoading || !profile ? (
            <div className="space-y-2">
              <Skeleton className="mx-auto h-7 w-40" />
              <Skeleton className="mx-auto h-4 w-24" />
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {profile.display_name || profile.username}
                </h1>
                <p className="text-muted-foreground text-sm">@{profile.username}</p>
              </div>
              <FriendControl profile={profile} />
            </>
          )}
        </div>
      </header>
    </div>
  )
}

/** The right control for my relationship to this person. */
function FriendControl({ profile }: { profile: PublicProfile }) {
  const send = useSendFriendRequest()
  const accept = useAcceptFriend()
  const decline = useDeclineFriend()
  const remove = useRemoveFriend()
  const { status, id } = profile.relationship
  const busy = send.isPending || accept.isPending || decline.isPending || remove.isPending

  if (status === 'self') {
    return (
      <Button asChild variant="outline" className="rounded-full">
        <Link to="/settings">
          <Settings className="mr-1.5 size-4" aria-hidden />
          Edit your profile
        </Link>
      </Button>
    )
  }

  if (status === 'friends') {
    return (
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium">
          <Check className="size-4" aria-hidden /> Friends
        </span>
        {id && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={() => remove.mutate(id)}
          >
            Remove
          </Button>
        )}
      </div>
    )
  }

  if (status === 'outgoing') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
          <Clock className="size-4" aria-hidden /> Request sent
        </span>
        {id && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={() => remove.mutate(id)}
          >
            Cancel
          </Button>
        )}
      </div>
    )
  }

  if (status === 'incoming' && id) {
    return (
      <div className="flex items-center gap-2">
        <Button className="rounded-full" disabled={busy} onClick={() => accept.mutate(id)}>
          <Check className="mr-1 size-4" aria-hidden />
          Accept
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() => decline.mutate(id)}
        >
          <X className="mr-1 size-4" aria-hidden />
          Decline
        </Button>
      </div>
    )
  }

  return (
    <Button className="rounded-full" disabled={busy} onClick={() => send.mutate(profile.id)}>
      <UserPlus className="mr-1.5 size-4" aria-hidden />
      Add friend
    </Button>
  )
}
