import { keepPreviousData, skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api, engine, IS_DESKTOP } from '@/lib/api/client'
import type {
  ImportResult,
  PaginatedPlaylistList,
  PaginatedPlaylistTrackList,
  PlaylistDetail,
  Track,
} from '@/lib/api/models'
import { importKeys, playlistKeys, searchKeys } from '@/lib/hooks/keys'

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
 * prior results on screen while a new term resolves; idle for an empty query.
 */
// Shared query options so the home OmniBox can PREFETCH (and thus validate) a
// search/import on the same cache key the destination page reads — letting it only
// navigate once the request actually succeeds, instead of landing on a broken page.
export const searchQuery = (q: string) => ({
  queryKey: searchKeys.songs(q),
  queryFn: () => api<Track[]>(`/catalog/tracks/search/?q=${encodeURIComponent(q)}`),
  staleTime: 5 * 60 * 1000,
  retry: false, // fail fast so a failed search doesn't hang the home button on retries
})

// Desktop runs the YouTube extraction on the user's own IP (the local engine's
// /yt/import, which then hands the metadata to the cloud to persist); a non-YouTube
// URL is forwarded for the cloud to ingest via its official API. Web posts to the
// cloud directly. Both return the same ImportResult.
export const importQuery = (url: string) => ({
  queryKey: importKeys.result(url),
  queryFn: () =>
    IS_DESKTOP
      ? engine<ImportResult>('/yt/import', { url })
      : api<ImportResult>('/catalog/ingest/', { method: 'POST', body: { url } }),
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
})

export function useSongSearch(query: string) {
  const q = query.trim()
  const opts = searchQuery(q)
  return useQuery({
    ...opts,
    queryFn: q ? opts.queryFn : skipToken,
    placeholderData: keepPreviousData,
  })
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: playlistKeys.detail(id),
    queryFn: id ? () => api<PlaylistDetail>(`/catalog/playlists/${id}/`) : skipToken,
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
    queryFn: id
      ? ({ pageParam }) =>
          api<PaginatedPlaylistTrackList>(
            `/catalog/playlists/${id}/tracks/?page=${pageParam}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
          )
      : skipToken,
    initialPageParam: 1,
    // DRF returns a `next` URL while more pages remain; pages are sequential.
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  })
}

/**
 * Import a pasted Spotify / Apple Music / YouTube URL → loose catalog tracks (no
 * playlist created). Modeled as a query keyed by the URL so `/import?url=…` is a real,
 * shareable, refresh-safe navigation step — cached per URL, so only a hard refresh or
 * first visit re-runs the ingest. The result feeds play / queue / save-as-playlist.
 */
export function useImport(url: string) {
  const opts = importQuery(url)
  return useQuery({ ...opts, queryFn: url ? opts.queryFn : skipToken })
}
