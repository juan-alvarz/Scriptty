#!/bin/sh
# Builds Scriptty for this Mac and replaces the installed copy with it.
# Installs to ~/Applications by default (each macOS account keeps its own copy);
# set SCRIPTTY_APP_DIR=/Applications to install there instead.
set -eu
cd "$(dirname "$0")/.."
dest="${SCRIPTTY_APP_DIR:-$HOME/Applications}"

pnpm build
# The version comes from CHANGELOG.md (see scripts/version.sh), as in the Release workflow.
pnpm exec electron-builder --mac --dir -c.extraMetadata.version="$(scripts/version.sh)"

# electron-builder writes dist/mac-arm64 on Apple Silicon and dist/mac on Intel.
app=$(ls -d dist/mac*/Scriptty.app | head -n 1)

if pgrep -xq Scriptty; then
  osascript -e 'quit app "Scriptty"'
  while pgrep -xq Scriptty; do sleep 0.2; done
fi

mkdir -p "$dest"
rm -rf "$dest/Scriptty.app"
ditto "$app" "$dest/Scriptty.app"
echo "Installed $dest/Scriptty.app"
