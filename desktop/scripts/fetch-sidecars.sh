#!/bin/sh
# Fetch the sidecar binaries the desktop app bundles (currently yt-dlp), named for
# the Rust host target triple as Tauri's `externalBin` expects. Run before building:
#   cd desktop && ./scripts/fetch-sidecars.sh && pnpm tauri build
# They're git-ignored (large); CI runs this too.
set -e

TRIPLE=$(rustc -Vv | awk '/^host:/ {print $2}')
DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
mkdir -p "$DIR"

case "$TRIPLE" in
  *apple-darwin)   YTDLP_ASSET="yt-dlp_macos" ;;
  *pc-windows-*)   YTDLP_ASSET="yt-dlp.exe" ;;
  *linux*)         YTDLP_ASSET="yt-dlp_linux" ;;
  *) echo "unsupported target: $TRIPLE" >&2; exit 1 ;;
esac

OUT="$DIR/yt-dlp-$TRIPLE"
case "$TRIPLE" in *pc-windows-*) OUT="$OUT.exe" ;; esac

echo "fetching $YTDLP_ASSET → $OUT"
curl -sSL -o "$OUT" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YTDLP_ASSET"
chmod +x "$OUT"
"$OUT" --version >/dev/null && echo "yt-dlp $($OUT --version) ready"

# deno: yt-dlp uses it (via yt-dlp-ejs) to solve YouTube's JS n-sig challenge. The
# launched app has no user PATH, so we bundle deno next to yt-dlp and add that dir
# to PATH at spawn time (see lib.rs). deno ships one zip per triple.
DENO_OUT="$DIR/deno-$TRIPLE"
case "$TRIPLE" in *pc-windows-*) DENO_OUT="$DENO_OUT.exe" ;; esac
echo "fetching deno-$TRIPLE.zip → $DENO_OUT"
curl -sSL -o "$DIR/deno.zip" "https://github.com/denoland/deno/releases/latest/download/deno-$TRIPLE.zip"
unzip -o -q "$DIR/deno.zip" -d "$DIR" && rm "$DIR/deno.zip"
DENO_BIN="$DIR/deno"; case "$TRIPLE" in *pc-windows-*) DENO_BIN="$DIR/deno.exe" ;; esac
mv "$DENO_BIN" "$DENO_OUT"
chmod +x "$DENO_OUT"
"$DENO_OUT" --version >/dev/null && echo "deno $($DENO_OUT --version | head -1) ready"
