/**
 * Centralized TanStack Query keys.
 *
 * One namespace per domain (`sessionKeys`, `playlistKeys`, …). Each namespace
 * has an `all()` entry returning the broadest prefix, plus specific entries
 * scoped beneath it. Mutations invalidate the narrowest matching prefix —
 * broad invalidation goes through `all()`, surgical invalidation through
 * `list()` / `detail()` / etc.
 *
 * Every entry is a function (even no-arg ones) for a uniform call shape
 * at the use site: `useQuery({ queryKey: playlistKeys.list() })`.
 */

export const sessionKeys = {
  all: () => ['session'] as const,
}

/** allauth public config (configured social providers, etc.). */
export const authKeys = {
  config: () => ['auth', 'config'] as const,
  providers: () => ['auth', 'providers'] as const,
}

/**
 * User's email addresses (verified flag + primary flag). Source of truth
 * for the verified-email gate — allauth's session endpoint doesn't expose
 * verification status, so we read from `/account/email` instead.
 */
export const emailKeys = {
  all: () => ['emails'] as const,
  list: () => ['emails', 'list'] as const,
}

export const playlistKeys = {
  all: () => ['playlists'] as const,
  // `search` is part of the key so each query string is its own infinite list.
  list: (search = '') => ['playlists', 'list', search] as const,
  detail: (id: string) => ['playlists', 'detail', id] as const,
  // Paginated tracks of one playlist (useInfiniteQuery) — the query appends the
  // search term as a final segment, so this 4-element prefix invalidates every
  // search variant. Nested under detail so invalidating the playlist refreshes
  // both its metadata and its track pages.
  tracks: (id: string) => ['playlists', 'detail', id, 'tracks'] as const,
  // Collaborators + edit history of one playlist (nested under detail).
  collaborators: (id: string) => ['playlists', 'detail', id, 'collaborators'] as const,
  activity: (id: string) => ['playlists', 'detail', id, 'activity'] as const,
}

/**
 * The caller's listening room (room-of-one): now-playing + persisted queue.
 * `me()` is the single source of truth — every queue/playback mutation
 * invalidates/seeds it so the player + queue panel re-render from the server.
 */
export const roomKeys = {
  all: () => ['room'] as const,
  me: () => ['room', 'me'] as const,
  members: () => ['room', 'members'] as const,
  context: () => ['room', 'context'] as const,
}

export const searchKeys = {
  songs: (q: string) => ['search', 'songs', q] as const,
}

export const notificationKeys = {
  all: () => ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unread: () => ['notifications', 'unread'] as const,
}

export const friendKeys = {
  all: () => ['friends'] as const,
  list: () => ['friends', 'list'] as const,
  requests: () => ['friends', 'requests'] as const,
  // User search for adding friends — `q` is part of the key so each term caches.
  search: (q: string) => ['friends', 'search', q] as const,
}

// Import result keyed by source URL — so /import?url=… is shareable + refresh-safe
// (cached per URL; only a hard refresh / first visit re-runs the ingest).
export const importKeys = {
  result: (url: string) => ['import', url] as const,
}

/**
 * Ephemeral client-only UI state shared across components, used as a tiny store
 * (no fetcher). Today: per-route search text, so the persistent search pill and
 * the page it serves read one value (each page keeps its own term). See lib/hooks/queries/ui.ts.
 */
export const uiKeys = {
  search: (path: string) => ['ui', 'search', path] as const,
}

/**
 * MFA surface: authenticator list + per-method enrollment data. `mfaKeys.all()`
 * is the parent prefix used by mutation `onSuccess` to invalidate the whole
 * surface in one call; individual hooks read the specific entries below.
 */
export const mfaKeys = {
  all: () => ['mfa'] as const,
  authenticators: () => ['mfa', 'authenticators'] as const,
  totpSetup: () => ['mfa', 'totp-setup'] as const,
  recoveryCodes: () => ['mfa', 'recovery-codes'] as const,
}
