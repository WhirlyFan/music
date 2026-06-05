/**
 * Domain type aliases over the generated OpenAPI schema (`./types`). A single import
 * site for the app's model types, decoupled from the query/mutation hook split — both
 * `hooks/queries/*` and `hooks/mutations/*` (and components) import their types here.
 */
import type { components } from '@/lib/api/types'

export type Track = components['schemas']['Track']
export type Playlist = components['schemas']['Playlist']
export type PlaylistDetail = components['schemas']['PlaylistDetail']
export type PlaylistTrack = components['schemas']['PlaylistTrack']
export type PaginatedPlaylistList = components['schemas']['PaginatedPlaylistList']
export type PaginatedPlaylistTrackList = components['schemas']['PaginatedPlaylistTrackList']
export type PlaybackSource = components['schemas']['PlaybackSource']
export type ImportResult = components['schemas']['ImportResult']
export type PlaylistUpdate = components['schemas']['PlaylistUpdate']
export type Room = components['schemas']['Room']
export type QueueItem = components['schemas']['QueueItem']
