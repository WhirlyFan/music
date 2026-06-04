import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { playlistKeys, roomKeys, searchKeys } from '@/lib/query/keys'

export type Playlist = components['schemas']['Playlist']
export type PlaylistDetail = components['schemas']['PlaylistDetail']
export type PaginatedPlaylistList = components['schemas']['PaginatedPlaylistList']
export type PlaylistTrack = components['schemas']['PlaylistTrack']
export type PaginatedPlaylistTrackList = components['schemas']['PaginatedPlaylistTrackList']
export type Track = components['schemas']['Track']
export type PlaybackSource = components['schemas']['PlaybackSource']
export type ImportResult = components['schemas']['ImportResult']
export type PlaylistUpdate = components['schemas']['PlaylistUpdate']

/**
 * Paginated playlists (25/page), with optional server-side search over playlist
 * titles (searching within a playlist's songs is the detail page's job). `search`
 * is part of the query key so each term is its own infinite list.
 */
export function useInfinitePlaylists(search = '') {
  const q = search.trim()
  return useInfiniteQuery({
    queryKey: playlistKeys.list(q),
    queryFn: ({ pageParam }) =>
      api<PaginatedPlaylistList>(
        `/catalog/playlists/?page=${pageParam}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    // Keep the prior results on screen while a new search resolves — the wall
    // fills the page, so flashing to a skeleton on every keystroke is jarring.
    placeholderData: keepPreviousData,
  })
}

/**
 * Global song search — finds songs on Spotify (relevance order) and returns them
 * as catalog Tracks ready to play (YouTube audio resolves lazily on play). Keeps
 * prior results on screen while a new term resolves; disabled for an empty query.
 */
export function useSongSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: searchKeys.songs(q),
    queryFn: () => api<Track[]>(`/catalog/tracks/search/?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
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
 * Paginated tracks of one playlist (25/page), with optional server-side search
 * over track title/artist. Pages load on demand via `fetchNextPage`; `search` is
 * part of the query key (each term its own list) and keeps prior results on
 * screen while a new term resolves, so typing doesn't flash the list empty.
 */
export function useInfinitePlaylistTracks(id: string, search = '') {
  const q = search.trim()
  return useInfiniteQuery({
    queryKey: [...playlistKeys.tracks(id), q],
    queryFn: ({ pageParam }) =>
      api<PaginatedPlaylistTrackList>(
        `/catalog/playlists/${id}/tracks/?page=${pageParam}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    initialPageParam: 1,
    // DRF returns a `next` URL while more pages remain; pages are sequential.
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
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
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: playlistKeys.all() })
      qc.invalidateQueries({ queryKey: playlistKeys.detail(args.id) })
    },
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
