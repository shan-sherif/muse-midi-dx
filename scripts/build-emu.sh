#!/bin/sh
# Build the Melodee engine + UI to WebAssembly for the game: web/melodee.wasm
# Melodee (vendor/melodee, the upstream submodule, untouched) is copied to .build/melodee and patched there with
# patches/*.patch (muse-midi-dx's changes: six parts, ...), then built.
#   scripts/build-emu.sh            the WebAssembly (web/melodee.wasm)
#   scripts/build-emu.sh --prepare  only the patched copy and its generated headers (for tests/native_check.sh)
# Needs: emcc (Emscripten; `source ~/emsdk/emsdk_env.sh`), Python with Pillow + fontTools (.venv, see README).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/vendor/melodee"
M="$ROOT/.build/melodee"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
[ -f "$V/firmware/src/melodee.c" ] || { echo "build-emu: vendor/melodee missing (git submodule update --init)"; exit 1; }

# the patched copy (sources only; its generated headers are made below)
mkdir -p "$ROOT/.build"
rsync -a --delete --exclude .git --exclude build "$V/" "$M/"
for p in "$ROOT"/patches/*.patch; do
    [ -f "$p" ] || continue
    patch -s -p1 -d "$M" < "$p" || { echo "build-emu: $(basename "$p") does not apply"; exit 1; }
done

cd "$M"
# generated headers (fonts, icons, tables), as Melodee's own web/emu/build.sh
"$PY" -c 'import sys; sys.path.insert(0, "tools"); sys.argv = ["build.py"]; import build; build.generate()' >/dev/null
"$PY" tools/gen_909_tables.py build/gen/x0x_drum_tables.h >/dev/null
"$PY" -I "$ROOT/scripts/gen_palettes.py" "$M" build/gen/ui_palettes.h   # the palettes, track colours reversed
[ "$1" = "--prepare" ] && { echo "build-emu: prepared $M"; exit 0; }

command -v emcc >/dev/null 2>&1 || [ ! -f "$HOME/emsdk/emsdk_env.sh" ] || . "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1
command -v emcc >/dev/null 2>&1 || { echo "build-emu: no emcc (install Emscripten)"; exit 1; }
VERSION=$(sed -n 's/^#define MELODEE_VERSION "\([^"]*\)".*/\1/p' firmware/src/melodee.c | head -n 1)
emcc -O2 -ffp-contract=off -std=gnu99 -w -Ibuild/gen -Ifirmware/src -Itests -Iweb/emu \
    --no-entry -sSTANDALONE_WASM -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 \
    -o "$ROOT/web/melodee.wasm" "$ROOT/emu/game_glue.c"
printf '{"melodee":"%s","parts":6,"fxSlots":4}\n' "$VERSION" > "$ROOT/web/version.json"
echo "build-emu: web/melodee.wasm ($(wc -c < "$ROOT/web/melodee.wasm" | tr -d ' ') B, Melodee $VERSION, six parts)"
