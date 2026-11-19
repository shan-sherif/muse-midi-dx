/* SPDX-License-Identifier: GPL-3.0-only */
/* muse-midi-dx: SLOOP's engines on Melodee. SLOOP (isod89/sloop-fm1) is a Felucca fork, as Melodee is: its engines have
 * the same shape, so they run on Melodee through this adapter, their own files unchanged (eng_analog.c here is SLOOP's,
 * NOTICE.md says from which commit). The adapter gives them SLOOP's names for the preset and engine formats, the few
 * helpers SLOOP has and Melodee does not (below, from SLOOP's dsp.c and engines.c: GPL-3.0-only, Leo Kuroshita /
 * Hügelton Instruments), then makes Melodee engines of them (sloop_init) and SLOOP's presets Melodee presets
 * (sloop_make, sloop_preset_loaded). Included by the generated ext_engines.h (scripts/gen_ext_engines.py). */

/* ---- SLOOP's formats (its core.h) */
typedef struct {
    const char *name;
    int8_t e[8];
    uint8_t env[4];
    int8_t fenv;
    uint8_t mono;
    uint8_t fx[4];               /* DIST, CHORUS, DELAY, REVERB sends: SLOOP's own FX, not Melodee's: left out */
    uint8_t arp[4];              /* (Melodee: the arpeggiator is the track's, a preset does not set it) */
    uint8_t pat;
    int8_t x[8];                 /* up to 4 (track parameter id + 1, value): set by sloop_preset_loaded */
} sloop_preset_t;
typedef struct {
    const char *name;
    const char *page_title[2];
    param_desc_t edit[8];
    const sloop_preset_t *presets;
    uint8_t npresets;
    int8_t fil_page;
    void (*note_on)(struct track *t, voice_t *v);
    void (*render)(struct track *t, voice_t *v, int32_t *out, uint32_t n, const vmod_t *m);
    uint16_t color;
    uint8_t macro[4];
    uint8_t poly;
    int32_t (*amp)(struct track *t, voice_t *v, int32_t adsr);
    const param_desc_t *(*desc)(const struct track *t, uint32_t k);
    void (*block)(struct track *t);
    uint8_t ownenv;
    int (*done)(struct track *t, voice_t *v);
} sloop_engine_t;
#define FX(d, c, dl, r) .fx = {(d) + 1, (c) + 1, (dl) + 1, (r) + 1}
#define ARP(m, rt, o, g) .arp = {(m) + 1, (rt) + 1, (o) + 1, (g) + 1}
#define PAT(n) .pat = (n)
#define XP(...) .x = {__VA_ARGS__}

/* ---- SLOOP's helpers that Melodee has not (SLOOP dsp.c, engines.c) */
static inline int32_t sloop_osc_saw(uint32_t ph, uint32_t inc) { return ((int32_t)(ph >> 16) - 32768) - blep(ph, inc); }
static inline int32_t sloop_osc_pulse(uint32_t ph, uint32_t inc, uint32_t pw)
{
    return (sloop_osc_saw(ph, inc) - sloop_osc_saw(ph + pw, inc)) >> 1;
}
static inline void sloop_tsvf_coef(tsvf_t *c, int32_t cut, int32_t reso)   /* (Melodee's tsvf_coef_k with SLOOP's damping) */
{
    tsvf_coef_k(c, cut, 8192 - reso * 7600 / 127);
}
static uint32_t sloop_uni_turns(uint32_t r, int32_t p16, int32_t d16)
{
    uint32_t b = pitch_inc((uint32_t)clamp(p16, 0, 2047));
    return b ? (uint32_t)(((uint64_t)r * pitch_inc((uint32_t)clamp(p16 + d16, 0, 2047))) / b) : r;
}

