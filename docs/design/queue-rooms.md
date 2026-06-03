# Design: playback queue, owned playlists, and real-time rooms

## Problem with today's model
- **Ingest auto-creates a `Playlist` per paste** — even a single song. Wrong: pasting/playing a one-off track should not mint a playlist.
- **No queue** — "now playing / up next" doesn't exist; we play a single `nowPlaying` videoId.
- **No real ownership** — playlists aren't intentionally owned/saved; they're a side effect of ingest.
- **No shared/real-time listening** — no rooms, no WebSocket sync.

## The four concepts (Spotify's separation, which we should mirror)
| Concept | What it is | Lifetime | Owner |
|---------|-----------|----------|-------|
| **Catalog** | `Track` / `Source` / `PlaybackSource` (shared, deduped) | permanent | nobody (shared) |
| **Library** | a user's **saved/created Playlists** (+ later: liked tracks) | permanent | a user |
| **Queue** | the ordered "up next" for a listening **session** | ephemeral (until "save as playlist") | a session |
| **Session / Jam** | a listening context — solo or shared — with a queue + now-playing + members | ephemeral | host |

**Key reframes:**
1. **Ingest ≠ playlist.** Ingesting a URL resolves **Track(s)** into the catalog and returns an *import result*. The user then chooses: **Play**, **Add to queue**, or **Save as playlist**. No playlist is created implicitly.
2. **Two layers, like Spotify** *(as built)*. A session has a **context** (the list you play *from* — album/playlist/import) and a separate **user queue** (explicit "Add to queue" / "Play next"). Up-next + advance order is **user queue first, then context**. Pressing **Play** on a track sets the context to its surrounding list starting at that track (the rest becomes up-next) — it does **not** grow a flat queue or create a playlist. The context shrinks as consumed and is replaced on the next Play; the user queue interleaves and **survives a context change**.
3. **Solo is a room of one.** Every user listens inside a **Session** (their private queue + now-playing). Starting a **Jam** just makes that session *shareable* (others join via link) — one code path, not two.
4. **Playlists are owned + intentional** — created explicitly or via **"Save queue as playlist."**

## Data model (additions / changes)
Keep the catalog as-is. Add the session/queue/room layer; make playlists owned.

```
Session (a.k.a. Room)        ← a listening context; solo or shared
  id (uuid), code (shareable, nullable until shared)
  host            FK user
  is_shared       bool       (false = private solo session)
  allow_guest_control bool   (host toggle: guests can control playback vs only add)
  is_active       bool
  created_at, updated_at

QueueItem                    ← one up-next entry, in one of two layers
  id (uuid), room FK
  track           FK Track
  kind            context | queue   (context = from the source list; queue = explicit add)
  position        int               (ordered within its kind)
  added_by        FK user (attribution: "who queued this")
  created_at
  -- consumed items are DELETED (they leave "up next"); context is replaced on a new Play,
  --    the user queue is preserved across context changes.

PlaybackState                ← now-playing head for a room (server = clock authority)
  room            FK (1:1)
  current_track   FK Track (nullable)   (a Track, not a QueueItem — consumed rows are deleted,
                                          so the head can't dangle; survives refresh)
  context_label   str                   ("Next from: <label>")
  position_ms     int
  is_playing      bool
  updated_at                 (server timestamp drives client drift-correction)

SessionMember                ← who's in a (shared) session
  session FK, user FK, role (host|guest), joined_at, last_seen
  unique(session, user)

Playlist (existing)          ← now strictly user-owned + intentional
  created_by REQUIRED (an owner), title, is_public, …
  (ingest NO LONGER creates these; only explicit create / "save queue as")
```
*(Later/optional: `SavedTrack` for "liked songs"; playlist collaborators.)*

## Playback verbs (the API surface)
*(As built — `POST /api/v1/rooms/…`)*

| Action | Endpoint | Effect |
|--------|----------|--------|
| **Play track / Play all** | `play {track_ids, start_index, label}` | set the **context** to the list at `start_index`; rest becomes up-next; preserves the user queue |
| **Play playlist** | `play-playlist {playlist_id}` | context = the playlist, from the top |
| **Add to queue / Play next** | `queue {track_ids, play_next}` | append to (or head of) the **user queue**; starts playback if idle |
| **Skip / track end** | `advance` | next track: user queue first, then context (consumed item removed) |
| **Save queue as playlist** | `save-as-playlist {title}` | owned `Playlist` from now-playing + queue + context, in play order |
| **Clear** | `clear` | empty both layers, stop |
| **Reorder / remove** | *(Phase B)* | edit queue (host-gated in shared sessions) |

## Real-time (the Jam) — architecture
- **Transport:** **Django Channels** over the **ASGI app we already have** (`config.asgi.application` is configured) + a **Redis channel layer** (add a `redis` service to compose).
- **Room group:** one Channels group per session; clients connect with the session `code`.
- **Event protocol** (client → server → broadcast to group):
  `join` / `leave`, `add_to_queue`, `remove`, `reorder`, `play`, `pause`, `seek`, `next` / `prev`, `track_changed`.
- **Sync:** server is the **clock authority** — it stores `current_item`, `position_ms`, `is_playing`, `updated_at`. On join/any event it broadcasts state; clients compute offset (`now − updated_at`) and `seekTo`; a periodic heartbeat does **drift correction** (re-seek if off by >~300 ms).
- **Each client plays the ad-free audio stream** for the current track's `video_id` (resolved on demand via yt-dlp and proxied by the backend — `GET /catalog/tracks/{id}/stream/`), driven by the synced events (set `src` + `seek` + play/pause on an `<audio>` element). WS carries *control*, not audio.
- **Host controls:** `allow_guest_control` toggle — guests can **always add to queue**; play/pause/seek/reorder gated by the flag. Host can remove members/items.
- **Attribution:** `QueueItem.added_by` → "added by Alice."

## Phasing (incremental, each shippable)
- **Phase A — Session + queue (solo, no WS) ✅ shipped:** `Room`/`QueueItem`/`PlaybackState`; **decoupled ingest** (ingest → tracks + import result); **two-layer** Play / Play-next / Add-to-queue / Play-playlist / Save-queue-as-playlist; persistent now-playing bar + queue panel; **ad-free `<audio>` playback** via the yt-dlp stream proxy (lazy match-on-play, no media stored — only `video_id`). *Fixed the "one song = one playlist" wart and the flat-queue grow bug.*
- **Phase B — Real-time Jam:** Channels + Redis; share/join via code; shared queue + synced playback + drift correction; host controls + attribution.
- **Phase C — Library polish:** liked tracks, playlist management/ownership UI, collaborators.

## Open decisions (confirm before building)
1. **Solo = room-of-one** (uniform model) vs. a separate lightweight "personal playback" + promote-to-room. *(Recommend: room-of-one — one code path.)*
2. **WS stack = Django Channels + Redis** (adds a Redis service). *(Recommend yes; ASGI already configured.)*
3. **Ingest returns tracks, never a playlist** — confirm the decoupling (migrates the current `/playlists/ingest` behavior).
4. Start with **Phase A** (solo queue) before the WS layer? *(Recommend yes — de-risks the model before real-time.)*
