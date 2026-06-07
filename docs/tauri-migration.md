# Migration: shared-cloud web app → Tauri desktop app + thin cloud

**Decision (2026-06-06):** Ship WhirlyFan as a **Tauri v2 desktop app** that does *all*
YouTube I/O locally (from each user's own residential IP), while a **thin Render
cloud** (Postgres + Django REST + Channels WS) handles only metadata, social, and
jam coordination. **Desktop-only** for now (no web/mobile fallback).

## Why

The cloud's pain is entirely "a datacenter talking to YouTube on weak CPU":
the bot wall, the 150s cold resolve, the mid-song jump, the Tailscale residential-IP
hack, the OOM from running `tailscaled` in a 512MB container. Move YouTube I/O onto
the listener's machine and **every one of those problems disappears** — each user
already has a residential IP, a real CPU, and (bonus) their own browser cookies.

The seam is already clean in the code: a jam is coordinated purely by
`video_id + position_ms + is_playing + playing_since + generation`
(`backend/apps/rooms/serializers.py:29-146`); the server never needs audio bytes.
`/stream/` is a transparent proxy (`backend/apps/catalog/views.py:499-559`). So this
is a *relocation of YouTube I/O*, not a domain rewrite.

## Target architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Tauri desktop app (per user)│  HTTPS  │  Render cloud (thin)         │
│                              │  + WSS  │                              │
│  React UI (reused frontend)  │◄───────►│  Django REST  (metadata)     │
│        │                     │         │  Channels WS  (room.update)  │
│        │ http://127.0.0.1    │         │  Postgres     (source truth) │
│        ▼                     │         │                              │
│  Local engine (Rust/axum)    │         │  NEVER talks to YouTube      │
│   • /stream/{vid}  (proxy+   │         └──────────────────────────────┘
│      Range + disk cache)     │              ▲
│   • /search, /ingest         │              │ posts client-extracted
│   • sidecars: yt-dlp, deno   │              │ video_ids + metadata
│        │                     │              │
│        ▼                     │              │
│   YouTube  ◄──── user's residential IP ─────┘
└─────────────────────────────┘
```

- **Cloud keeps:** all `rooms/*` endpoints (`backend/apps/rooms/views.py` — all
  audio-free), playlist/track *metadata* CRUD, friends/social, the three WS channels
  (rooms, playlists, notifications), Spotify/Apple ingest (their APIs, no bot wall).
- **Cloud loses:** YouTube `resolve_audio` (stream), YouTube `match` search, YouTube
  flat `ingest`, the `/stream/` proxy + disk cache, `yt-dlp`/`deno` in the image,
  Tailscale block, `home-proxy/`, and the `TS_*` / `YOUTUBE_PROXY` / `YOUTUBE_COOKIES`
  secrets.
- **Client gains:** a local axum HTTP server that ports `backend/apps/catalog/streaming.py`
  (resolve → proxy → Range → LRU disk cache) plus YouTube search/flat-extract, with
  `yt-dlp` + `deno` shipped as Tauri sidecars. `--cookies-from-browser` clears the
  account wall using the user's *own* cookies.

## The one frontend line that changes for playback

`frontend/src/components/player/now-playing-bar.tsx:121`
```ts
// before:
const audioSrc = matched && track ? `${API_BASE}/catalog/tracks/${track.id}/stream/` : null
// after (desktop): point at the local engine, keyed by video_id
const audioSrc = matched && videoId ? `${LOCAL_ENGINE}/stream/${videoId}` : null
```
Range/seek keep working — the frontend already speaks "GET stream endpoint with Range,"
and the local axum server answers 200/206 exactly like `streaming.serve_cached`
(`backend/apps/catalog/streaming.py:254-271`).

## API contract changes (Phase 3 — cloud stops touching YouTube)

| Today (server does YouTube I/O)                          | After (client does it, cloud persists)                                   |
|----------------------------------------------------------|---------------------------------------------------------------------------|
| `POST /catalog/tracks/{id}/match/` runs yt-dlp search    | Client searches via local engine → `POST /catalog/tracks/{id}/playback-source/` with `{video_id, confidence, origin}` to set the ACTIVE `PlaybackSource` |
| `POST /catalog/ingest/` runs yt-dlp flat-extract (YT)    | Client flat-extracts via local engine → posts `{kind, external_id, title, cover, tracks:[{video_id,title,uploader,duration_sec}]}`; server upserts |
| `GET /catalog/tracks/{id}/stream/` proxies bytes         | Removed (or 410). Desktop uses local `/stream/{video_id}`                 |
| `GET /catalog/tracks/search/` (Spotify API)              | **Unchanged** — no bot wall                                               |
| Spotify/Apple ingest                                     | **Unchanged** — their APIs, server-side                                   |

`PlaybackSource` already models exactly this (`backend/apps/catalog/models.py:221-279`:
`locator_kind=VIDEO_ID`, `status`, `origin`, `confidence`) — we just set it from
client-supplied data instead of a server search.

## Rust backend responsibilities (taking advantage of Tauri)

Push as much as possible into Rust — it already holds the bytes, so it's the natural
home for caching and playback. Rust owns:

1. **YouTube orchestration** — spawn/lifecycle the `yt-dlp` + `deno` sidecars; resolve,
   search, flat-extract.
2. **Local HTTP engine** (axum on `127.0.0.1:<port>`) — see below.
3. **Audio decode + playback** (recommended end state) — `symphonia` (pure-Rust AAC/m4a
   decode, **no system codecs**) + `rodio`/`cpal` for output. This is what fixes Linux
   definitively (webkit2gtk's GStreamer AAC plugins are often missing) and gives identical
   behavior on all three OSes plus sample-accurate position for tighter jam sync. The
   webview becomes pure UI; play/pause/seek/volume are Tauri commands, position/buffering
   are events. Cost: re-feed the visualizer analyser by tapping samples in a custom rodio
   source → `rustfft` → emit bins to the webview.
   - *Lower-effort interim:* keep the webview `<audio>` element but have Rust decode
     m4a→PCM and serve a **WAV stream over loopback** — the webview plays PCM/WAV via
     GStreamer *base* plugins (far more reliably present than AAC), and the existing
     player + analyser stay untouched. Ship this first; graduate to native Rust playback.
4. **The cache (Redis stand-in) — the server caches ZERO YouTube state after migration.**
   The resolved googlevideo URL is **IP-locked**, so a shared server cache of it was never
   even valid cross-user; per-client local caching is strictly *more correct*. Two tiers:
   - **Resolved-URL cache** (the real "Redis"): URL string + headers per video, TTL ~1-4h
     (the URL expires anyway). In-memory `DashMap` with expiry; rebuilds for free on
     restart. Negligible size. Replaces the Django-cache `_URL_TTL=3600` entry in
     `backend/apps/catalog/streaming.py`.
   - **Audio-byte cache** (~3-5MB/song — the bloat risk): **hard byte ceiling + LRU
     eviction** by access time (as `streaming.py` does with `AUDIO_CACHE_MAX_BYTES`),
     stored in `dirs::cache_dir()` (OS-evictable, never backed up), with **single-flight**
     dedupe of concurrent resolves/downloads, a default cap (~1GB), and a settings
     "cache size + Clear cache" control. Plain files (Range-serve straight from a file)
     + an in-memory index rebuilt by scanning the dir on startup — no embedded DB.
5. **Keychain** — store the allauth session token (Tauri Stronghold/keychain).
6. **Prewarm** — background-resolve/cache upcoming jam tracks (replaces server prewarm).

> The cloud's **Channels layer** (WS `group_send`) is unrelated and may still want a
> backing store for multi-process — but all *YouTube* caching leaves the cloud.

## Local HTTP engine (axum on 127.0.0.1:<port>)

Near-literal port of `streaming.py`:
- `GET /stream/{video_id}` — resolve via `yt-dlp` sidecar (format `140/bestaudio[ext=m4a]`,
  progressive — **no transcode**), proxy upstream with Range support, fill the LRU disk
  cache (above). (If/when Rust owns playback, this can serve decoded PCM/WAV instead.)
- `POST /search?q=` — yt-dlp search → candidate list for `match`.
- `POST /ingest?url=` — yt-dlp `extract_flat` → track metadata for ingest.

Sidecars (Tauri `externalBin`, target-triple-suffixed): `yt-dlp`, `deno` (nsig solver).
No `ffmpeg` needed — `symphonia` handles decode in pure Rust.

## Auth on desktop — local reverse-proxy (IMPLEMENTED)

The webview loads from a custom origin, so it's cross-origin to api.whirlyfan.com and
the session-cookie + CSRF flow can't work directly (this caused a white-screen: every
guarded route's `beforeLoad` fetch failed → error path → a WebKit `SyntaxError` in the
error UI). Rather than rewrite the entire auth layer to token mode, the desktop app runs
a **local reverse-proxy** (`desktop/src-tauri/src/lib.rs`):

- A tiny axum server on `127.0.0.1:<port>` **serves the embedded SPA** (via `include_dir`)
  and the window points at it — so the app is plain same-origin HTTP.
- It **forwards `/api`, `/_allauth`, `/accounts`** to `api.whirlyfan.com` through a
  **`reqwest` cookie-jar client** (the server-side session lives in the jar).
- It sets a **trusted `Origin`/`Referer`** (`https://music.whirlyfan.com`) on every
  upstream request so Django's CSRF check passes, and **rewrites `Set-Cookie`** (drops
  `Domain`/`Secure`/`SameSite`) so `csrftoken` reaches the webview for `X-CSRFToken`.

Result: the existing cookie+CSRF auth works **unchanged**, with **zero backend changes**.
`frontend/.env.desktop` uses **relative** `VITE_API_BASE=/api/v1` (same-origin to the
proxy) and leaves `VITE_WS_BASE` unset. Verified end-to-end with headless WebKit: app
renders the welcome screen, proxied allauth returns real `401 + flows`, `csrftoken`
passes through.

**Google OAuth (IMPLEMENTED — session harvest):** the OAuth bounce (→ Google → prod
callback) can't complete through the proxy, so the desktop "Continue with Google" sends
the webview to the prod login (`frontend` checks `VITE_DESKTOP`); when it lands on an
authenticated prod page, `on_page_load` in `lib.rs` lifts the `sessionid` cookie into the
proxy jar (`cookies_for_url`) and navigates back to the local app — now authenticated.
Verified end-to-end. No OAuth reimplementation, no backend change; works for password
login on prod too.

Remaining: **WebSocket proxy** (currently `/ws` 503s — jams/notifications/playlist live
updates). This proxy is also the seam the Phase-B local audio engine plugs into.

## Phasing (each phase ships independently; PR-per-phase)

- **PR A — Tauri shell, zero backend change.** New `/desktop` package wrapping the
  built `frontend`, pointing at the *current* prod API + cloud `/stream/`. Proves
  packaging + webview + auth-in-desktop before anything else moves. → clickable mac build.
- **PR B — Local audio engine.** Sidecars + axum server + flip `audioSrc` to the local
  engine (behind a flag). Playback goes ad-free/fast/no-bot-wall; **jam sync unchanged**.
- **PR C — Client-side search/match/ingest** + the cloud contract changes above.
- **PR D — Teardown.** Delete Tailscale block (`backend/docker-entrypoint.sh:37-86`),
  `home-proxy/`, cloud `yt-dlp`/`deno`, `/stream/` endpoint, and the
  `TS_*`/`YOUTUBE_PROXY`/`YOUTUBE_COOKIES` secrets from `render.yaml` + Doppler `prd`.
- **PR E — Desktop auth** (loopback OAuth + keychain token).
- **PR F — Simplify synced-start.** `pending_start`/`on_audio_ready`/`prewarm`/`warm_video`
  (`backend/apps/rooms/services.py:59-308`, `backend/apps/catalog/streaming.py:133-200`)
  were slow-server workarounds; with fast local resolve, replace with a light client-ready
  barrier or seek-to-live for late joiners.
- **PR G — Distribution.** GitHub Actions matrix (mac/win/linux — can't cross-build a
  Windows installer from macOS), Tauri auto-updater, ad-hoc signing for friends/family.

## Risks to validate in week one

1. ~~Linux webview AAC/m4a playback~~ — **resolved by design:** Rust decodes/plays via
   `symphonia`+`rodio` (no webview codecs), or serves PCM/WAV over loopback as an interim.
   No longer a blocker.
2. **Sidecar packaging** per target triple (`yt-dlp`, `deno`). Unsigned/ad-hoc is fine —
   no Apple Developer account; friends/family approve the unsigned app once per OS
   (macOS right-click→Open, Windows SmartScreen "Run anyway", Linux none).
3. **Desktop OAuth** loopback flow with allauth headless — the meatiest piece.
4. **Heterogeneous jam readiness** — clients resolve independently; late/slow ones
   seek-to-live rather than blocking the room.

## What this deletes (the payoff)

`home-proxy/` · the `tailscaled` entrypoint block · exit-node ordering loop · DNS hack ·
OOM crash loop · datacenter bot wall · 150s cold resolve · mid-song jump · cloud egress
bandwidth · `TS_*`/`YOUTUBE_PROXY`/`YOUTUBE_COOKIES` secret management.
