#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""The device's UI palettes for the game's build: Melodee's own (vendor/melodee/tools/gen_ui_palettes.py, unchanged),
with each palette's four track colours in reverse order (track 1 takes track 4's colour, 2 takes 3's, 3 takes 2's,
4 takes 1's). The knob shades are derived from the track colours, so they follow. Melodee's contrast checks run as
usual (the same colours, in another order).

  gen_palettes.py VENDOR_MELODEE OUT.h
"""
import importlib.util
import sys
from pathlib import Path

vendor, out = Path(sys.argv[1]), sys.argv[2]
spec = importlib.util.spec_from_file_location("gen_ui_palettes", vendor / "tools" / "gen_ui_palettes.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
gen.PALETTES[:] = [(name, bg, surf, text, accent, tuple(reversed(trk))) for name, bg, surf, text, accent, trk in gen.PALETTES]
sys.argv = ["gen_ui_palettes.py", out]
gen.main()
