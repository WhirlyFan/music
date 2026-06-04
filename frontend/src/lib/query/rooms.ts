import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys } from '@/lib/query/keys'

export type Room = components['schemas']['Room']
export type QueueItem = components['schemas']['QueueItem']
type Playlist = components['schemas']['Playlist']

/**
 * Set by the explicit play actions (play / play-now / play-playlist) so the
 * player autoplays even on its *first* mount — distinguishing a deliberate play
 * from the track restored on page load (which must NOT autoplay). The player
 * consumes (clears) it. Module-scoped so it survives the player mounting.
 */
export const playIntent = { value: false }

/** The caller's room: now-playing + a single queue (history behind the cursor,
 *  up-next ahead). Source of truth for the player; rehydrates on load so
 *  playback survives navigation. */
export function useRoom(enabled = true) {
  return useQuery({
    queryKey: roomKeys.me(),
    queryFn: () => api<Room>('/rooms/me/'),
    enabled,
  })
}

// Every mutation returns the fresh Room — seed the cache directly (no refetch).
// TArgs defaults to void so no-arg mutations (next/previous/…) keep `mutate()`.
function useRoomMutation<TArgs = void>(fn: (args: TArgs) => Promise<Room>) {
  const qc = useQueryClient()
  return useMutation<Room, Error, TArgs>({
    mutationFn: fn,
    onSuccess: (room) => qc.setQueryData(roomKeys.me(), room),
  })
}

/** Play one song now (clicking a track): inserts it at the cursor and plays it —
 *  does NOT pull in the surrounding list. */
export function usePlayNow() {
  return useRoomMutation((trackId: string) => {
    playIntent.value = true
    return api<Room>('/rooms/play-now/', { method: 'POST', body: { track_id: trackId } })
  })
}

/** Replace the context with a list and play from `startIndex` (Play playlist / all). */
export function usePlay() {
  return useRoomMutation((args: { trackIds: string[]; startIndex?: number; label?: string }) => {
    playIntent.value = true
    return api<Room>('/rooms/play/', {
      method: 'POST',
      body: {
        track_ids: args.trackIds,
        start_index: args.startIndex ?? 0,
        label: args.label ?? '',
      },
    })
  })
}

/**
 * Replace the queue with an owned playlist. Plays from the top, or from
 * `startTrackId` when given (clicking a song row plays the playlist from there).
 */
export function usePlayPlaylist() {
  return useRoomMutation((args: { playlistId: string; startTrackId?: string }) => {
    playIntent.value = true
    return api<Room>('/rooms/play-playlist/', {
      method: 'POST',
      body: { playlist_id: args.playlistId, start_track_id: args.startTrackId },
    })
  })
}

/** Add tracks to the queue (`playNext` inserts right after current). */
export function useQueueTracks() {
  return useRoomMutation((args: { trackIds: string[]; playNext?: boolean }) =>
    api<Room>('/rooms/queue/', {
      method: 'POST',
      body: { track_ids: args.trackIds, play_next: args.playNext ?? false },
    }),
  )
}

/** Advance the cursor to the next track. */
export function useNext() {
  return useRoomMutation(() => api<Room>('/rooms/next/', { method: 'POST' }))
}

/** Move the cursor back to the previously played track. */
export function usePrevious() {
  return useRoomMutation(() => api<Room>('/rooms/previous/', { method: 'POST' }))
}

/** Click any queue row (history or up-next) to play it now. */
export function useJump() {
  return useRoomMutation((itemId: string) =>
    api<Room>('/rooms/jump/', { method: 'POST', body: { item_id: itemId } }),
  )
}

/** Remove a single queue item. */
export function useRemoveItem() {
  return useRoomMutation((itemId: string) =>
    api<Room>('/rooms/remove/', { method: 'POST', body: { item_id: itemId } }),
  )
}

/** Reshuffle the up-next items. */
export function useShuffle() {
  return useRoomMutation(() => api<Room>('/rooms/shuffle/', { method: 'POST' }))
}

/** Empty the queue and stop playback. */
export function useClearQueue() {
  return useRoomMutation(() => api<Room>('/rooms/clear/', { method: 'POST' }))
}

/** Save the whole queue as an owned playlist. */
export function useSaveQueueAsPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      api<Playlist>('/rooms/save-as-playlist/', { method: 'POST', body: { title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}
