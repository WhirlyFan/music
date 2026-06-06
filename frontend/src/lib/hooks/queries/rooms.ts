import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { Room } from '@/lib/api/models'
import { roomKeys } from '@/lib/hooks/keys'

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
