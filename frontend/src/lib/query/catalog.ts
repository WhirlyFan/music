import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys } from '@/lib/query/keys'

export type Playlist = components['schemas']['Playlist']
export type PlaylistDetail = components['schemas']['PlaylistDetail']
export type PaginatedPlaylistList = components['schemas']['PaginatedPlaylistList']
export type Track = components['schemas']['Track']
export type PlaybackSource = components['schemas']['PlaybackSource']
type MatchResult = components['schemas']['MatchResult']

export function usePlaylists() {
  return useQuery({
    queryKey: playlistKeys.list(),
    queryFn: () => api<PaginatedPlaylistList>('/catalog/playlists/'),
  })
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: playlistKeys.detail(id),
    queryFn: () => api<PlaylistDetail>(`/catalog/playlists/${id}/`),
    enabled: Boolean(id),
  })
}

/** Paste an Apple Music URL → ingest into the catalog. */
export function useIngestPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) =>
      api<PlaylistDetail>('/catalog/playlists/ingest/', { method: 'POST', body: { url } }),
    onSuccess: (playlist) => {
      qc.setQueryData(playlistKeys.detail(playlist.id), playlist)
      qc.invalidateQueries({ queryKey: playlistKeys.list() })
    },
  })
}

/** Resolve YouTube playback sources for a playlist's unmatched tracks. */
export function useMatchPlaylist(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<MatchResult>(`/catalog/playlists/${id}/match/`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.detail(id) }),
  })
}

/** Correct a track's active source — paste a video id or promote a candidate. */
export function useSetSource(playlistId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { trackId: string; videoId?: string; playbackSourceId?: string }) =>
      api<PlaybackSource>(`/catalog/tracks/${args.trackId}/set-source/`, {
        method: 'POST',
        body: { video_id: args.videoId, playback_source_id: args.playbackSourceId },
      }),
    onSuccess: () => {
      if (playlistId) qc.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) })
    },
  })
}
