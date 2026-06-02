# music — data model

## Design principles
1. **Internal UUID = identity; external URL/ID = a versioned attribute.** External
   references (Apple URLs, Spotify URIs, YouTube video IDs, file uploads) are
   volatile, so we never key off them.
2. **History, not overwrite.** External references and playback sources are
   append-only with validity flags + timestamps, so URL/API churn, dead videos, and
   re-uploads never break identity, and any bad edit is revertible.
3. **ISRC is the stable cross-platform song key.** Both Spotify and Apple expose it;
   dedupe Tracks on `isrc`, falling back to a normalized `match_key`.
4. **Sources are data, not code** — enumerated in the `sources` table so new
   platforms / changed URL patterns / new ingestion methods need no schema change.
5. **Any source in → any playable source out.** Ingestion (Spotify, Apple, YouTube,
   file upload, …) normalizes to a `Track`; each Track resolves to one active
   `playback_source` (matched YouTube video, pasted YouTube video, or uploaded file).
   Corrections are global/canonical: `manual` beats `auto`/`direct`, sticky until the
   source dies — fully history-tracked & revertible.

Two layers: **Catalog/Identity** (stable, shared) and **Runtime/Social** (the live jam).

---

## Reference

### `sources` — every source we ingest from and/or play back from
| column | type | notes |
|--------|------|-------|
| id | smallserial PK | small stable id (lookup) |
| code | text unique | `SPOTIFY`, `APPLE_MUSIC`, `YOUTUBE`, `YOUTUBE_MUSIC`, `UPLOAD`, `DIRECT_URL` |
| name | text | display name |
| role | enum `catalog`\|`playback`\|`both` | catalog = ingest tracks FROM; playback = stream audio FROM |
| ingest_method | enum `api`\|`scrape`\|`yt_dlp`\|`upload`\|`none` | how we read/resolve it |
| url_patterns | jsonb | regexes to recognize/parse this source's URLs (editable as formats change) |
| base_url | text NULL | |
| is_active | bool | toggle a source without code changes |
| config | jsonb | per-source settings |
| created_at, updated_at | timestamptz | |

**Seed rows**
| code | role | ingest_method |
|------|------|---------------|
| SPOTIFY | catalog | api |
| APPLE_MUSIC | catalog | scrape |
| YOUTUBE | both | yt_dlp |
| YOUTUBE_MUSIC | both | yt_dlp |
| UPLOAD | both | upload |
| DIRECT_URL | both | none |

---

## Catalog / identity

### `tracks` — canonical song (platform-agnostic)
| column | type | notes |
|--------|------|-------|
| id | uuid PK | stable identity |
| isrc | text NULL, idx | stable cross-platform recording id |
| match_key | text idx | normalized `"title|artist|±dur"` dedupe fallback |
| title, primary_artist | text | |
| duration_ms | int NULL | |
| created_at, updated_at | timestamptz | |

### `source_links` — HISTORY of where a Track/Playlist was ingested from
| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| source_id | FK → sources | replaces a hardcoded platform enum |
| track_id | FK → tracks NULL | |
| playlist_id | FK → playlists NULL | |
| kind | enum `track`\|`album`\|`playlist`\|`video`\|`file` | |
| external_id | text | spotify uri / apple id / youtube videoId / upload sha256 |
| url | text NULL | raw URL exactly as seen (format may change → new row) |
| is_active | bool | |
| first_seen_at, last_verified_at, invalidated_at | timestamptz | |
| raw | jsonb | parsed snapshot |
| | | unique(source_id, external_id, kind) |

### `playback_sources` — every playable rendition of a Track (generalizes "youtube match")
| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| track_id | FK → tracks | |
| source_id | FK → sources | `YOUTUBE` / `YOUTUBE_MUSIC` / `UPLOAD` / `DIRECT_URL` |
| locator_kind | enum `video_id`\|`storage_key`\|`url` | how to interpret `locator` |
| locator | text | youtube videoId, object-storage key, or URL |
| upload_id | FK → uploads NULL | set when `locator_kind=storage_key` |
| title, uploader | text NULL | the rendition's own metadata |
| duration_ms | int NULL | |
| origin | enum `matched_auto`\|`matched_manual`\|`direct` | direct = pasted YouTube / upload (no search) |
| confidence | float NULL | matched only |
| duration_delta_ms | int NULL | matched only — vs `tracks.duration_ms` (±3s check) |
| status | enum `active`\|`candidate`\|`dead`\|`replaced`\|`rejected` | |
| selected_by | FK → user NULL | who corrected it |
| created_at, last_checked_at | timestamptz | |
| | | partial unique: one `active` per `track_id` |

