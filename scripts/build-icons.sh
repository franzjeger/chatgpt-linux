#!/bin/sh
# Rasterise assets/icon.svg into the hicolor sizes the desktop entry needs.
# The PNGs are committed, so packagers don't need ImageMagick.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
svg="$root/assets/icon.svg"
out="$root/assets/icons"

if command -v magick >/dev/null 2>&1; then
  convert_cmd="magick"
elif command -v convert >/dev/null 2>&1; then
  convert_cmd="convert"
else
  echo "build-icons: ImageMagick not found (need 'magick' or 'convert')" >&2
  exit 1
fi

mkdir -p "$out"
for size in 512 256 128 64 48 32 16; do
  "$convert_cmd" -background none "$svg" -resize "${size}x${size}" "$out/$size.png"
  echo "  assets/icons/$size.png"
done
