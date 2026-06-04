import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys } from '@/lib/query/keys'

export type Playlist = components['schemas']['Playlist']
export type PlaylistDetail = components['schemas']['PlaylistDetail']
export type PaginatedPlaylistList = components['schemas']['PaginatedPlaylistList']
export type PlaylistTrack = components['schemas']['PlaylistTrack']
export type PaginatedPlaylistTrackList = components['schemas']['PaginatedPlaylistTrackList']
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
 * Paginated tracks of one playlist (25/page). Pages load on demand via
 * `fetchNextPage` so opening a long playlist doesn't pull every track at once.
 */
export function useInfinitePlaylistTracks(id: string) {
  return useInfiniteQuery({
    queryKey: playlistKeys.tracks(id),
    queryFn: ({ pageParam }) =>
      api<PaginatedPlaylistTrackList>(`/catalog/playlists/${id}/tracks/?page=${pageParam}`),
    initialPageParam: 1,
    // DRF returns a `next` URL while more pages remain; pages are sequential.
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
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
