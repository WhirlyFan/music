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
 *
 * Pattern mirrors the reference at
 * ~/usul-policy-research-app/frontend/lib/hooks/queries/query-keys.ts.
 */

export const sessionKeys = {
  all: () => ['session'] as const,
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
}

/**
 * The caller's listening room (room-of-one): now-playing + persisted queue.
 * `me()` is the single source of truth — every queue/playback mutation
 * invalidates it so the player + queue panel re-render from the server.
 */
export const roomKeys = {
  all: () => ['room'] as const,
  me: () => ['room', 'me'] as const,
}

/**
 * MFA surface: authenticator list + per-method enrollment data.
 *
 * The cascade is deliberate — `mfaKeys.all()` is the parent prefix used by
 * mutation `onSuccess` to invalidate the whole surface in one call. Individual
 * hooks read the specific entries below.
 */
/**
 * Ephemeral player UI state shared across components (e.g. the queue panel being
 * open) — a client-only cache key used as a tiny store, no fetcher. Lets the
 * player and the playlists search pill read one source of truth. See lib/query/ui.ts.
 */
export const searchKeys = {
  songs: (q: string) => ['search', 'songs', q] as const,
}

// Import result keyed by source URL — so /import?url=… is shareable + refresh-safe
// (cached per URL; only a hard refresh / first visit re-runs the ingest).
export const importKeys = {
  result: (url: string) => ['import', url] as const,
}

export const uiKeys = {
  // Search text per route path, so the persistent search pill and the page it
  // serves share one value (and each page keeps its own term).
  search: (path: string) => ['ui', 'search', path] as const,
}

export const mfaKeys = {
  all: () => ['mfa'] as const,
  authenticators: () => ['mfa', 'authenticators'] as const,
  totpSetup: () => ['mfa', 'totp-setup'] as const,
  recoveryCodes: () => ['mfa', 'recovery-codes'] as const,
}
