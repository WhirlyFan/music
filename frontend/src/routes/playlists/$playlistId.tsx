import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Check,
  Globe,
  GripVertical,
  ListPlus,
  Pencil,
  RefreshCw,
  SearchX,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/page-header'
import { CollaboratorsManager } from '@/components/playlist/collaborators-manager'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { UserAvatar } from '@/components/ui/user-avatar'
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
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Ripples, useRipple } from '@/components/ui/ripple'
import { Skeleton, SkeletonText, SkeletonZone, useSkeletonZone } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { PaginatedPlaylistTrackList, PlaylistTrack } from '@/lib/api/models'
import { playlistKeys } from '@/lib/hooks/keys'
import {
  useDeletePlaylist,
  useRefreshArtwork,
  useRefreshPlaylist,
  useRemoveTracksFromPlaylist,
  useReorderPlaylistTrack,
  useUpdatePlaylist,
} from '@/lib/hooks/mutations/catalog'
import { usePlayPlaylist, useQueueTracks } from '@/lib/hooks/mutations/rooms'
import { useSession } from '@/lib/hooks/queries/auth'
import { useInfinitePlaylistTracks, usePlaylist } from '@/lib/hooks/queries/catalog'
import { useRouteSearch } from '@/lib/hooks/queries/ui'
import { usePlaylistSocket } from '@/lib/hooks/usePlaylistSocket'
import { useDebounced } from '@/lib/use-debounced'

/** A YouTube-thumbnail fallback cover — offer to re-resolve the real art. */
function isYouTubeArt(url?: string | null): boolean {
  return !!url && url.includes('i.ytimg.com')
}

