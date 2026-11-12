/* SPDX-License-Identifier: GPL-3.0-only */
/* muse-midi-dx: the patched Melodee (six parts) built natively with AddressSanitizer + UndefinedBehaviorSanitizer and
 * driven hard: every part sounding, its mix set, every track selected, every button and knob, then thousands of
 * random inputs, a frame drawn between them. An out-of-bounds access or undefined behaviour stops it with the line.
 *   scripts/build-emu.sh --prepare && sh emu/native_check.sh */
#include "game_glue.c"
#include <stdio.h>
#include <stdlib.h>

static void run_ms(uint32_t ms) { for (uint32_t i = 0; i < ms * 44u / 128u + 1u; i++) web_render(128); }
static uint32_t seed = 12345;   /* (NATIVE_SEED: another run) */
static uint32_t rnd(uint32_t n) { seed = seed * 1664525u + 1013904223u; return (seed >> 8) % n; }

/* (ui_test.c has its own main, unused in the WebAssembly: this runs first, as a constructor, and exits) */
__attribute__((constructor)) static void native_check(void)
{
    uint32_t t, k, i;
    if (getenv("NATIVE_SEED")) seed = (uint32_t)strtoul(getenv("NATIVE_SEED"), 0, 10);
    web_boot(700);
    run_ms(1500);
    printf("parts %u, tracks %u in use, budget %d\n", (unsigned)NPART, (unsigned)trk_n(), (int)settings_budget);
    for (t = 0; t < trk_n(); t++)
        printf("  part %u: %s / %s\n", (unsigned)t + 1u, game_engine_name(game_track_engine(t)),
               game_preset_name(game_track_engine(t), game_track_preset(t)));
    game_view();
    /* every part sounding: chords on channels 1, 3..6, drums on 2 */
    for (t = 0; t < NPART; t++)
        for (k = 0; k < (t == 1u ? 4u : 6u); k++)
            web_midi_in(0x90u | t, t == 1u ? 35u + k * 3u : 48u + t * 2u + k * 4u, 100);
    run_ms(500);
    for (t = 0; t < NPART; t++) printf("  part %u peak %d, voices on:", (unsigned)t + 1u, (int)trk[t].peak),
        printf(" %u\n", (unsigned)({ uint32_t n = 0; for (k = 0; k < NVOICE; k++) n += trk[t].v[k].active; n; }));
    for (t = 0; t < NPART; t++) for (k = 0; k < 6u; k++) game_tparam_set(t, k, k == 1u ? -20 : 90);
    for (t = 0; t < NTRK; t++) { game_load_track(t, 3u /* SID */, 3); run_ms(30); }
    /* the rack: every effect in every slot (4: rack4), CHAIN and SPLIT, every send up on every part; REVERB moving */
    {
        static const uint8_t FXT[] = {0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19};
        uint32_t mode, sl, f;
        for (t = 0; t < NPART; t++) for (k = 3; k < 7u; k++) game_tparam_set(t, k, 100);
        for (mode = 0; mode < 2u; mode++) {
            game_rack_set(0, 6, (int32_t)mode);
            for (f = 0; f < sizeof FXT; f++) for (sl = 0; sl < RACK_SLOTS; sl++) {
                game_rack_set(sl, 0, FXT[(f + sl * 5u) % sizeof FXT]);
                game_rack_set(sl, 1, 127); game_rack_set(sl, 4, (int32_t)(f * 7u % 127u) - 63);
                for (t = 0; t < NPART; t++) web_midi_in(0x90u | t, 50u + t * 3u + f % 12u, 90);
                run_ms(40);
                for (t = 0; t < NPART; t++) web_midi_in(0x80u | t, 50u + t * 3u + f % 12u, 0);
            }
            uint32_t reverbs = 0;
            for (sl = 0; sl < RACK_SLOTS; sl++) reverbs += game_rack(sl, 0) == 8;
            printf("rack mode %s: one reverb at most: %s\n", mode ? "SPLIT" : "CHAIN", reverbs <= 1u ? "yes" : "NO");
        }
        /* slot 4 alone changes the sound: a note, its tail, slot 4 off then REVERB (send 4 only, SPLIT) */
        for (sl = 0; sl < RACK_SLOTS; sl++) game_rack_set(sl, 0, 0);
        for (t = 0; t < NPART; t++) for (k = 3; k < 7u; k++) game_tparam_set(t, k, 0);
        game_tparam_set(0, 2, 0); game_tparam_set(0, 0, 110);              /* (unmuted: the mixer test above muted it) */
        game_rack_set(0, 6, 1); game_tparam_set(0, 6, 127); run_ms(500);
        for (int pass = 0; pass < 2; pass++) {
            double e = 0;
            if (pass) { game_rack_set(3, 0, 8); game_rack_set(3, 1, 127); run_ms(300); }
            web_midi_in(0x90, 60, 110); run_ms(80); web_midi_in(0x80, 60, 0); run_ms(400);
            for (i = 0; i < 300u; i++) { web_render(128); float *l = web_out_l(); for (k = 0; k < 128u; k++) e += (double)l[k] * l[k]; }
            printf("  tail energy, slot 4 %s: %.4f\n", pass ? "REVERB" : "off   ", e);
            run_ms(2500);
        }
        game_rack_set(3, 0, 0);
    }
    /* every track selected (ALGORITHM), every button, every knob */
    for (t = 0; t < NTRK + 2u; t++) { web_encoder(1, 1); run_ms(60); }
    for (k = 0; k < 14u; k++) {
        web_buttons(1u << k); run_ms(40); web_buttons(0); run_ms(80);
        for (i = 0; i < 7u; i++) { web_encoder(i, (int32_t)(i & 1u ? 3 : -2)); run_ms(20); }
        web_buttons(1u << 8); run_ms(30); web_buttons(0); run_ms(60);       /* (HOME again) */
    }
    /* random inputs */
    for (i = 0; i < 20000u; i++) {
        uint32_t r = rnd(10);
        if (r < 3u) { web_buttons(1u << rnd(14)); run_ms(rnd(3) ? 20 : 700); web_buttons(0); }
        else if (r < 6u) web_encoder(rnd(7), (int32_t)rnd(9) - 4);
        else if (r < 8u) web_keys(1u << rnd(27));
        else if (r < 9u) web_keys(0);
        else if (rnd(4) == 0u) { uint32_t sl = rnd(RACK_SLOTS + 1u), f = rnd(7); game_rack_set(sl, f, (int32_t)rnd(200) - 70);
                                  game_tparam_set(rnd(NPART), 3u + rnd(4), (int32_t)rnd(140)); }
        else { uint32_t ch = rnd(NPART + 2u); web_midi_in((rnd(4) ? 0x90u : 0x80u) | ch, 24u + rnd(80), 1u + rnd(126)); }
        run_ms(5 + rnd(30));
    }
    printf("random inputs done: sel %u, page %u, home %u; arena used %u of %u bytes, failures %u\n",
           (unsigned)song.sel, (unsigned)ui.page, (unsigned)ui.home, (unsigned)resource_used(), (unsigned)RESOURCE_CAPACITY,
           (unsigned)resource_failures);
    puts("native check: OK");
    exit(0);
}
