import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  GripVertical,
  ListPlus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/page-header'
import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { Ripples, useRipple } from '@/components/ui/ripple'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { PlaylistDetail, PlaylistTrack } from '@/lib/query/catalog'
import {
  useDeletePlaylist,
  useInfinitePlaylistTracks,
  usePlaylist,
  useRefreshArtwork,
  useRemoveTrackFromPlaylist,
  useReorderPlaylistTrack,
  useUpdatePlaylist,
} from '@/lib/query/catalog'
import { usePlayPlaylist, useQueueTracks } from '@/lib/query/rooms'

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
  const { data: playlist, isLoading, error } = usePlaylist(playlistId)
  const tracks = useInfinitePlaylistTracks(playlistId)
  const playPlaylist = usePlayPlaylist()
  const queueTracks = useQueueTracks()
  const refreshArtwork = useRefreshArtwork()
  const removeTrack = useRemoveTrackFromPlaylist(playlistId)
  const reorder = useReorderPlaylistTrack(playlistId)
  const del = useDeletePlaylist()

  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const dragId = useRef<string | null>(null)

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = tracks
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) return <PlaylistDetailSkeleton />
  if (error || !playlist) return <FormError message="Failed to load playlist." />

  const items = tracks.data?.pages.flatMap((p) => p.results) ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Playlists', to: '/playlists' }, { label: playlist.title }]}
        title={playlist.title}
        description={`${playlist.track_count} track${playlist.track_count === 1 ? '' : 's'}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              disabled={!playlist.track_count}
              onClick={() =>
                playPlaylist.mutate({ playlistId }, { onSuccess: () => toast.success('Playing.') })
              }
            >
              Play
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Playlist actions">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing((v) => !v)}>
                  <Pencil className="mr-2 size-4" />
                  {editing ? 'Done editing' : 'Edit'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {editing && (
        <EditPanel
          key={playlistId}
          playlist={playlist}
          playlistId={playlistId}
          onDone={() => setEditing(false)}
        />
      )}

      {tracks.isError && <FormError message="Failed to load tracks." />}

      <ol className="space-y-2">
        {items.map((item) => (
          <TrackRow
            key={item.track.id}
            item={item}
            editing={editing}
            refreshing={refreshArtwork.isPending}
            onPlayFrom={(trackId) => playPlaylist.mutate({ playlistId, startTrackId: trackId })}
            onQueue={(trackId) =>
              queueTracks.mutate(
                { trackIds: [trackId] },
                { onSuccess: () => toast.success('Added to queue.') },
              )
            }
            onRemove={(trackId) => removeTrack.mutate(trackId)}
            onRefreshArt={(trackId) => refreshArtwork.mutate(trackId)}
            onDragStartItem={(trackId) => (dragId.current = trackId)}
            onDropOnItem={(position) => {
              if (dragId.current) reorder.mutate({ trackId: dragId.current, position })
              dragId.current = null
            }}
          />
        ))}
      </ol>

      {/* Infinite-scroll sentinel — shows skeleton rows while the next page loads. */}
      <div ref={sentinelRef} className="space-y-2 py-2">
        {isFetchingNextPage && (
          <>
            <TrackRowSkeleton />
            <TrackRowSkeleton />
          </>
        )}
      </div>

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

/** Inline metadata editor (rename / describe / visibility). */
function EditPanel({
  playlist,
  playlistId,
  onDone,
}: {
  playlist: PlaylistDetail
  playlistId: string
  onDone: () => void
}) {
  const update = useUpdatePlaylist()
  // Intentional draft state: these are an editable copy you can cancel. The
  // parent keys this component by playlistId, so switching playlists remounts
  // it and re-seeds the draft — no prop→state syncing effect needed.
  const [title, setTitle] = useState(playlist.title)
  const [description, setDescription] = useState(playlist.description ?? '')
  const [isPublic, setIsPublic] = useState(playlist.is_public ?? false)

  return (
    <section className="border-border space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <label htmlFor="pl-title" className="text-sm font-medium">
          Title
        </label>
        <Input id="pl-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="pl-desc" className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id="pl-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        Public — anyone with the link can view
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={update.isPending || !title.trim()}
          onClick={() =>
            update.mutate(
              { id: playlistId, title: title.trim(), description, isPublic },
              { onSuccess: () => { toast.success('Saved.'); onDone() } },
            )
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

function TrackRow({
  item,
  editing,
  refreshing,
  onPlayFrom,
  onQueue,
  onRemove,
  onRefreshArt,
  onDragStartItem,
  onDropOnItem,
}: {
  item: PlaylistTrack
  editing: boolean
  refreshing: boolean
  onPlayFrom: (trackId: string) => void
  onQueue: (trackId: string) => void
  onRemove: (trackId: string) => void
  onRefreshArt: (trackId: string) => void
  onDragStartItem: (trackId: string) => void
  onDropOnItem: (position: number) => void
}) {
  const ripple = useRipple()
  const { track } = item

  return (
    <li
      draggable={editing}
      onDragStart={editing ? () => onDragStartItem(track.id) : undefined}
      onDragOver={editing ? (e) => e.preventDefault() : undefined}
      onDrop={editing ? () => onDropOnItem(item.position) : undefined}
      onPointerDown={editing ? undefined : ripple.onPointerDown}
      className={`border-border relative flex items-center gap-3 overflow-hidden rounded-lg border p-3 ${
        editing ? 'cursor-grab' : 'hover:bg-accent/40'
      }`}
    >
      {/* Full-row play target (only when not editing). */}
      {!editing && (
        <button
          type="button"
          aria-label={`Play ${track.title}`}
          onClick={() => onPlayFrom(track.id)}
          className="absolute inset-0 rounded-lg"
        />
      )}
      {editing && (
        <GripVertical className="text-muted-foreground size-4 shrink-0" aria-hidden />
      )}
      <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
        {item.position + 1}
      </span>
      <div className="relative shrink-0" onPointerDown={(e) => e.stopPropagation()}>
        <TrackArtwork track={track} />
        {isYouTubeArt(track.artwork_url) && (
          <button
            type="button"
            aria-label={`Retry cover art for ${track.title}`}
            title="Cover is from YouTube — retry the original"
            disabled={refreshing}
            onClick={() => onRefreshArt(track.id)}
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
      <div className="relative z-10 flex items-center" onPointerDown={(e) => e.stopPropagation()}>
        {editing ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${track.title} from playlist`}
            title="Remove from playlist"
            onClick={() => onRemove(track.id)}
          >
            <X className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Add ${track.title} to queue`}
            title="Add to queue"
            onClick={() => onQueue(track.id)}
          >
            <ListPlus className="size-4" />
          </Button>
        )}
      </div>
      {!editing && <Ripples ripples={ripple.ripples} onDone={ripple.remove} />}
    </li>
  )
}

/** Colocated skeletons — same shells as the header + TrackRow so they can't drift. */
function TrackRowSkeleton() {
  return (
    <li
      aria-hidden
      className="border-border flex items-center gap-3 rounded-lg border p-3"
    >
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <SkeletonText className="max-w-[14rem]" />
        <SkeletonText className="max-w-[9rem] text-sm" />
      </div>
    </li>
  )
}

function PlaylistDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy aria-label="Loading playlist">
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-28" /> {/* breadcrumb */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" /> {/* title */}
            <Skeleton className="h-4 w-24" /> {/* track count */}
          </div>
          <Skeleton className="h-10 w-20" /> {/* Play */}
        </div>
      </div>
      <ol className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <TrackRowSkeleton key={i} />
        ))}
      </ol>
    </div>
  )
}
