/* SPDX-License-Identifier: GPL-3.0-only */
/* muse-midi-dx: Melodee's browser emulator (vendor/melodee/web/emu/melodee_web.c, unchanged) plus the
 * exports the rhythm game needs:
 *   - the notes the player is holding on the selected track (live_held), so the game judges the real
 *     pitches whatever the input (panel keys + OCT, computer keyboard, MIDI controller);
 *   - the engine and factory-preset lists, and loading one into the selected track.
 * Built by scripts/build-emu.sh. */
#include "melodee_web.c"

/* ---- held notes: 128 bits of the selected track, as four words */
EXPORT(game_held) uint32_t game_held(uint32_t word) { return live_held[song.sel % NTRK][word & 3u]; }
EXPORT(game_sel) uint32_t game_sel(void) { return song.sel; }

/* ---- engines and presets. Names are copied into one buffer (eng_preset may build them on demand) */
static char name_buf[64];
static const char *name_out(const char *s)
{
    uint32_t i = 0;
    for (; s && s[i] && i < sizeof name_buf - 1u; i++)
        name_buf[i] = s[i];
    name_buf[i] = 0;
    return name_buf;
}
EXPORT(game_engine_count) uint32_t game_engine_count(void) { return NENG_SHOWN; }
EXPORT(game_engine_id) uint32_t game_engine_id(uint32_t n) { return eng_vis(n); }   /* n-th pickable engine */
EXPORT(game_engine_name) const char *game_engine_name(uint32_t e) { return name_out(ENGINES[eng_idx(e)]->name); }
EXPORT(game_preset_count) uint32_t game_preset_count(uint32_t e) { return ENGINES[eng_idx(e)]->npresets; }
EXPORT(game_preset_name) const char *game_preset_name(uint32_t e, uint32_t k)
{
    const engine_t *en = ENGINES[eng_idx(e)];
    return name_out(k < en->npresets ? eng_preset(en, k)->name : "");
}
EXPORT(game_cur_engine) uint32_t game_cur_engine(void) { return TSEL->eng_req; }
EXPORT(game_cur_preset) uint32_t game_cur_preset(void) { return TSEL->preset; }

/* load factory preset k of engine e into the selected track, as the PRESETS browser does (sound only) */
EXPORT(game_load) void game_load(uint32_t e, uint32_t k)
{
    if (!eng_ok(e))
        return;
    if (e != TSEL->eng_req)
        set_engine(e);
    apply_preset(k);
    ui_say("PRESET ", eng_preset(ENGINES[eng_idx(e)], k % (ENGINES[eng_idx(e)]->npresets ? ENGINES[eng_idx(e)]->npresets : 1u))->name);
    ui.force = 1;
}

/* show HOME's chord view (ui_view.c: the wheel of fifths, the chord's name, the keys): what the player is playing */
EXPORT(game_view) void game_view(void)
{
    if (!ui.home)
        go_home();
    ui.home_pg = 1;
    ui.force = 1;
}

/* the PRESETS browser's categories (browse.c, after Felucca's category.c): factory preset k of engine e -> CAT_* */
EXPORT(game_preset_cat) uint32_t game_preset_cat(uint32_t e, uint32_t k) { return preset_cat(eng_idx(e), k); }
EXPORT(game_cat_count) uint32_t game_cat_count(void) { return CAT_N; }
EXPORT(game_cat_name) const char *game_cat_name(uint32_t c) { return name_out(c < CAT_N ? CAT_NAME[c] : ""); }

/* the screen's palettes (tools/gen_ui_palettes.py, built with the track colours reversed: scripts/gen_palettes.py):
 * the list, the one in use (the device's settings may change it), and choosing one. Colours as RGB565:
 * slot 0 bg, 1 surface, 2 text, 3 accent, 4..7 tracks 1..4 */
EXPORT(game_palette_count) uint32_t game_palette_count(void) { return NPALETTES; }
EXPORT(game_palette_name) const char *game_palette_name(uint32_t i) { return name_out(i < NPALETTES ? UI_PALETTES[i].name : ""); }
EXPORT(game_palette_index) uint32_t game_palette_index(void) { return ux.pal; }
EXPORT(game_palette_color) uint32_t game_palette_color(uint32_t i, uint32_t slot)
{
    const ui_pal_t *p = &UI_PALETTES[i < NPALETTES ? i : 0u];
    return slot == 0u ? p->bg : slot == 1u ? p->surf : slot == 2u ? p->text : slot == 3u ? p->accent : p->trk[(slot - 4u) & 3u];
}
EXPORT(game_palette_set) void game_palette_set(uint32_t i)
{
    if (i >= NPALETTES)
        return;
    settings.palette = (uint8_t)i;
    palette_set(i);
    ui.force = 1;
    screen_clear();
}

