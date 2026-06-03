import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys } from '@/lib/query/keys'

export type Playlist = components['schemas']['Playlist']
export type PlaylistDetail = components['schemas']['PlaylistDetail']
export type PaginatedPlaylistList = components['schemas']['PaginatedPlaylistList']
export type Track = components['schemas']['Track']
export type PlaybackSource = components['schemas']['PlaybackSource']
export type ImportResult = components['schemas']['ImportResult']

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

/**
 * Paste an Apple Music URL → loose catalog tracks (no playlist created).
 * The caller decides what to do with the result: play, queue, or save.
 */
export function useIngest() {
  return useMutation({
    mutationFn: (url: string) =>
      api<ImportResult>('/catalog/ingest/', { method: 'POST', body: { url } }),
  })
}

/** Create a named playlist from a set of tracks (e.g. saving an import). */
export function useCreatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { title: string; trackIds: string[]; artworkUrl?: string }) =>
      api<Playlist>('/catalog/playlists/', {
        method: 'POST',
        body: { title: args.title, track_ids: args.trackIds, artwork_url: args.artworkUrl ?? '' },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistKeys.list() }),
  })
}

/** Lazily resolve a single track's YouTube source (used right before play). */
export function useMatchTrack(playlistId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<PlaybackSource>(`/catalog/tracks/${trackId}/match/`, { method: 'POST' }),
    onSuccess: () => {
      // The room player reads each track's active_source — refresh it too.
      qc.invalidateQueries({ queryKey: roomKeys.all() })
      if (playlistId) qc.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) })
    },
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
      qc.invalidateQueries({ queryKey: roomKeys.all() })
      if (playlistId) qc.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) })
    },
  })
}
