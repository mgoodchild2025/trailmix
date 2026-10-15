#!/bin/zsh
# Builds the macOS microphone watcher as a universal binary into build/bin/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/bin build/tmp
for arch in arm64 x86_64; do
  swiftc -O -target ${arch}-apple-macos12.0 native/mac/micwatch.swift -o build/tmp/micwatch-$arch
done
lipo -create build/tmp/micwatch-arm64 build/tmp/micwatch-x86_64 -output build/bin/trailmix-micwatch
rm -rf build/tmp
echo "built build/bin/trailmix-micwatch ($(lipo -archs build/bin/trailmix-micwatch))"
