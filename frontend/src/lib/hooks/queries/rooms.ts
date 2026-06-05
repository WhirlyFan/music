import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { Room } from '@/lib/api/models'
import { roomKeys } from '@/lib/hooks/keys'

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
