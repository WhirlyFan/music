import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { Playlist, Room } from '@/lib/api/models'
import { playlistKeys, roomKeys } from '@/lib/hooks/keys'

// Every mutation returns the fresh Room — seed the cache directly (no refetch).
// TArgs defaults to void so no-arg mutations (next/previous/…) keep `mutate()`.
// The player reconciles the <audio> element to whatever lands in this cache
// (server is_playing + position), so a mutation's own response drives playback
// just like a broadcast frame does — no separate "autoplay intent" flag needed.
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
  return useRoomMutation((trackId: string) =>
    api<Room>('/rooms/play-now/', { method: 'POST', body: { track_id: trackId } }),
  )
}

/** Replace the context with a list and play from `startIndex` (Play playlist / all). */
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

/**
 * Replace the queue with an owned playlist. Plays from the top, or from
 * `startTrackId` when given (clicking a song row plays the playlist from there).
 */
export function usePlayPlaylist() {
  return useRoomMutation((args: { playlistId: string; startTrackId?: string }) =>
    api<Room>('/rooms/play-playlist/', {
      method: 'POST',
      body: { playlist_id: args.playlistId, start_track_id: args.startTrackId },
    }),
  )
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

/** Shuffle the whole context and play from the top (Spotify-style). */
export function useShuffle() {
  return useRoomMutation(() => api<Room>('/rooms/shuffle/', { method: 'POST' }))
}

/** Empty the queue and stop playback. */
export function useClearQueue() {
  return useRoomMutation(() => api<Room>('/rooms/clear/', { method: 'POST' }))
}

/**
 * Re-anchor the server playback clock: report the real playhead (ms) + whether
 * audio is playing. Drives synced play/pause and seek across the jam — the
 * server stamps playing_since and broadcasts, every client reconciles.
 */
export function useSyncPlayback() {
  return useRoomMutation((args: { positionMs: number; isPlaying: boolean }) =>
    api<Room>('/rooms/sync/', {
      method: 'POST',
      body: { position_ms: args.positionMs, is_playing: args.isPlaying },
    }),
  )
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
