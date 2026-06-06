import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { Playlist, Room } from '@/lib/api/models'
import { playlistKeys, roomKeys } from '@/lib/hooks/keys'

// Every mutation returns the fresh Room — seed the cache directly (no refetch).
// TArgs defaults to void so no-arg mutations (next/previous/…) keep `mutate()`.
// The player reconciles the <audio> element to whatever lands in this cache
// (server is_playing + position), so a mutation's own response drives playback
// just like a broadcast frame does — no separate "autoplay intent" flag needed.
// `invalidatesContext` marks mutations that change the played-from list itself
// (play / shuffle / remove / clear) — they also bust the cached context query so
// the panel refetches. Playback-only ops (next/prev/jump/seek/pause) leave it be.
function useRoomMutation<TArgs = void>(
  fn: (args: TArgs) => Promise<Room>,
  { invalidatesContext = false }: { invalidatesContext?: boolean } = {},
) {
  const qc = useQueryClient()
  return useMutation<Room, Error, TArgs>({
    mutationFn: fn,
    onSuccess: (room) => {
      qc.setQueryData(roomKeys.me(), room)
      if (invalidatesContext) void qc.invalidateQueries({ queryKey: roomKeys.context() })
    },
  })
}

/** Play one song now (clicking a track): inserts it at the cursor and plays it —
 *  does NOT pull in the surrounding list. */
export function usePlayNow() {
  return useRoomMutation(
    (trackId: string) =>
      api<Room>('/rooms/play-now/', { method: 'POST', body: { track_id: trackId } }),
    { invalidatesContext: true },
  )
}

/** Replace the context with a list and play from `startIndex` (Play playlist / all). */
export function usePlay() {
  return useRoomMutation(
    (args: { trackIds: string[]; startIndex?: number; label?: string }) =>
      api<Room>('/rooms/play/', {
        method: 'POST',
        body: {
          track_ids: args.trackIds,
          start_index: args.startIndex ?? 0,
          label: args.label ?? '',
        },
      }),
    { invalidatesContext: true },
  )
}

/**
 * Replace the queue with an owned playlist. Plays from the top, or from
 * `startTrackId` when given (clicking a song row plays the playlist from there).
 */
export function usePlayPlaylist() {
  return useRoomMutation(
    (args: { playlistId: string; startTrackId?: string }) =>
      api<Room>('/rooms/play-playlist/', {
        method: 'POST',
        body: { playlist_id: args.playlistId, start_track_id: args.startTrackId },
      }),
    { invalidatesContext: true },
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
  return useRoomMutation(
    (itemId: string) =>
      api<Room>('/rooms/remove/', { method: 'POST', body: { item_id: itemId } }),
    { invalidatesContext: true },
  )
}

/** Shuffle the whole context and play from the top (Spotify-style). */
export function useShuffle() {
  return useRoomMutation(() => api<Room>('/rooms/shuffle/', { method: 'POST' }), {
    invalidatesContext: true,
  })
}

/** Empty the queue and stop playback. */
export function useClearQueue() {
  return useRoomMutation(() => api<Room>('/rooms/clear/', { method: 'POST' }), {
    invalidatesContext: true,
  })
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

/** Start a jam: make my room shareable (assigns a join code). */
export function useShareRoom() {
  return useRoomMutation(() => api<Room>('/rooms/share/', { method: 'POST' }))
}

/** End the jam I host (drops guests, clears the code). */
export function useUnshareRoom() {
  return useRoomMutation(() => api<Room>('/rooms/unshare/', { method: 'POST' }))
}

/** Join a jam by its code (become a guest). Resolves to the host's room. */
export function useJoinRoom() {
  return useRoomMutation((code: string) =>
    api<Room>('/rooms/join/', { method: 'POST', body: { code } }),
  )
}

/** Leave the jam I'm in (guest). Resolves back to my own room. */
export function useLeaveRoom() {
  return useRoomMutation(() => api<Room>('/rooms/leave/', { method: 'POST' }))
}

/** Host toggle: let guests drive playback (play/pause/seek/skip) in the jam. */
export function useSetGuestControl() {
  return useRoomMutation((enabled: boolean) =>
    api<Room>('/rooms/guest-control/', { method: 'POST', body: { enabled } }),
  )
}

/** Host removes a guest from the jam. */
export function useKickMember() {
  return useRoomMutation((userId: string) =>
    api<Room>('/rooms/kick/', { method: 'POST', body: { user_id: userId } }),
  )
}

/** Save the whole queue as an owned playlist. `trackIds` is a snapshot of what was
 *  lined up when the Save dialog opened, so a track ending meanwhile doesn't change
 *  what's saved (the server uses the snapshot verbatim when present). */
export function useSaveQueueAsPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ title, trackIds }: { title: string; trackIds: string[] }) =>
      api<Playlist>('/rooms/save-as-playlist/', {
        method: 'POST',
        body: { title, track_ids: trackIds },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}
