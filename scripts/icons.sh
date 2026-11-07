#!/bin/sh
# Builds build/icon.icns, build/icon.ico and build/icon.png from the SVGs in build/.
# Needs macOS (iconutil), rsvg-convert and ImageMagick: brew install librsvg imagemagick
set -eu
cd "$(dirname "$0")/../build"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir "$tmp/icon.iconset"
for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "$tmp/icon.iconset/icon_${s}x${s}.png"
  rsvg-convert -w "$((s * 2))" -h "$((s * 2))" icon.svg -o "$tmp/icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$tmp/icon.iconset" -o icon.icns
cp "$tmp/icon.iconset/icon_512x512@2x.png" icon.png

set --
for s in 16 20 24 32 40 48 64 256; do
  rsvg-convert -w "$s" -h "$s" icon-win.svg -o "$tmp/win-$s.png"
  set -- "$@" "$tmp/win-$s.png"
done
magick "$@" icon.ico
