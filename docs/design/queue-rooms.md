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
2. **Play = enqueue.** Pressing Play on a track adds it to the session queue and starts it; it does not create a playlist. "Play next" inserts after current; "Add to queue" appends; "Play playlist/album" loads all its tracks into the queue.
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

QueueItem                    ← the ordered "up next" for a session
  id (uuid), session FK
  track           FK Track
  position        int
  added_by        FK user (attribution: "who queued this")
  played          bool
  created_at

PlaybackState                ← now-playing head for a session (server = clock authority)
  session         FK (1:1)
  current_item    FK QueueItem (nullable)
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
| Action | Effect on the session queue |
|--------|-----------------------------|
| **Play track** | enqueue + jump to it (becomes now-playing) |
| **Play next** | insert after current item |
| **Add to queue** | append |
| **Play playlist/album** | replace (or append) queue with its tracks, start at first |
| **Save queue as playlist** | create an owned `Playlist` from current queue items |
| **Reorder / remove** | edit queue (host-gated in shared sessions) |

## Real-time (the Jam) — architecture
- **Transport:** **Django Channels** over the **ASGI app we already have** (`config.asgi.application` is configured) + a **Redis channel layer** (add a `redis` service to compose).
- **Room group:** one Channels group per session; clients connect with the session `code`.
- **Event protocol** (client → server → broadcast to group):
  `join` / `leave`, `add_to_queue`, `remove`, `reorder`, `play`, `pause`, `seek`, `next` / `prev`, `track_changed`.
- **Sync:** server is the **clock authority** — it stores `current_item`, `position_ms`, `is_playing`, `updated_at`. On join/any event it broadcasts state; clients compute offset (`now − updated_at`) and `seekTo`; a periodic heartbeat does **drift correction** (re-seek if off by >~300 ms).
- **Each client plays its own YouTube IFrame** for the current track's `video_id`, driven by the synced events (`loadVideoById` + `seekTo` + `playVideo/pauseVideo`). WS carries *control*, not audio — matches our IFrame-playback decision (ad-free audio = the separate Phase-3 question).
- **Host controls:** `allow_guest_control` toggle — guests can **always add to queue**; play/pause/seek/reorder gated by the flag. Host can remove members/items.
- **Attribution:** `QueueItem.added_by` → "added by Alice."

## Phasing (incremental, each shippable)
- **Phase A — Session + queue (solo, no WS):** add `Session`/`QueueItem`/`PlaybackState`; **decouple ingest from playlist** (ingest → tracks + import result); implement Play / Play-next / Add-to-queue / Play-playlist / Save-queue-as-playlist; a Queue panel UI. *Fixes the "one song = one playlist" wart and gives a real queue.*
- **Phase B — Real-time Jam:** Channels + Redis; share/join via code; shared queue + synced playback + drift correction; host controls + attribution.
- **Phase C — Library polish:** liked tracks, playlist management/ownership UI, collaborators.

## Open decisions (confirm before building)
1. **Solo = room-of-one** (uniform model) vs. a separate lightweight "personal playback" + promote-to-room. *(Recommend: room-of-one — one code path.)*
2. **WS stack = Django Channels + Redis** (adds a Redis service). *(Recommend yes; ASGI already configured.)*
3. **Ingest returns tracks, never a playlist** — confirm the decoupling (migrates the current `/playlists/ingest` behavior).
4. Start with **Phase A** (solo queue) before the WS layer? *(Recommend yes — de-risks the model before real-time.)*
