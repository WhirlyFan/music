# desktop — music Tauri app

The **music** desktop app (Tauri v2). It wraps the `frontend` SPA in a native window
and runs a local Rust engine that resolves/streams YouTube on the user's own machine
(bundled `yt-dlp`) and proxies metadata/jam-sync to the cloud backend.

## Layout
- `package.json` — just the Tauri CLI + `dev`/`build` scripts.
- `src-tauri/` — the Rust app: `tauri.conf.json`, `Cargo.toml`, `src/lib.rs`, icons.
  - Bundle id `com.whirlyfan.desktop`, window 1280×800 (min 900×600).
  - `frontendDist` → `../../frontend/dist`; `beforeBuildCommand` builds the frontend
    with `--mode desktop` (see below). Frontend assets are embedded into the Rust
    binary at compile time (not loose files), so the `.app` is self-contained.

## Prerequisites
- Rust toolchain (`rustup`, stable). macOS also needs the Xcode Command Line Tools.
- Node + `pnpm` (the frontend's package manager).

## Run / build
```sh
cd desktop
pnpm install
pnpm dev      # tauri dev — runs the frontend dev server (local backend proxy) + hot reload
pnpm build    # tauri build — produces the release .app (and tries a .dmg, see caveat)
```
Release artifacts land in `src-tauri/target/release/bundle/`:
- `macos/music.app` — the launchable app (ad-hoc signed; runs on Apple Silicon
  with no Apple Developer account — friends/family right-click → Open the first time).

## Prod vs web build (the `--mode desktop` trick)
The web build (Render) uses `VITE_API_BASE=/api/v1` (relative) and reaches the backend
through Render's same-origin proxy. The desktop app loads from `tauri://localhost`,
which has **no** proxy, so it needs **absolute** backend URLs. Those live in
`frontend/.env.desktop`, which Vite only reads when built with `--mode desktop` (what
`beforeBuildCommand` does). The web build never reads that file, so it's unaffected.

## Known limitations (this PR)
- **Auth is cross-origin.** Calls from `tauri://localhost` to `https://api.whirlyfan.com`
  are cross-origin → CORS/cookie-blocked until **Phase E** (desktop OAuth + token auth
  + backend CORS for the desktop origin). The shell, routing, and UI still render; this
  PR de-risks packaging + the webview + the build pipeline.
- **DMG packaging fails in a headless shell.** `bundle_dmg.sh` drives Finder via
  AppleScript to lay out the disk image, which needs a GUI session. The `.app` builds
  fine; proper `.dmg`/installer packaging is a **Phase G / CI** concern (build on a
  real desktop session or a macOS CI runner).
- **No YouTube I/O yet.** Audio still streams from the cloud `/stream/` endpoint, exactly
  like the website. Local extraction/playback is **PR B**.