export const Route = createFileRoute('/playlists/$playlistId')({
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()
  const navigate = useNavigate()
  const session = useSession()
  // Live-update this view when anyone edits the playlist (ephemeral viewer channel).
  usePlaylistSocket(playlistId)
  const { data: playlist, isLoading, error } = usePlaylist(playlistId)
  // Search value is owned by the persistent layout pill, keyed by this exact path
  // (same key the pill writes); this page reads it to drive the track query.
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { value: search } = useRouteSearch(path)
  const q = useDebounced(search, 300)
  const tracks = useInfinitePlaylistTracks(playlistId, q)
  const playPlaylist = usePlayPlaylist()
  const queueTracks = useQueueTracks()
  const refreshArtwork = useRefreshArtwork()
  const removeTracks = useRemoveTracksFromPlaylist(playlistId)
  const reorder = useReorderPlaylistTrack(playlistId)
  const del = useDeletePlaylist()
  const refresh = useRefreshPlaylist()
  const update = useUpdatePlaylist()

  const [editing, setEditing] = useState(false)
  // Staged metadata edits (title/description/visibility), applied on Save and discarded
  // on Cancel — edited inline in the header. Page-level state, so a collaborator's
  // remote change can't clobber your open draft.
  const [draft, setDraft] = useState({ title: '', description: '', isPublic: false })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  // Track ids selected (in edit mode) for batch removal.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const qc = useQueryClient()
  // Drag starts only after a 5px move, so a tap still selects (and the grip is the
  // only handle) — dnd-kit animates siblings out of the way during the drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = tracks
  // Auto-load the next page when the sentinel nears the viewport (callback ref so the
  // observer always reads fresh hasNextPage/isFetchingNextPage from the closure).
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !hasNextPage) return
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting && !isFetchingNextPage) fetchNextPage()
        },
        { rootMargin: '600px 0px' },
      )
      io.observe(node)
      return () => io.disconnect()
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Leaving edit mode clears any selection (render-phase reset — no effect).
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (!editing && selected.size) setSelected(new Set())
  }

  if (error)
    return (
      <EmptyState
        tone="error"
        icon={TriangleAlert}
        title="Couldn’t load this playlist"
        description="Something went wrong reaching the server. Refresh to try again."
        className="py-24"
      />
    )
  // Loading: the REAL header + rows rendered inside a SkeletonZone so each shows
  // its own skeleton (no parallel skeleton tree).
  if (isLoading || !playlist) {
    return (
      <SkeletonZone>
        <div className="space-y-6 pb-36">
          <PageHeader
            breadcrumbs={[{ label: 'playlists', to: '/playlists' }]}
            title={<SkeletonText className="max-w-[16rem]" />}
            description={<SkeletonText className="max-w-[6rem]" />}
            actions={
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-16 rounded-md" />
                <Skeleton className="h-9 w-20 rounded-md" />
              </div>
            }
          />
          <ol className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <TrackRow key={i} />
            ))}
          </ol>
        </div>
      </SkeletonZone>
    )
  }

  const items = tracks.data?.pages.flatMap((p) => p.results) ?? []
  const isOwner = playlist.is_owner
  // Collaborators can edit tracks + metadata too (delete/visibility/refresh stay owner-only).
  const canEdit = playlist.can_edit
  // Only show per-row "added by" avatars on a genuinely collaborative playlist, and
  // only for OTHER people (your own additions don't get an avatar).
  const hasCollaborators = (playlist.collaborator_count ?? 0) > 0
  const myUsername = (session.data?.data as { user?: { username?: string } } | undefined)?.user
    ?.username
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.track.id))

  const toggleSelect = (trackId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })

  const confirmRemove = () => {
    const ids = [...selected]
    removeTracks.mutate(ids, {
      onSuccess: () => {
        toast.success(`Removed ${ids.length} song${ids.length === 1 ? '' : 's'}.`)
        setSelected(new Set())
        setRemoveOpen(false)
      },
    })
  }

  // Inline header editing: seed the draft on enter, apply on Save, discard on Cancel.
  const startEdit = () => {
    setDraft({
      title: playlist.title,
      description: playlist.description ?? '',
      isPublic: playlist.is_public ?? false,
    })
    setEditing(true)
  }
  const saveEdit = () => {
    const title = draft.title.trim()
    if (!title) return toast.error('A playlist needs a title.')
    update.mutate(
      {
        id: playlistId,
        title,
        description: draft.description,
        // Visibility is owner-only; don't send it for a collaborator.
        isPublic: isOwner ? draft.isPublic : undefined,
      },
      {
        onSuccess: () => {
          toast.success('Saved.')
          setEditing(false)
        },
      },
    )
  }

  // Reorder via drag: optimistically reorder the cached track pages (so the row
  // stays put instead of snapping back), then persist to the new absolute position.
  const tracksKey = [...playlistKeys.tracks(playlistId), q]
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.track.id === active.id)
    const to = items.findIndex((i) => i.track.id === over.id)
    if (from < 0 || to < 0) return
    qc.setQueryData<{ pages: PaginatedPlaylistTrackList[]; pageParams: unknown[] }>(
      tracksKey,
      (data) => {
        if (!data) return data
        const flat = arrayMove(
          data.pages.flatMap((p) => p.results),
          from,
          to,
        )
        let cursor = 0
        const pages = data.pages.map((p) => {
          const results = flat.slice(cursor, cursor + p.results.length)
          cursor += p.results.length
          return { ...p, results }
        })
        return { ...data, pages }
      },
    )
    reorder.mutate({ trackId: String(active.id), position: to })
  }

  return (
    <div className="space-y-6 pb-36">
      {/* Consolidated header: title + description live here and become inline fields
          in edit mode (no separate metadata card) — so edit mode is mostly the track
          list. The visibility toggle, refresh + delete are compact controls here too. */}
      <header className="space-y-3">
        <Breadcrumbs items={[{ label: 'playlists', to: '/playlists' }, { label: playlist.title }]} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            {editing ? (
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                maxLength={255}
                autoFocus
                aria-label="Playlist title"
                className="border-border/60 focus:border-primary w-full max-w-xl border-b bg-transparent pb-0.5 text-2xl font-semibold tracking-tight outline-none"
              />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">{playlist.title}</h1>
            )}

            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              {`${playlist.track_count} track${playlist.track_count === 1 ? '' : 's'}`}
              {!editing && playlist.is_public && (
                <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <Globe className="size-3" aria-hidden /> Public
                </span>
              )}
            </p>

            {editing ? (
              <div className="max-w-xl space-y-1.5">
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="A short blurb (optional)"
                  maxLength={200}
                  rows={2}
                  className="resize-none"
                />
                <div className="flex items-center justify-between gap-3">
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, isPublic: !d.isPublic }))}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        draft.isPublic
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <Globe className="size-3.5" aria-hidden />
                      {draft.isPublic ? 'Public' : 'Private'}
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {draft.description.length}/200
                  </span>
                </div>
              </div>
            ) : (
              playlist.description && (
                <p className="text-muted-foreground border-border max-w-prose border-l-2 pl-3 text-sm leading-relaxed break-words">
                  {playlist.description}
                </p>
              )
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {editing ? (
              <>
                {isOwner && playlist.origin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Refresh from source"
                    title="Refresh from source"
                    onClick={() => setRefreshOpen(true)}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={saveEdit} disabled={update.isPending || !draft.title.trim()}>
                  {update.isPending ? 'Saving…' : 'Save'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={!playlist.track_count}
                  onClick={() => playPlaylist.mutate({ playlistId })}
                >
                  Play
                </Button>
                {canEdit && (
                  <Button variant="outline" onClick={startEdit}>
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </Button>
                )}
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete playlist"
                    title="Delete playlist"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Collaborators — compact, only while editing; managing songs is the primary
          task, so this sits quietly below the header. */}
      {editing && canEdit && <CollaboratorsManager playlistId={playlistId} isOwner={isOwner} />}

      {/* Batch-select toolbar (edit mode). */}
      {editing && (
        <div className="bg-card/95 border-border/60 sticky top-16 z-10 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(items.map((i) => i.track.id)))
            }
            className="text-sm font-medium"
            disabled={items.length === 0}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm tabular-nums">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive disabled:text-muted-foreground"
              disabled={selected.size === 0}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="mr-2 size-4" />
              Remove
            </Button>
          </div>
        </div>
      )}

      {tracks.isError && (
        <EmptyState
          tone="error"
          icon={TriangleAlert}
          title="Couldn’t load tracks"
          description="The track list didn’t come through. Refresh to try again."
        />
      )}

      {/* Edit mode (unfiltered) → drag-to-reorder with dnd-kit: siblings animate out
          of the way as you drag the grip. While searching, reordering a filtered
          subset is ambiguous, so we fall back to the plain selectable rows. */}
      {editing && !q ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={items.map((i) => i.track.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-2">
              {items.map((item) => (
                <SortableTrackRow
                  key={item.track.id}
                  item={item}
                  selected={selected.has(item.track.id)}
                  onToggleSelect={() => toggleSelect(item.track.id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ol className="space-y-2">
          {items.map((item) => (
            <TrackRow
              key={item.track.id}
              item={item}
              editing={editing}
              selected={selected.has(item.track.id)}
              refreshing={refreshArtwork.isPending}
              adderUsername={
                hasCollaborators && item.added_by && item.added_by !== myUsername
                  ? item.added_by
                  : undefined
              }
              onToggleSelect={() => toggleSelect(item.track.id)}
              onPlayFrom={(trackId) => playPlaylist.mutate({ playlistId, startTrackId: trackId })}
              onQueue={(trackId) =>
                queueTracks.mutate(
                  { trackIds: [trackId] },
                  { onSuccess: () => toast.success('Added to queue.') },
                )
              }
              onRefreshArt={(trackId) => refreshArtwork.mutate(trackId)}
            />
          ))}
        </ol>
      )}

      {q && items.length === 0 && !tracks.isFetching && (
        <EmptyState
          icon={SearchX}
          title="No matching songs"
          description={`Nothing in this playlist matches “${q.length > 40 ? `${q.slice(0, 40)}…` : q}”.`}
        />
      )}

      {/* Infinite-scroll sentinel — shows skeleton rows while the next page loads. */}
      <div ref={sentinelRef} className="py-2">
        {isFetchingNextPage && (
          <SkeletonZone>
            <ol className="space-y-2">
              <TrackRow />
              <TrackRow />
            </ol>
          </SkeletonZone>
        )}
      </div>

      <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh “{playlist.title}” from source?</AlertDialogTitle>
            <AlertDialogDescription>
              We’ll re-fetch the original playlist and update this one to match it (add new songs,
              drop removed ones). Any manual changes you’ve made here will be replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={refresh.isPending}
              onClick={() =>
                refresh.mutate(playlistId, {
                  onSuccess: () => toast.success('Refreshed from source.'),
                  onError: () => toast.error('Couldn’t refresh — the source may be unavailable.'),
                })
              }
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selected.size} song{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They’re removed from this playlist. The songs stay in your catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={removeTracks.isPending} onClick={confirmRemove}>
              {removeTracks.isPending ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{playlist.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The playlist is removed. The songs stay in your catalog, so re-importing them later is
              instant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                del.mutate(playlistId, {
                  onSuccess: () => {
                    toast.success('Playlist deleted.')
                    navigate({ to: '/playlists' })
                  },
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Edit-mode row in the unfiltered list: drag the grip to reorder. dnd-kit applies a
 *  transform/transition so the other rows glide out of the way as you drag; tapping
 *  the row (not the grip) toggles selection for batch removal. */
function SortableTrackRow({
  item,
  selected,
  onToggleSelect,
}: {
  item: PlaylistTrack
  selected: boolean
  onToggleSelect: () => void
}) {
  const { track } = item
  // Drive dnd-kit's reorder animation with the app's springy curve (same as the
  // gooey menu) so neighbours glide to make room with a little overshoot — the
  // gravity-sim "feel" without forcing its 2D centre-pull physics onto a 1D list.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    transition: { duration: 220, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={onToggleSelect}
      className={`border-border/60 flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
        isDragging ? 'bg-card relative z-10 shadow-lg' : ''
      } ${selected ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/40'}`}
    >
      <span
        aria-hidden
        className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        }`}
      >
        {selected && <Check className="size-3.5" />}
      </span>
      {/* Only the grip starts a drag — clicking the row body selects. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Reorder ${track.title}`}
        className="text-muted-foreground hover:text-foreground -ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
        {item.position + 1}
      </span>
      <TrackArtwork track={track} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {track.is_explicit && <ExplicitBadge />}
          <p className="truncate font-medium">{track.title}</p>
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
        </p>
      </div>
    </li>
  )
}

function TrackRow({
  item,
  editing = false,
  selected = false,
  refreshing = false,
  adderUsername,
  onToggleSelect,
  onPlayFrom,
  onQueue,
  onRefreshArt,
}: {
  item?: PlaylistTrack
  editing?: boolean
  selected?: boolean
  refreshing?: boolean
  // The collaborator who added this song (only set for OTHER people's additions on a
  // collaborative playlist) → shown as a small avatar on the row.
  adderUsername?: string
  onToggleSelect?: () => void
  onPlayFrom?: (trackId: string) => void
  onQueue?: (trackId: string) => void
  onRefreshArt?: (trackId: string) => void
}) {
  const ripple = useRipple()
  const skeleton = useSkeletonZone()

  // Zone-driven skeleton: mirror the real VIEW-mode row exactly — leading position
  // number, artwork, two text lines, and the trailing add-to-queue button — so the
  // skeleton occupies the same box the loaded row will.
  if (skeleton || !item) {
    return (
      <li aria-hidden className="border-border/60 flex items-center gap-3 rounded-xl border p-3">
        <Skeleton className="h-4 w-5 shrink-0" />
        <Skeleton className="size-10 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <SkeletonText className="max-w-[14rem]" />
          <SkeletonText className="max-w-[9rem] text-sm" />
        </div>
        <Skeleton className="size-9 shrink-0 rounded-md" />
      </li>
    )
  }

  const { track } = item

  // Edit mode while SEARCHING: a tap-to-select row (no drag — reordering a filtered
  // subset is ambiguous, so the unfiltered list uses SortableTrackRow instead).
  if (editing) {
    return (
      <li
        onClick={() => onToggleSelect?.()}
        className={`border-border/60 flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
          selected ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/40'
        }`}
      >
        <span
          aria-hidden
          className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          }`}
        >
          {selected && <Check className="size-3.5" />}
        </span>
        <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
          {item.position + 1}
        </span>
        <TrackArtwork track={track} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {track.is_explicit && <ExplicitBadge />}
            <p className="truncate font-medium">{track.title}</p>
          </div>
          <p className="text-muted-foreground truncate text-sm">
            {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
          </p>
        </div>
      </li>
    )
  }

  // View mode: full-row play target + cover (also plays) + add-to-queue.
  return (
    <li
      onPointerDown={ripple.onPointerDown}
      className="border-border/60 hover:bg-accent/40 relative flex items-center gap-3 overflow-hidden rounded-xl border p-3"
    >
      <button
        type="button"
        aria-label={`Play ${track.title}`}
        onClick={() => onPlayFrom?.(track.id)}
        className="absolute inset-0 rounded-xl"
      />
      <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
        {item.position + 1}
      </span>
      <div
        className="relative shrink-0 cursor-pointer"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onPlayFrom?.(track.id)}
      >
        <TrackArtwork track={track} />
        {isYouTubeArt(track.artwork_url) && (
          <button
            type="button"
            aria-label={`Retry cover art for ${track.title}`}
            title="Cover is from YouTube — retry the original"
            disabled={refreshing}
            onClick={(e) => {
              e.stopPropagation()
              onRefreshArt?.(track.id)
            }}
            className="bg-background/80 text-foreground hover:bg-background absolute -top-1 -right-1 z-10 grid size-5 place-items-center rounded-full border shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {track.is_explicit && <ExplicitBadge />}
          <p className="truncate font-medium">{track.title}</p>
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
        </p>
      </div>
      {adderUsername && (
        <UserAvatar
          username={adderUsername}
          size="size-6"
          icon="size-3"
          className="ring-border relative z-10 ring-1"
          link
        />
      )}
      <div className="relative z-10 flex items-center" onPointerDown={(e) => e.stopPropagation()}>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Add ${track.title} to queue`}
          title="Add to queue"
          onClick={() => onQueue?.(track.id)}
        >
          <ListPlus className="size-4" />
        </Button>
      </div>
      <Ripples ripples={ripple.ripples} onDone={ripple.remove} />
    </li>
  )
}
