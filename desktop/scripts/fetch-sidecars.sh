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
