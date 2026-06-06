import { UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useSession } from '@/lib/hooks/queries/auth'
import {
  useCollaborators,
  useInviteCollaborator,
  useRemoveCollaborator,
} from '@/lib/hooks/queries/collaborators'
import { useUserSearch } from '@/lib/hooks/queries/friends'
import { useDebounced } from '@/lib/use-debounced'

/** Compact collaborator manager — lives inside the playlist's Edit panel. A row of
 *  member chips (owner can remove; you can leave), plus an inline invite for the
 *  owner. Deliberately small + unobtrusive. */
export function CollaboratorsManager({
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
  const remove = useRemoveCollaborator(playlistId)
  const members = collaborators.data?.pages.flatMap((p) => p.results) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = collaborators

  return (
    <section className="bg-card border-border/60 space-y-2.5 rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="from-primary to-accent text-primary-foreground shadow-primary/30 flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
          <Users className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium">
            Collaborators
            {members.length > 0 && (
              <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
                {members.length}
              </span>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {isOwner ? 'People who can edit this playlist with you.' : 'Editing this playlist.'}
          </p>
        </div>
      </div>

      {members.length > 0 ? (
        <ul
          className="flex max-h-40 [scrollbar-width:thin] flex-wrap gap-1.5 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            if (
              hasNextPage &&
              !isFetchingNextPage &&
              el.scrollHeight - el.scrollTop - el.clientHeight < 48
            ) {
              void fetchNextPage()
            }
          }}
        >
          {members.map((c) => {
            const isMe = c.user.username === myUsername
            const canRemove = isOwner || isMe
            return (
              <li
                key={c.id}
                className="bg-muted/60 flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-xs"
                title={c.status === 'pending' ? 'Invite pending' : undefined}
              >
                <UserAvatar username={c.user.username} size="size-5" icon="size-3" link />
                <span className={c.status === 'pending' ? 'opacity-60' : ''}>
                  @{c.user.username}
                  {isMe && ' (you)'}
                  {c.status === 'pending' && ' · pending'}
                </span>
                {canRemove && (
                  <button
                    type="button"
                    aria-label={isMe ? 'Leave playlist' : `Remove ${c.user.username}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      remove.mutate(c.user.id, {
                        onSuccess: () =>
                          toast.success(
                            isMe ? 'You left the playlist.' : `Removed @${c.user.username}.`,
                          ),
                      })
                    }
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">
          {isOwner ? 'Invite people to edit this playlist with you.' : 'Just you for now.'}
        </p>
      )}

      {isOwner && <InlineInvite playlistId={playlistId} />}
    </section>
  )
}

function InlineInvite({ playlistId }: { playlistId: string }) {
  const [term, setTerm] = useState('')
  const q = useDebounced(term, 300)
  const results = useUserSearch(q)
  const invite = useInviteCollaborator(playlistId)
  const people = results.data?.pages.flatMap((p) => p.results) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <UserPlus
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Invite by username…"
          aria-label="Invite a collaborator"
          className="h-8 rounded-full pl-8 text-sm"
        />
      </div>
      {q && people.length > 0 && (
        <ul
          className="border-border/60 divide-border/60 max-h-44 [scrollbar-width:thin] divide-y overflow-y-auto rounded-lg border"
          onScroll={(e) => {
            const el = e.currentTarget
            if (
              hasNextPage &&
              !isFetchingNextPage &&
              el.scrollHeight - el.scrollTop - el.clientHeight < 48
            ) {
              void fetchNextPage()
            }
          }}
        >
          {people.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="truncate text-xs">@{u.username}</span>
              <Button
                size="sm"
                className="h-6 rounded-full px-2.5 text-xs"
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
