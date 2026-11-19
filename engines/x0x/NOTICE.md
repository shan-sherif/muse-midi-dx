# x0x engines

From [x0x](https://github.com/charlesvestal/fm1-x0x) by Charles Vestal, a fork of
[Felucca](https://github.com/hugelton/Felucca), at commit `512c0daaf25f82c5b70e9eceee195864e7da378c`.

| File | What | Licence |
| --- | --- | --- |
| `bass303.c`, `bass303.h` | the TB-303 bass: a C port of Open303 (Robin Schmidt, MIT) with the Devilfish ranges and the Soft / RAT drive of [schwung-303](https://github.com/charlesvestal/schwung-303) (the RAT model after davemollen/dm-Rat, GPL-3.0); speed-ups after [Optimist](https://github.com/w0ts/optimist) (henri / hdavid, GPL-3.0-only). Unchanged from x0x, built as their own unit | GPL-3.0 (Open303's parts MIT) |
| `x0x.c` | muse-midi-dx's adapter: the 303 as a Melodee engine, and its presets | GPL-3.0-only |

`LICENSE` is x0x's licence (GPL-3.0), the same as Melodee's and this project's. x0x's licensing notes
(`LICENSING.md` in its repository) give the origins above.

The 303's Open303 parts are MIT, which asks for its copyright and permission notice to travel with the code. x0x names
Open303's licence but does not include its text, so it is here: `LICENSE-MIT-Open303.txt`, Copyright (c) 2009 Robin
Schmidt, from [Open303](https://github.com/RobinSchmidt/Open303) (`License.txt`, commit
`313bf0d9ade7c1dcb6b3a74f5ea1780a29d70074`).

The 303 uses x0x's math helpers (`fastmath.h`, `x0x_param.h`): Melodee already has them (`firmware/src/x0x/`, from
x0x, GPL-3.0-only), so the build uses Melodee's copy.

TR-808, TR-909 and TB-303 are trademarks of Roland Corporation, used only to describe what the engine emulates; this
project is not affiliated with Roland.

Remove: delete this folder (or add a file named `DISABLED`) and rebuild.