/* ---- SLOOP's engines, as SLOOP has them */
#define preset_t sloop_preset_t
#define engine_t sloop_engine_t
#define osc_saw sloop_osc_saw
#define osc_pulse sloop_osc_pulse
#define tsvf_coef sloop_tsvf_coef
#define uni_turns sloop_uni_turns
#define P_FTYPE P_RESERVED46     /* SLOOP's filter TYPE (LP / BP / HP): Melodee has none; a retired, always-0 id: LP */
#include "eng_analog.c"
#undef preset_t
#undef engine_t
#undef osc_saw
#undef osc_pulse
#undef tsvf_coef
#undef uni_turns
#undef P_FTYPE
#undef FX
#undef ARP
#undef PAT
#undef XP

/* ---- as Melodee engines (engines.txt gives their ids) */
static const engine_t *const ENGINES[NENGINES];          /* (Melodee's tables, defined after: engines.c, params.c) */
static const param_desc_t TP[P_COUNT];
static engine_t ENG_SLOOP_ANALOG;
static const sloop_engine_t *const SLOOP_FROM[] = {&ENG_ANALOG};
static engine_t *const SLOOP_TO[] = {&ENG_SLOOP_ANALOG};
#define SLOOP_N (sizeof SLOOP_FROM / sizeof SLOOP_FROM[0])

static const sloop_engine_t *sloop_of(uint32_t e)       /* (engine id -> its SLOOP engine, or 0) */
{
    for (uint32_t i = 0; i < SLOOP_N; i++)
        if (ENGINES[e % NENGINES] == SLOOP_TO[i])
            return SLOOP_FROM[i];
    return 0;
}
/* a SLOOP preset as a Melodee one: the sound (the eight values, the envelope, its filter amount, mono); the rest of
 * SLOOP's patch (its x[] parameters: glide, transpose, LFO, voice mode) in sloop_preset_loaded */
static void sloop_make_of(const sloop_engine_t *s, uint32_t k, preset_t *p, char *name)
{
    const sloop_preset_t *q = &s->presets[k % s->npresets];
    uint32_t i;
    for (i = 0; i < 20u && q->name[i]; i++)
        name[i] = q->name[i];
    name[i] = 0;
    p->name = name;
    for (i = 0; i < 8u; i++)
        p->e[i] = q->e[i];
    for (i = 0; i < 4u; i++)
        p->env[i] = q->env[i];
    p->fenv = q->fenv;
    p->mono = q->mono;
}
static void sloop_make_analog(uint32_t k, preset_t *p, char *name) { sloop_make_of(&ENG_ANALOG, k, p, name); }
static void (*const SLOOP_MAKE[])(uint32_t, preset_t *, char *) = {sloop_make_analog};

static void sloop_init(void)
{
    for (uint32_t i = 0; i < SLOOP_N; i++) {
        const sloop_engine_t *s = SLOOP_FROM[i];
        engine_t *d = SLOOP_TO[i];
        memset(d, 0, sizeof *d);
        d->name = s->name;
        d->page_title[0] = s->page_title[0];
        d->page_title[1] = s->page_title[1];
        for (uint32_t k = 0; k < 8u; k++)
            d->edit[k] = s->edit[k];
        d->presets = 0;                                  /* (made on demand: sloop_make) */
        d->npresets = s->npresets;
        for (uint32_t k = 0; k < 4u; k++)
            d->knob[k] = s->macro[k];
        d->poly = s->poly;
        d->note_on = s->note_on;
        d->render = s->render;
        d->amp = s->amp;
        d->desc = s->desc;
        d->block = s->block;
        d->ownenv = s->ownenv;
        d->done = s->done;
        d->preset_make = SLOOP_MAKE[i];
    }
}
/* a SLOOP preset just loaded into t: its extra parameters (glide, transpose, LFO, voice mode ...), each in its range */
static void sloop_preset_loaded(track_t *t, uint32_t e, uint32_t k)
{
    const sloop_engine_t *s = sloop_of(e);
    if (!s || !s->npresets)
        return;
    const sloop_preset_t *q = &s->presets[k % s->npresets];
    for (uint32_t i = 0; i + 1u < 8u; i += 2u) {
        int32_t id = q->x[i] - 1;
        if (id < 0 || id >= P_COUNT)
            continue;
        t->p[id] = (int16_t)clamp(q->x[i + 1], TP[id].min, TP[id].max);
    }
}
