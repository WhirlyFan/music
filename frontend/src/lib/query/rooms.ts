import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys } from '@/lib/query/keys'

export type Room = components['schemas']['Room']
export type QueueItem = components['schemas']['QueueItem']
type Playlist = components['schemas']['Playlist']

/** The caller's room (now-playing + persisted queue). Source of truth for the
 *  player + queue panel; rehydrates on load so the queue survives navigation. */
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

type EnqueueMode = components['schemas']['ModeEnum']

/** Enqueue one track (add / play_next / play_now). */
export function useEnqueue() {
  return useRoomMutation((args: { trackId: string; mode?: EnqueueMode }) =>
    api<Room>('/rooms/enqueue/', {
      method: 'POST',
      body: { track_id: args.trackId, mode: args.mode ?? 'add' },
    }),
  )
}

/** Enqueue many tracks — replace=true is Play (reset + start), false is Add to queue. */
export function useEnqueueBatch() {
  return useRoomMutation((args: { trackIds: string[]; replace: boolean }) =>
    api<Room>('/rooms/enqueue-batch/', {
      method: 'POST',
      body: { track_ids: args.trackIds, replace: args.replace },
    }),
  )
}

/** Replace the queue with an owned playlist's tracks and start playing. */
export function usePlayPlaylist() {
  return useRoomMutation((playlistId: string) =>
    api<Room>('/rooms/play-playlist/', { method: 'POST', body: { playlist_id: playlistId } }),
  )
}

/** Advance the now-playing head to the next queued track. */
export function useAdvance() {
  return useRoomMutation(() => api<Room>('/rooms/advance/', { method: 'POST' }))
}

/** Empty the queue and stop playback. */
export function useClearQueue() {
  return useRoomMutation(() => api<Room>('/rooms/clear/', { method: 'POST' }))
}

/** Save the current queue as an owned playlist. */
export function useSaveQueueAsPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      api<Playlist>('/rooms/save-as-playlist/', { method: 'POST', body: { title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}
