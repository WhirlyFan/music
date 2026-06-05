import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type {
  PlaybackSource,
  Playlist,
  PlaylistDetail,
  PlaylistUpdate,
  Track,
} from '@/lib/api/models'
import { playlistKeys, roomKeys } from '@/lib/hooks/keys'

/** Create a named playlist from a set of tracks (e.g. saving an import).
 *  `sourcePlaylist` stamps the fork's origin so it can be refreshed from source. */
export function useCreatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      title: string
      trackIds: string[]
      artworkUrl?: string
      sourcePlaylist?: string | null
    }) =>
      api<Playlist>('/catalog/playlists/', {
        method: 'POST',
        body: {
          title: args.title,
          track_ids: args.trackIds,
          artwork_url: args.artworkUrl ?? '',
          source_playlist: args.sourcePlaylist ?? undefined,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}

/** Refresh an imported playlist from its source — mirrors the source's current tracks
 *  (discards manual edits). Only valid when the playlist has an origin. */
export function useRefreshPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<PlaylistDetail>(`/catalog/playlists/${id}/refresh/`, { method: 'POST' }),
    onSuccess: (data, id) => {
      qc.setQueryData(playlistKeys.detail(id), data) // endpoint returns the fresh detail — seed it
      qc.invalidateQueries({ queryKey: playlistKeys.tracks(id) }) // tracks aren't in the body
      qc.invalidateQueries({ queryKey: playlistKeys.list() })
    },
  })
}

/** Lazily resolve a single track's YouTube source (used right before play). */
export function useMatchTrack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<PlaybackSource>(`/catalog/tracks/${trackId}/match/`, { method: 'POST' }),
    // `match/` returns only the PlaybackSource; the room embeds active_source → refetch it.
    onSuccess: () => qc.invalidateQueries({ queryKey: roomKeys.all() }),
  })
}

/** Re-resolve a track's cover from its origin (Spotify/Apple → YouTube fallback).
 *  Used to self-heal a broken cover and to retry a YouTube-fallback cover. */
export function useRefreshArtwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<Track>(`/catalog/tracks/${trackId}/refresh-artwork/`, { method: 'POST' }),
    onSuccess: () => {
      // The cover shows in the player, playlist list + detail — refresh them all.
      qc.invalidateQueries({ queryKey: roomKeys.all() })
      qc.invalidateQueries({ queryKey: playlistKeys.all() })
    },
  })
}

/** Rename / re-describe / set visibility of a playlist (PATCH). */
export function useUpdatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: string; title?: string; description?: string; isPublic?: boolean }) =>
      api<PlaylistUpdate>(`/catalog/playlists/${args.id}/`, {
        method: 'PATCH',
        // Undefined fields are dropped by JSON.stringify → a true partial update.
        body: { title: args.title, description: args.description, is_public: args.isPublic },
      }),
    // playlistKeys.all() is the broad prefix — it already covers detail(id) + list.
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.all() }),
  })
}

/** Delete a playlist. The global Track rows it referenced are preserved server-side. */
export function useDeletePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/catalog/playlists/${id}/`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.all() }),
  })
}

/** Remove one track from a playlist (the track itself stays in the catalog). */
export function useRemoveTrackFromPlaylist(playlistId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api(`/catalog/playlists/${playlistId}/remove-track/`, {
        method: 'POST',
        body: { track_id: trackId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistKeys.tracks(playlistId) })
      qc.invalidateQueries({ queryKey: playlistKeys.all() })
    },
  })
}

/** Move a track to an absolute position within a playlist. */
export function useReorderPlaylistTrack(playlistId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { trackId: string; position: number }) =>
      api(`/catalog/playlists/${playlistId}/reorder/`, {
        method: 'POST',
        body: { track_id: args.trackId, position: args.position },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.tracks(playlistId) }),
  })
}
