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
2. **Two layers, Spotify's model** *(as built)*. A room has a **context** (the album/playlist/song you play *from*) and a separate **user queue** (explicit "Add to queue"). The context is a **stable list + a position pointer** (`context_pos`) — it is **not** consumed: Next/Previous and clicking just move the pointer, so skipped tracks stay in the list (reachable via **Previous**) and are never shown as "played". The user queue is ephemeral, plays *before* the context resumes, and **survives a context change**. Clicking a song **inside a playlist** plays the whole playlist *from that track* (`play-playlist` with a start track), so it continues into the rest; clicking a one-off single song (e.g. an import result) is **play-now** (context becomes that one song). **Play playlist / Play all** load a list as the context from the top. *(Earlier attempts — a consumed two-layer, then a single flat queue — both felt wrong: the flat queue dumped skipped songs into a fake "recently played" and shrank destructively. The stable-context pointer is the fix.)*
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

QueueItem                    ← one entry, in one of two layers
  id (uuid), room FK
  track           FK Track
  kind            context | queue   (context = stable source list; queue = explicit add)
  position        int               (orders within its layer)
  added_by        FK user (attribution: "who queued this")
  created_at
  -- CONTEXT items are NOT deleted as they play (the pointer moves; skipped tracks stay).
  -- QUEUE items are ephemeral: play before the context resumes, deleted once consumed.

PlaybackState                ← now-playing head for a room (server = clock authority)
  room            FK (1:1)
  current_item    FK QueueItem (nullable)   (the playing row — context or queue)
  context_pos     int (nullable)            (pointer into the stable context list)
  context_label   str                       ("Next from: <label>")
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
| **Play song (click a track)** | `play-now {track_id}` | context becomes that one song + play; does **not** load the surrounding list |
| **Play all / Play playlist** | `play {track_ids, start_index, label}` / `play-playlist {playlist_id, start_track_id?}` | load the list as the **context** — from `start_track_id` (a clicked row) or the top; preserves the user queue |
| **Add to queue / Play next** | `queue {track_ids, play_next}` | append (or insert at head of) the **user queue**; starts playback if idle |
| **Next / Previous** | `next` / `previous` | next: queue first, then resume context; previous: walk the context back (UI restarts if >3s in) |
| **Click a row** | `jump {item_id}` | context row → move the pointer there (skipped tracks kept); queue row → play it, consuming the ones above |
| **Remove item** | `remove {item_id}` | drop a single item from either layer |
| **Shuffle** | `shuffle` | randomize the upcoming **context** (re-call to reshuffle) |
| **Save queue as playlist** | `save-as-playlist {title}` | owned `Playlist` from now-playing + queue + remaining context, in order |
| **Clear** | `clear` | empty both layers, stop |
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
- **Phase A — Session + queue (solo, no WS) ✅ shipped:** `Room`/`QueueItem`/`PlaybackState`; **decoupled ingest** (ingest → tracks + import result); **context + user queue** (stable context with a position pointer; ephemeral queue) with play-now / play / play-playlist / queue / next / previous / jump / remove / shuffle / save-as-playlist; a real **player** (transport controls + seek bar) + interactive queue panel ("Next in queue" / "Next from: …"); **ad-free `<audio>` playback** via the yt-dlp stream proxy (lazy match-on-play, no media stored — only `video_id`). *Fixed the "one song = one playlist" wart, the flat-queue grow bug, and the fake "recently played"; Previous walks the context.*
- **Phase B — Real-time Jam:** Channels + Redis; share/join via code; shared queue + synced playback + drift correction; host controls + attribution.
- **Phase C — Library polish:** liked tracks, playlist management/ownership UI, collaborators.

## Open decisions (confirm before building)
1. **Solo = room-of-one** (uniform model) vs. a separate lightweight "personal playback" + promote-to-room. *(Recommend: room-of-one — one code path.)*
2. **WS stack = Django Channels + Redis** (adds a Redis service). *(Recommend yes; ASGI already configured.)*
3. **Ingest returns tracks, never a playlist** — confirm the decoupling (migrates the current `/playlists/ingest` behavior).
4. Start with **Phase A** (solo queue) before the WS layer? *(Recommend yes — de-risks the model before real-time.)*
