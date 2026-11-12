#!/bin/sh
# the native sanitizer check of the patched Melodee (emu/native_check.c); run scripts/build-emu.sh --prepare first.
# (No alignment check: the host harness, tests/hostsim.c, defines __attribute__ away for the whole firmware, the
# alignments with the sections, upstream as for us; WebAssembly loads unaligned data correctly.)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/.build/melodee"
cc -std=gnu99 -O1 -g -w -fsanitize=address,undefined -fno-sanitize=alignment,shift -fno-sanitize-recover=undefined -fno-omit-frame-pointer \
   -I"$M/build/gen" -I"$M/firmware/src" -I"$M/tests" -I"$M/web/emu" -o "$ROOT/.build/native_check" "$ROOT/emu/native_check.c" -lm
"$ROOT/.build/native_check"
