# SLOOP engines

From [SLOOP](https://github.com/isod89/sloop-fm1) by isod89, a fork of
[Felucca](https://github.com/hugelton/Felucca) (Leo Kuroshita, Hügelton Instruments), at commit
`bac9c05ea7627449405aa10e48da21d75b6c8c56`.

| File | What | Licence |
| --- | --- | --- |
| `eng_analog.c` | ANALOG: two band-limited oscillators, noise, drive and a state-variable filter, with SLOOP's preset bank (808s, acid, Reese, wobble, supersaw, pads …). Unchanged from SLOOP. Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments; SLOOP's presets by isod89 | GPL-3.0-only |
| `sloop.c` | muse-midi-dx's adapter: SLOOP's formats mapped onto Melodee's, four helpers from SLOOP's `dsp.c` and `engines.c` (`osc_saw`, `osc_pulse`, `tsvf_coef`, `uni_turns`) | GPL-3.0-only |

`LICENSE` is SLOOP's licence (GPL-3.0), the same as Melodee's and this project's. SLOOP's licensing notes
(`LICENSING.md` in its repository) list no other licence for these files.

Differences from SLOOP:

- ANALOG's filter TYPE (band-pass, high-pass) needs a track parameter Melodee does not have: it is always low-pass
  here, as SLOOP's presets set it.
- SLOOP presets' effect sends (DIST, CHORUS, DELAY, REVERB) belong to SLOOP's effects and are left out; the track keeps
  its own mix and effects. Their other settings (glide, transpose, LFO, voice mode) are applied.

SLOOP's LOFI and DIGITAL are not here: they use voice state Melodee's voices do not have. GRAIN depends on SLOOP's
SAMPLE engine and sample sets.

Remove: delete this folder (or add a file named `DISABLED`) and rebuild.
