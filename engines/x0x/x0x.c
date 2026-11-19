/* SPDX-License-Identifier: GPL-3.0-only */
/* muse-midi-dx: x0x's TB-303 bass on Melodee. bass303.c / .h are x0x's (charlesvestal/fm1-x0x), unchanged, built as
 * their own unit (units.txt: no name of theirs meets Melodee's); x0x's math (fastmath.h, x0x_param.h) is Melodee's own
 * copy of it (firmware/src/x0x). This adapter makes a Melodee engine of it: one 303 a part, monophonic, its own
 * envelopes (ownenv); a note held over into the next slides (the presets are LEGATO), a velocity of 100 or more is an
 * accent. The pitch is the voice's when it starts (Melodee's transpose and octave included); the 303's eight panel
 * controls are the engine's eight EDIT values. Included by the generated ext_engines.h (scripts/gen_ext_engines.py). */
#include "bass303.h"

#define X0X_GAIN 48000.0f        /* full scale, as Melodee's voices (dsp.c VOICE_FS, the << 1 after it) */
static const uint8_t X0X_POT[8] = {BASS303_CUTOFF, BASS303_RESO, BASS303_ENVMOD, BASS303_DECAY,
                                   BASS303_ACCENT, BASS303_WAVE, BASS303_DRIVE, BASS303_SLIDE};
static struct {
    bass303_t b;
    int16_t pot[8];              /* the values bass303_set last had (-1: none yet) */
    uint8_t start, slide, accent;
} x0x_part[NPART];

static void x0x_ready(uint32_t p)
{
    bass303_init(&x0x_part[p].b);
    bass303_set(&x0x_part[p].b, BASS303_DRVTYPE, BASS303_DRV_SOFT);
    bass303_set(&x0x_part[p].b, BASS303_VOLUME, 120);    /* (-3.3 dB: as loud as Melodee's own basses; x0x's 96 is for its mix) */
    for (uint32_t k = 0; k < 8u; k++)
        x0x_part[p].pot[k] = -1;
}
static void x0x_note_on(track_t *t, voice_t *v)            /* a new attack: started at the next render (its pitch) */
{
    uint32_t p = (uint32_t)(t - trk) % NPART;
    x0x_part[p].start = 1;
    x0x_part[p].slide = 0;
    x0x_part[p].accent = v->vel >= 100u;
}
static void x0x_legato(track_t *t, voice_t *v)             /* a held note moved on: the 303's slide */
{
    uint32_t p = (uint32_t)(t - trk) % NPART;
    x0x_part[p].start = 1;
    x0x_part[p].slide = 1;
    x0x_part[p].accent = v->vel >= 100u;
}
static void x0x_render(track_t *t, voice_t *v, int32_t *out, uint32_t n, const vmod_t *m)
{
    uint32_t p = (uint32_t)(t - trk) % NPART, i;
    float buf[BASS303_MAX_BLOCK];
    bass303_t *b = &x0x_part[p].b;
    for (uint32_t k = 0; k < 8u; k++) {                  /* the panel: only what moved */
        int16_t val = (int16_t)clamp(t->p[P_E0 + k], 0, k == 5u ? 1 : 127);
        if (val != x0x_part[p].pot[k]) {
            bass303_set(b, X0X_POT[k], val);
            x0x_part[p].pot[k] = val;
        }
    }
    if (x0x_part[p].start) {
        bass303_note_on(b, (int)clamp((m->pitch16 + 8) >> 4, 0, 127), x0x_part[p].accent, x0x_part[p].slide);
        x0x_part[p].start = 0;
    } else if (!v->gate && b->gate)
        bass303_note_off(b);
    if (n > BASS303_MAX_BLOCK)
        n = BASS303_MAX_BLOCK;
    bass303_render(b, buf, (int)n);
    for (i = 0; i < n; i++)
        out[i] += (int32_t)(buf[i] * X0X_GAIN * (float)amp_at(m, i) * (1.0f / 32768.0f));
}
static int x0x_done(track_t *t, voice_t *v)                /* let go, and the 303 silent */
{
    uint32_t p = (uint32_t)(t - trk) % NPART;
    if (!v->gate && x0x_part[p].b.gate)
        bass303_note_off(&x0x_part[p].b);
    return !v->gate && x0x_part[p].b.idle;
}

static const char *const N_X0X_WAVE[] = {"SAW", "SQR"};
/* muse-midi-dx's presets: {CUT, RES, ENV, DCY, ACC, WAVE, DRV, SLD}; the 303 makes its own envelopes; all LEGATO
 * (mono: a note held into the next slides) */
static const preset_t X0X_PRESETS[] = {
    {"ACID LINE", {40, 100, 80, 50, 80, 0, 0, 21}, {0, 0, 127, 0}, 0, 1},
    {"SQUELCH", {30, 120, 110, 40, 110, 0, 30, 21}, {0, 0, 127, 0}, 0, 1},
    {"SQUARE BASS", {50, 60, 50, 70, 50, 1, 0, 21}, {0, 0, 127, 0}, 0, 1},
    {"RAT ACID", {45, 105, 90, 55, 90, 0, 70, 30}, {0, 0, 127, 0}, 0, 1},
    {"DEEP 303", {20, 40, 30, 80, 40, 0, 0, 40}, {0, 0, 127, 0}, 0, 1},
    {"SLOW SLIDE", {38, 96, 70, 64, 64, 0, 20, 90}, {0, 0, 127, 0}, 0, 1},
};
static const engine_t ENG_X0X_303 = {
    .name = "X0X 303",
    .page_title = {"303", "MORE"},
    .edit = {
        {"CUT", F_PCT, 0, 127, 64, 0, 0},
        {"RES", F_PCT, 0, 127, 64, 0, 0},
        {"ENV", F_PCT, 0, 127, 64, 0, 0},
        {"DCY", F_PCT, 0, 127, 64, 0, 0},
        {"ACC", F_PCT, 0, 127, 64, 0, 0},
        {"WAVE", F_ENUM, 0, 1, 0, N_X0X_WAVE, 0},
        {"DRV", F_PCT, 0, 127, 0, 0, 0},
        {"SLD", F_PCT, 0, 127, 21, 0, 0},
    },
    .presets = X0X_PRESETS,
    .npresets = sizeof X0X_PRESETS / sizeof X0X_PRESETS[0],
    .knob = {P_E0, P_E1, P_E2, P_E3},
    .poly = 1,
    .note_on = x0x_note_on,
    .render = x0x_render,
    .legato = x0x_legato,
    .ownenv = 1,
    .done = x0x_done,
};

static void x0x_init(void)
{
    for (uint32_t p = 0; p < NPART; p++)
        x0x_ready(p);
}
static void x0x_preset_loaded(track_t *t, uint32_t e, uint32_t k) { (void)t; (void)e; (void)k; }
