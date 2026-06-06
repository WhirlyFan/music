import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { QueueItem, Room, RoomMember } from '@/lib/api/models'
import { roomKeys } from '@/lib/hooks/keys'

// The members endpoint paginates (DRF), but its schema comes through as a plain
// array, so type the page shape here.
type MembersPage = { next: string | null; results: RoomMember[] }
export type ContextPage = { next: string | null; results: QueueItem[] }

/** The room the user is actively in — the jam they've joined as a guest, else
 *  their own room. Source of truth for the player; rehydrates on load so
 *  playback survives navigation. (Cache key stays roomKeys.me() — it's just the
 *  identifier the mutations + socket also write; the endpoint resolves "current".) */
export function useRoom(enabled = true) {
  return useQuery({
    queryKey: roomKeys.me(),
    queryFn: () => api<Room>('/rooms/current/'),
    enabled,
  })
}

/** Paginated roster of the jam you're in (host first). Kept off the broadcast
 *  frames — the modal loads it on demand and pages through as it scrolls. */
export function useJamMembers(enabled = true) {
  return useInfiniteQuery({
    queryKey: roomKeys.members(),
    queryFn: ({ pageParam }) => api<MembersPage>(`/rooms/members/?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled,
  })
}

/** The FULL context (the played-from list) for the room you're in — paginated,
 *  kept off the broadcast frames. Fetched once and cached with a long staleTime,
 *  so playback ticks (play/pause/seek/skip) never refetch it; it's invalidated
 *  only when the context list actually changes (play/shuffle/remove/clear, and a
 *  jam guest on a context_version change). */
export function useRoomContext(enabled = true) {
  return useInfiniteQuery({
    queryKey: roomKeys.context(),
    queryFn: ({ pageParam }) => api<ContextPage>(`/rooms/context/?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}
