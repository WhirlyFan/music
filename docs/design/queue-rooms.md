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
2. **Single queue + a cursor** *(as built — the model most players use, e.g. Feishin)*. A room is one ordered list with a `current` pointer. Items aren't deleted as they play: those **behind** the cursor are history (so **Previous** works), those **ahead** are up-next. Clicking a song is **play-now** — it inserts that *one* song at the cursor and plays it; it does **not** drag in the surrounding list. Only **Play playlist / Play all** replace the queue with a list. *(We previously tried a two-layer context+queue; it was the wrong call — the single list gives Previous for free and matches "click = just that song".)*
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

QueueItem                    ← one entry in the room's single ordered queue
  id (uuid), room FK
  track           FK Track
  position        int               (orders the whole list; history < cursor < up-next)
  added_by        FK user (attribution: "who queued this")
  created_at
  -- items are NOT deleted as they play; the cursor moves. history = behind, up-next = ahead.

PlaybackState                ← now-playing head for a room (server = clock authority)
  room            FK (1:1)
  current_item    FK QueueItem (nullable)   (the cursor; Next/Previous move it)
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
| **Play song (click a track)** | `play-now {track_id}` | insert that one song at the cursor + play; does **not** load the surrounding list |
| **Play all / Play playlist** | `play {track_ids, start_index}` / `play-playlist {playlist_id}` | **replace** the queue with the list, play from the top |
| **Add to queue / Play next** | `queue {track_ids, play_next}` | append (or insert after current); starts playback if idle |
| **Next / Previous** | `next` / `previous` | move the cursor forward / back (Previous: UI restarts if >3s in) |
| **Click a queue row** | `jump {item_id}` | play that item now (works for history or up-next) |
| **Remove item** | `remove {item_id}` | drop a single queue item |
| **Shuffle** | `shuffle` | randomize the up-next items (re-call to reshuffle) |
| **Save queue as playlist** | `save-as-playlist {title}` | owned `Playlist` from the whole queue, in order |
| **Clear** | `clear` | empty the queue, stop |
| **Reorder (drag), repeat modes** | *(next)* | drag-to-reorder + off/all/one repeat (host-gated in shared sessions) |

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
- **Phase A — Session + queue (solo, no WS) ✅ shipped:** `Room`/`QueueItem`/`PlaybackState`; **decoupled ingest** (ingest → tracks + import result); **single queue + cursor** with play-now / play / play-playlist / queue / next / previous / jump / remove / shuffle / save-as-playlist; a real **player** (transport controls + seek bar) + interactive queue panel (Up next / Recently played); **ad-free `<audio>` playback** via the yt-dlp stream proxy (lazy match-on-play, no media stored — only `video_id`). *Fixed the "one song = one playlist" wart and the flat-queue grow bug; Previous comes free from the cursor.*
- **Phase B — Real-time Jam:** Channels + Redis; share/join via code; shared queue + synced playback + drift correction; host controls + attribution.
- **Phase C — Library polish:** liked tracks, playlist management/ownership UI, collaborators.

## Open decisions (confirm before building)
1. **Solo = room-of-one** (uniform model) vs. a separate lightweight "personal playback" + promote-to-room. *(Recommend: room-of-one — one code path.)*
2. **WS stack = Django Channels + Redis** (adds a Redis service). *(Recommend yes; ASGI already configured.)*
3. **Ingest returns tracks, never a playlist** — confirm the decoupling (migrates the current `/playlists/ingest` behavior).
4. Start with **Phase A** (solo queue) before the WS layer? *(Recommend yes — de-risks the model before real-time.)*