/* the project's tempo (G_BPM, the screen's header): the song's, as the game plays it. The device's range: 40..240 */
EXPORT(game_set_bpm) void game_set_bpm(uint32_t bpm)
{
    int32_t v = (int32_t)clamp((int32_t)bpm, GP[G_BPM].min, GP[G_BPM].max);
    if (song.g[G_BPM] != v) {
        song.g[G_BPM] = (int16_t)v;
        ui.force = 1;
    }
}

/* the parts (tracks 1..4, MIDI channels 1..4 at the default ROUT CH1-4): each one's sound, for the song's
 * accompaniment. Loads as the PRESETS browser does, into track t (not only the selected one) */
EXPORT(game_track_count) uint32_t game_track_count(void) { return trk_n(); }
EXPORT(game_track_engine) uint32_t game_track_engine(uint32_t t) { return t < NTRK ? trk[t].eng_req : 0u; }
EXPORT(game_track_preset) uint32_t game_track_preset(uint32_t t) { return t < NTRK ? trk[t].preset : 0u; }
EXPORT(game_load_track) void game_load_track(uint32_t t, uint32_t e, uint32_t k)
{
    if (t >= trk_n() || !eng_ok(e))
        return;
    if (e != trk[t].eng_req)
        set_engine_of(&trk[t], e);
    apply_preset_to(&trk[t], k);
    ui.force = 1;
}

/* the mixer and the shared FX rack (four slots: patches/02-four-fx-slots.patch), set as the device's web editor sets them
 * (editor.c ED_SET): clamped to each parameter's range; an effect's type through rack_select (one REVERB in the rack).
 * Track fields k: 0 LEVEL, 1 PAN, 2 MUTE, 3 SEND (the chain, or slot 1 in SPLIT), 4 SEND 2, 5 SEND 3, 6 SEND 4.
 * Rack fields f (slot s 0..3): 0 TYPE, 1 MIX, 2 RATE, 3 CHAR, 4 TONE; 5 RETURN, 6 MODE (0 CHAIN, 1 SPLIT) (s ignored).
 * Slot 4's ranges are slot 3's */
static const uint8_t GAME_TP[7] = {P_LEVEL, P_PAN, P_MUTE, P_FXSEND, P_FXSEND2, P_FXSEND3, P_FXSEND4};
static const param_desc_t *tp_desc(uint32_t k) { return &TP[k == 6u ? P_FXSEND3 : GAME_TP[k]]; }
static int16_t *rack_field(uint32_t s, uint32_t f, const param_desc_t **d)
{
    s %= RACK_SLOTS;
    if (f == 5u) { *d = &GP[G_FXRETURN]; return &song.g[G_FXRETURN]; }
    if (f == 6u) { *d = &GP[G_FXMODE]; return &song.g[G_FXMODE]; }
    *d = &GP[f == 4u ? G_MFX3TONE : G_MFX3TYPE + (f & 3u)];
    return f == 4u ? rack_tone(song.g, s) : rack_slot(song.g, s) + (f & 3u);
}
EXPORT(game_tparam) int32_t game_tparam(uint32_t t, uint32_t k) { return t < NTRK && k < 7u ? trk[t].p[GAME_TP[k]] : 0; }
EXPORT(game_tparam_set) void game_tparam_set(uint32_t t, uint32_t k, int32_t v)
{
    if (t >= NTRK || k >= 7u)
        return;
    trk[t].p[GAME_TP[k]] = (int16_t)clamp(v, tp_desc(k)->min, tp_desc(k)->max);
    ui.force = 1;
}
EXPORT(game_rack) int32_t game_rack(uint32_t s, uint32_t f)
{
    const param_desc_t *d;
    return f < 7u ? *rack_field(s, f, &d) : 0;
}
EXPORT(game_rack_set) void game_rack_set(uint32_t s, uint32_t f, int32_t v)
{
    const param_desc_t *d;
    int16_t *p;
    if (f >= 7u)
        return;
    p = rack_field(s, f, &d);
    v = clamp(v, d->min, d->max);
    if (f == 0u) {
        uint32_t flags = motion_guard();
        rack_select(s, v);
        motion_unguard(flags);
    } else
        *p = (int16_t)v;
    ui.force = 1;
}

/* a part's sounding voices (not fading: voice.c voices_busy), for the page's activity lights */
EXPORT(game_track_active) uint32_t game_track_active(uint32_t t)
{
    uint32_t i, n = 0;
    if (t >= NPART)
        return 0;
    for (i = 0; i < NVOICE; i++)
        n += trk[t].v[i].active && trk[t].v[i].stage != 4u;
    return n;
}
