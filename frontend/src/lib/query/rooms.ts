import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys } from '@/lib/query/keys'

export type Room = components['schemas']['Room']
export type QueueItem = components['schemas']['QueueItem']
type Playlist = components['schemas']['Playlist']

/** The caller's room (now-playing + the two-layer up-next). Source of truth for
 *  the player + queue panel; rehydrates on load so playback survives navigation. */
export function useRoom(enabled = true) {
  return useQuery({
    queryKey: roomKeys.me(),
    queryFn: () => api<Room>('/rooms/me/'),
    enabled,
  })
}

// Every mutation returns the fresh Room — seed the cache directly (no refetch).
// TArgs defaults to void so no-arg mutations (advance/clear) keep `mutate()`.
function useRoomMutation<TArgs = void>(fn: (args: TArgs) => Promise<Room>) {
  const qc = useQueryClient()
  return useMutation<Room, Error, TArgs>({
    mutationFn: fn,
    onSuccess: (room) => qc.setQueryData(roomKeys.me(), room),
  })
}

/**
 * Play a list as the context, starting at `startIndex` (defaults to the top).
 * Per-track Play sends the whole surrounding list + the clicked index, so the
 * rest of the list becomes the up-next context — like clicking a song in Spotify.
 */
export function usePlay() {
  return useRoomMutation((args: { trackIds: string[]; startIndex?: number; label?: string }) =>
    api<Room>('/rooms/play/', {
      method: 'POST',
      body: {
        track_ids: args.trackIds,
        start_index: args.startIndex ?? 0,
        label: args.label ?? '',
      },
    }),
  )
}

/** Play an owned playlist as the context, from the top. */
export function usePlayPlaylist() {
  return useRoomMutation((playlistId: string) =>
    api<Room>('/rooms/play-playlist/', { method: 'POST', body: { playlist_id: playlistId } }),
  )
}

/** Add tracks to the user queue (`playNext` puts them at the head). */
export function useQueueTracks() {
  return useRoomMutation((args: { trackIds: string[]; playNext?: boolean }) =>
    api<Room>('/rooms/queue/', {
      method: 'POST',
      body: { track_ids: args.trackIds, play_next: args.playNext ?? false },
    }),
  )
}

/** Click an up-next item to play it now (skips everything before it). */
export function useJump() {
  return useRoomMutation((itemId: string) =>
    api<Room>('/rooms/jump/', { method: 'POST', body: { item_id: itemId } }),
  )
}

/** Remove a single up-next item. */
export function useRemoveItem() {
  return useRoomMutation((itemId: string) =>
    api<Room>('/rooms/remove/', { method: 'POST', body: { item_id: itemId } }),
  )
}

/** Reshuffle the remaining context order. */
export function useShuffle() {
  return useRoomMutation(() => api<Room>('/rooms/shuffle/', { method: 'POST' }))
}

/** Advance the head: user queue first, then the context. */
export function useAdvance() {
  return useRoomMutation(() => api<Room>('/rooms/advance/', { method: 'POST' }))
}

/** Empty both layers and stop playback. */
export function useClearQueue() {
  return useRoomMutation(() => api<Room>('/rooms/clear/', { method: 'POST' }))
}

/** Save what's lined up (now-playing + queue + context) as an owned playlist. */
export function useSaveQueueAsPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      api<Playlist>('/rooms/save-as-playlist/', { method: 'POST', body: { title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}