**Correction / swap flow:** insert new `status=active` row (origin `matched_manual` or `direct`); demote old active → `replaced`. `manual` always wins over `auto`/`direct`; auto re-resolution only runs when the active source is `dead`. A correction can swap source *type* too (e.g., YouTube → uploaded file).

### `uploads` — user-uploaded audio files (object storage)
| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| uploaded_by | FK → user | |
| storage_key | text | key in R2/S3 (the `AWS_S3_*` secrets in Doppler) |
| original_filename, content_type | text | |
| size_bytes | bigint | |
| duration_ms | int NULL | from ID3/audio tags (e.g. mutagen) |
| sha256 | text unique idx | dedupe identical files |
| status | enum `pending`\|`ready`\|`failed` | upload + tag-extraction lifecycle |
| created_at | timestamptz | |

Uploaded files live in object storage and are streamed to the room via short-lived
**signed URLs** (browser ↔ bucket), same as the YouTube proxy path.

---

## Playlists
- **`playlists`**: id uuid PK · title · description · created_by FK user · is_public · created_at · updated_at
- **`playlist_tracks`**: id · playlist_id FK · track_id FK · position int · added_by FK user · added_at — unique(playlist_id, position)
- **`playlist_imports`**: id · playlist_id FK · source_id FK · source_url · source_external_id · imported_by FK user · imported_at · track_count · status

---

## Runtime / social  (the Jam layer — sketch, build after catalog)
- **`rooms`**: id uuid PK · code · host_id FK user · playlist_id FK NULL · is_active · created_at
- **`room_members`**: room_id FK · user_id FK · role `host`\|`guest` · joined_at — unique(room_id, user_id)
- **`room_queue`**: id · room_id FK · track_id FK · position int · added_by FK user · played bool
- **`playback_state`**: room_id FK (1:1) · current_track_id FK · position_ms · is_playing · updated_at (server timestamp drives client drift-correction)

---

## Key flows (any source in → playable out)
| Ingestion | Track creation | Playback source |
|-----------|----------------|-----------------|
| **Spotify** playlist (API) | upsert tracks (dedupe ISRC) | resolve via yt-dlp → `playback_sources(YOUTUBE, matched_auto)` |
| **Apple** playlist (scrape) | upsert tracks | resolve via yt-dlp → matched_auto |
| **YouTube** paste (playlist/video) | one track per video | the video **is** the source → `playback_sources(YOUTUBE, direct)` (no search) |
| **File upload** | track from ID3 tags / user input | `uploads` row + `playback_sources(UPLOAD, direct, locator=storage_key)` |

- **Cache:** re-paste hits `source_links`; repeated song reuses its active `playback_sources` — no re-scrape / re-resolve.
- **Correct:** promote a candidate, paste a YouTube URL, or upload a file → new active `playback_sources` row; old → replaced (revertible).

## Playback strategy (decided 2026-06-02)
Requirement: **ad-free, audio-only** (video is a possible later add-on).
- **Primary playback = ad-free audio via `yt-dlp`, resolved + downloaded once per track into R2** (object storage), then streamed to clients via signed URLs. Removes ads, removes *ongoing* YouTube rate-limits (each track acquired once), and survives dead videos. Acquisition is **throttled + lazy** (background worker) to stay under YouTube's ~20–50/IP limit.
  - *Lighter-touch alternative:* transient server proxy of the `yt-dlp` audio URL — no stored copy (smaller copyright footprint) but re-resolves often + ongoing YouTube dependency.
- **Video = free future toggle:** `playback_sources` always stores `video_id`, so a later "video mode" just swaps the player to the YouTube **IFrame embed** (visible + ads — the ToS-compliant path), no schema change.
- **Posture:** the `yt-dlp` audio path is copyright/ToS-gray — appropriate for a **private, invite-only, non-commercial** friends app, *not* public/commercial use with copyrighted tracks. (IFrame video mode is the legitimate path if it ever goes public; user-uploads + CC/owned content is the safe path.)

> ⚠️ Copyright note: storing + rebroadcasting copyrighted audio carries the highest exposure (reproduction + distribution). "Non-commercial / friends" lowers practical enforcement risk but is **not** a legal exemption. Keep it genuinely private; lean on user-uploads + CC/owned content if it ever opens up.
