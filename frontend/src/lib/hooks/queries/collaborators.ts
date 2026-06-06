import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { PlaylistCollaborator } from '@/lib/api/models'
import { notificationKeys, playlistKeys } from '@/lib/hooks/keys'

type CollaboratorsPage = { count: number; next: string | null; results: PlaylistCollaborator[] }

/** Collaborators on a playlist (pending + accepted). Owner + any member may read.
 *  Infinite (25/page): typically a handful, so only the first page loads — more only
 *  on scroll, keeping the request cheap even for an unusually large collaborator set. */
export function useCollaborators(playlistId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: playlistKeys.collaborators(playlistId),
    queryFn: ({ pageParam }) =>
      api<CollaboratorsPage>(`/catalog/playlists/${playlistId}/collaborators/?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled: enabled && !!playlistId,
  })
}

// Collaboration mutations refresh the playlist's collaborator list + history; accept
// also clears the notification badge it came from.
function useCollabMutation<T>(playlistId: string, fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: playlistKeys.collaborators(playlistId) })
      void qc.invalidateQueries({ queryKey: playlistKeys.activity(playlistId) })
      void qc.invalidateQueries({ queryKey: notificationKeys.all() })
    },
  })
}

/** Owner invites a user (picked from a user search) to collaborate. */
export function useInviteCollaborator(playlistId: string) {
  return useCollabMutation(playlistId, (userId: string) =>
    api(`/catalog/playlists/${playlistId}/collaborators/`, {
      method: 'POST',
      body: { user_id: userId },
    }),
  )
}

/** Owner removes a collaborator, or a collaborator removes themselves (leave). */
export function useRemoveCollaborator(playlistId: string) {
  return useCollabMutation(playlistId, (userId: string) =>
    api(`/catalog/playlists/${playlistId}/collaborators/${userId}/`, { method: 'DELETE' }),
  )
}

/** The invitee accepts (or declines) a pending collaboration invite. Accept makes the
 *  playlist visible/editable to them; both refresh the playlists + notifications. */
function useInviteResponse(verb: 'collab-accept' | 'collab-decline') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (playlistId: string) =>
      api(`/catalog/playlists/${playlistId}/${verb}/`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: playlistKeys.all() })
      void qc.invalidateQueries({ queryKey: notificationKeys.all() })
    },
  })
}

export const useAcceptCollabInvite = () => useInviteResponse('collab-accept')
export const useDeclineCollabInvite = () => useInviteResponse('collab-decline')

/** Add a track to a chosen playlist (owner or accepted collaborator) — the playlist
 *  id is passed per call, so one hook serves a "pick a playlist" menu over many rows. */
export function useAddTrackToPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      api<{ added: number }>(`/catalog/playlists/${playlistId}/add-tracks/`, {
        method: 'POST',
        body: { track_ids: [trackId] },
      }),
    onSuccess: (_data, { playlistId }) => {
      void qc.invalidateQueries({ queryKey: playlistKeys.tracks(playlistId) })
      void qc.invalidateQueries({ queryKey: playlistKeys.activity(playlistId) })
      void qc.invalidateQueries({ queryKey: playlistKeys.all() })
    },
  })
}
