import { Activity, Clock, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlaylistActivity, PlaylistCollaborator } from '@/lib/api/models'
import { avatarInitials, dicebearAvatarUrl } from '@/lib/auth/avatar'
import { useSession } from '@/lib/hooks/queries/auth'
import {
  useCollaborators,
  useInviteCollaborator,
  usePlaylistActivity,
  useRemoveCollaborator,
} from '@/lib/hooks/queries/collaborators'
import { useUserSearch } from '@/lib/hooks/queries/friends'
import { useDebounced } from '@/lib/use-debounced'

/** Collaboration surface for a playlist: who's on it (+ invite/leave), and the edit
 *  history. Rendered for the owner and accepted collaborators. */
export function PlaylistCollaboration({
  playlistId,
  isOwner,
}: {
  playlistId: string
  isOwner: boolean
}) {
  const session = useSession()
  const myUsername = (session.data?.data as { user?: { username?: string } } | undefined)?.user
    ?.username

  const collaborators = useCollaborators(playlistId)
  const activity = usePlaylistActivity(playlistId)
  const remove = useRemoveCollaborator(playlistId)
  const members = collaborators.data ?? []
  const edits = activity.data?.results ?? []

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card icon={Users} title="Collaborators">
        {isOwner && <InviteRow playlistId={playlistId} />}
        {collaborators.isLoading ? (
          <RowSkeletons />
        ) : members.length > 0 ? (
          <ul className="divide-border/60 divide-y">
            {members.map((c) => (
              <MemberRow
                key={c.id}
                member={c}
                // Owner may remove anyone; a collaborator may remove only themselves.
                canRemove={isOwner || c.user.username === myUsername}
                isMe={c.user.username === myUsername}
                onRemove={() =>
                  remove.mutate(c.user.id, {
                    onSuccess: () =>
                      toast.success(
                        c.user.username === myUsername
                          ? 'You left the playlist.'
                          : `Removed ${c.user.username}.`,
                      ),
                  })
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-4 py-5 text-center text-sm">
            {isOwner ? 'No collaborators yet — invite someone above.' : 'Just you for now.'}
          </p>
        )}
      </Card>

      <Card icon={Activity} title="Activity">
        {activity.isLoading ? (
          <RowSkeletons />
        ) : edits.length > 0 ? (
          <ul className="divide-border/60 divide-y">
            {edits.map((a) => (
              <ActivityRow key={a.id} entry={a} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-4 py-5 text-center text-sm">No edits yet.</p>
        )}
      </Card>
    </div>
  )
}

/** Owner-only: username search → invite. */
function InviteRow({ playlistId }: { playlistId: string }) {
  const [term, setTerm] = useState('')
  const q = useDebounced(term, 300)
  const results = useUserSearch(q)
  const invite = useInviteCollaborator(playlistId)

  return (
    <div className="border-border/60 space-y-2 border-b p-3">
      <div className="relative">
        <UserPlus
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Invite by username…"
          aria-label="Invite a collaborator"
          className="rounded-full pl-9"
        />
      </div>
      {q && results.data && results.data.length > 0 && (
        <ul className="border-border/60 divide-border/60 divide-y rounded-lg border">
          {results.data.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-sm">@{u.username}</span>
              <Button
                size="sm"
                className="rounded-full"
                disabled={invite.isPending}
                onClick={() =>
                  invite.mutate(u.id, {
                    onSuccess: () => {
                      toast.success(`Invited @${u.username}.`)
                      setTerm('')
                    },
                  })
                }
              >
                Invite
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MemberRow({
  member,
  canRemove,
  isMe,
  onRemove,
}: {
  member: PlaylistCollaborator
  canRemove: boolean
  isMe: boolean
  onRemove: () => void
}) {
  const pending = member.status === 'pending'
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="ring-border size-8 ring-1">
          <AvatarImage src={dicebearAvatarUrl(member.user.username)} alt="" />
          <AvatarFallback className="text-xs">
            {avatarInitials(member.user.display_name || member.user.username)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            @{member.user.username} {isMe && <span className="text-muted-foreground">(you)</span>}
          </span>
          {pending && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Clock className="size-3" aria-hidden /> Pending
            </span>
          )}
        </span>
      </div>
      {canRemove && (
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive size-8 rounded-full"
          aria-label={isMe ? 'Leave playlist' : `Remove ${member.user.username}`}
          onClick={onRemove}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </li>
  )
}

const ACTION_VERB: Record<string, string> = {
  tracks_added: 'added tracks',
  tracks_removed: 'removed tracks',
  track_reordered: 'reordered the tracks',
  metadata_edited: 'edited the details',
  collaborator_invited: 'invited a collaborator',
  collaborator_joined: 'joined',
  collaborator_removed: 'removed a collaborator',
}

function ActivityRow({ entry }: { entry: PlaylistActivity }) {
  const who = entry.actor_username ?? 'Someone'
  const detail = entry.detail as { summary?: string } | null
  const what = detail?.summary || ACTION_VERB[entry.action] || 'made a change'
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0 truncate">
        <span className="font-medium">@{who}</span> {what}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">{timeAgo(entry.created_at)}</span>
    </li>
  )
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border/60 bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="border-border/60 flex items-center gap-2.5 border-b px-4 py-2.5">
        <span className="from-primary to-accent text-primary-foreground shadow-primary/30 grid size-7 place-items-center rounded-lg bg-gradient-to-br shadow-sm">
          <Icon className="size-4" />
        </span>
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function RowSkeletons() {
  return (
    <div className="space-y-3 p-4">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
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
