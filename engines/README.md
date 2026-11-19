# Engines from other projects

Each folder here is one **source**: engines taken from another FM-1 firmware, kept apart from Melodee's and from each
other. The build (`scripts/build-emu.sh`) finds them with `scripts/gen_ext_engines.py`; Melodee's engine table takes them
through `patches/03-engine-slots.patch`.

| Source | Engines | Ids | From |
| --- | --- | --- | --- |
| `x0x/` | **X0X 303**: the TB-303 bass (accent, slide) | 22 (22–25 x0x's) | [charlesvestal/fm1-x0x](https://github.com/charlesvestal/fm1-x0x) |
| `sloop/` | **ANALOG**: SLOOP's analog synth and preset bank (808s, acid, Reese, supersaw, pads …) | 26 (26–29 SLOOP's) | [isod89/sloop-fm1](https://github.com/isod89/sloop-fm1) |

Each folder's `NOTICE.md` says what came from where, at which commit, under which licence, and what differs.

## Removing a source

Delete its folder, or add an empty file named `DISABLED` in it, and rebuild (`npm run build:emu`). Nothing else
changes: Melodee's engines and the other sources stay as they are. A part that had one of its sounds goes back to its
default sound.

## Adding a source

A folder `engines/<name>/` with:

- **`LICENSE`**: the source's licence. It must be compatible with GPL-3.0 (GPL-3.0, MIT, BSD, Apache-2.0, MPL-2.0 …).
  Licences of parts inside it go next to it (for example `LICENSE-MIT-Open303.txt`).
- **`NOTICE.md`**: where it comes from (repository, commit), the copyright holders, what is changed.
- **`<name>.c`**: included into the firmware. It defines the engines (`engine_t`, Melodee's format, `firmware/src/core.h`),
  `<name>_init(void)` (run at power-on) and `<name>_preset_loaded(track_t *, uint32_t engine, uint32_t preset)` (run
  after a preset of any engine loads; it may do nothing). Keep the source's own files unchanged and adapt them here.
- **`engines.txt`**: one line an engine: `<id> <symbol> <categories>`. The id is the engine's number for good (sounds are
  saved by it): 22–31, each source its own range, never shared. The categories are a letter per preset (`B` bass,
  `L` lead, `P` pad, `K` keys, `U` pluck, `S` strings, `R` brass, `W` wind, `E` bell, `G` organ, `D` drum, `F` FX, `O`
  other), or `-`.
- **`units.txt`** (optional): the source's own `.c` files to build as separate units, so their names never meet
  Melodee's. They can use Melodee's copy of x0x's math (`fastmath.h`, `x0x_param.h`).

`npm run check:native` loads every preset of every engine here on every part and plays it under the sanitizers.

## Not brought over

- **SLOOP's LOFI and DIGITAL** keep state in voice slots 6 and 7; Melodee's voices have six (`s[0..5]`), so they would
  write past them. **GRAIN** plays SLOOP's SAMPLE engine's sample sets, which Melodee does not have. SLOOP's DRAWBAR is
  Melodee's WHEEL (Melodee's is a later version of it).
- **x0x's 808 and 909** are in Melodee already (its DRUM engine's 909 is x0x's, `firmware/src/x0x/`).
