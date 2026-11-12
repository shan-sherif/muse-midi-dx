// SPDX-License-Identifier: GPL-3.0-only
// The Melodee firmware (UI + sound engines, melodee.wasm) in an AudioWorklet. Based on Melodee's
// web/emu/worklet.js; adds, for the game:
//   - "notes" events: the pitches the player starts/stops on the selected track, stamped with the audio clock
//   - timed MIDI ("midiAt"): played when the audio clock reaches `at` (demo playback)
//   - the engine/preset catalogue and preset loading

const PARTS = [0, 1, 2, 3, 4, 5];                      // the six parts (patches/melodee-6parts.patch): 1 keys, 2 drums, 3..6

class MelodeeGame extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ex = null;
    this.timed = [];                       // [{at, data}] sorted by at
    this.held = new Uint32Array(4);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  str(p) {
    const b = new Uint8Array(this.mem.buffer, p);
    let s = "";
    for (let i = 0; b[i] && i < 64; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  catalogue() {
    const ex = this.ex, engines = [];
    for (let n = 0; n < ex.game_engine_count(); n++) {
      const id = ex.game_engine_id(n), name = this.str(ex.game_engine_name(id));
      if (name === "MIDI Track") continue;                 // silent (drives external gear)
      const presets = [];
      for (let k = 0; k < ex.game_preset_count(id); k++) presets.push(this.str(ex.game_preset_name(id, k)));
      const cats = presets.map((_, k) => ex.game_preset_cat(id, k));
      engines.push({ id, name, presets, cats });
    }
    return engines;
  }

  async onMessage(m) {
    if (m.type === "load") {
      const stub = new Proxy({}, { get: () => () => 0 });
      const { instance } = await WebAssembly.instantiate(m.wasm, { env: stub, wasi_snapshot_preview1: stub });
      const ex = instance.exports;
      ex._initialize();
      ex.web_boot(m.master);
      this.mem = ex.memory;
      this.sentFb = -1;
      this.last = 0;
      this.ex = ex;
      this.viewAt = currentTime + 1;       // the chord view once the boot screens are through
      const palettes = [];                 // the screen's palettes: name, then bg surf text accent track1..4 (RGB565)
      for (let i = 0; i < ex.game_palette_count(); i++)
        palettes.push({ name: this.str(ex.game_palette_name(i)), colors: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ex.game_palette_color(i, k)) });
      const lofi = palettes.findIndex((p) => p.name === "LO-FI");
      if (lofi >= 0) ex.game_palette_set(lofi);   // the screen in LO-FI (the page follows the device's palette)
      const categories = [];
      for (let c = 0; c < ex.game_cat_count(); c++) categories.push(this.str(ex.game_cat_name(c)));
      this.port.postMessage({ type: "ready", engines: this.catalogue(), categories, palettes, mix: this.mix(),
                             tracks: PARTS.map((t) => [ex.game_track_engine(t), ex.game_track_preset(t)]) });   // (power-on's)
      return;
    }
    const ex = this.ex;
    if (!ex) return;
    if (m.type === "keys") ex.web_keys(m.mask >>> 0);
    else if (m.type === "buttons") ex.web_buttons(m.mask >>> 0);
    else if (m.type === "encoder") ex.web_encoder(m.id, m.n | 0);
    else if (m.type === "master") ex.web_master(m.value | 0);
    else if (m.type === "midi") this.midi(m.data);
    else if (m.type === "midiAt") {
      this.timed.push({ at: m.at, data: m.data });
      this.timed.sort((a, b) => a.at - b.at);
    } else if (m.type === "clearTimed") {                 // (m.ch: one channel's only, 0..15; else all)
      const mine = (t) => m.ch === undefined || (t.data[0] & 15) === m.ch;
      for (const t of this.timed) if (mine(t) && t.data[0] >> 4 === 8) this.midi(t.data);   // release what is pending
      this.timed = this.timed.filter((t) => !mine(t));
    } else if (m.type === "preset") ex.game_load(m.engine >>> 0, m.preset >>> 0);
    else if (m.type === "view") ex.game_view();
    else if (m.type === "bpm") ex.game_set_bpm(Math.round(m.bpm) >>> 0);
    else if (m.type === "palette") ex.game_palette_set(m.index >>> 0);
    else if (m.type === "tparam") ex.game_tparam_set(m.track >>> 0, m.k >>> 0, m.v | 0);
    else if (m.type === "rack") ex.game_rack_set(m.slot >>> 0, m.f >>> 0, m.v | 0);
    else if (m.type === "setMix") {                  // a whole mix (restored, or the defaults)
      m.mix.tracks.forEach((row, t) => row.forEach((v, k) => ex.game_tparam_set(t, k, v)));
      m.mix.rack.forEach((row, sl) => row.forEach((v, f) => ex.game_rack_set(sl, f, v)));
      ex.game_rack_set(0, 5, m.mix.ret); ex.game_rack_set(0, 6, m.mix.mode);
    }
    else if (m.type === "getMix") this.port.postMessage({ type: "mix", mix: this.mix() });
    else if (m.type === "trackPreset") ex.game_load_track(m.track >>> 0, m.engine >>> 0, m.preset >>> 0);
  }

  midi(d) { this.ex.web_midi_in(d[0], d[1] || 0, d[2] || 0); }

  // the mixer (each part: level pan mute send send2 send3 send4) and the shared rack (4 slots: type mix rate char tone; return, mode)
  mix() {
    const ex = this.ex;
    return { tracks: PARTS.map((t) => [0, 1, 2, 3, 4, 5, 6].map((k) => ex.game_tparam(t, k))),
             rack: [0, 1, 2, 3].map((sl) => [0, 1, 2, 3, 4].map((f) => ex.game_rack(sl, f))),
             ret: ex.game_rack(0, 5), mode: ex.game_rack(0, 6) };
  }

  process(inputs, outputs) {
    const ex = this.ex;
    if (!ex) return true;
    while (this.timed.length && this.timed[0].at <= currentTime) this.midi(this.timed.shift().data);
    if (this.viewAt && currentTime >= this.viewAt) { this.viewAt = 0; ex.game_view(); }
    const out = outputs[0], n = out[0].length;
    try {
      ex.web_render(n);
    } catch (err) {
      this.ex = null;
      this.port.postMessage({ type: "crash", message: String((err && err.message) || err) });
      return true;
    }
    out[0].set(new Float32Array(this.mem.buffer, ex.web_out_l(), n));
    if (out[1]) out[1].set(new Float32Array(this.mem.buffer, ex.web_out_r(), n));

    // held-note changes on the selected track -> the game
    let on = null, off = null;
    for (let w = 0; w < 4; w++) {
      const now = ex.game_held(w) >>> 0, was = this.held[w];
      if (now === was) continue;
      for (let b = 0; b < 32; b++) {
        const bit = 1 << b;
        if ((now & bit) && !(was & bit)) (on ||= []).push(w * 32 + b);
        else if (!(now & bit) && (was & bit)) (off ||= []).push(w * 32 + b);
      }
      this.held[w] = now;
    }
    if (on || off) this.port.postMessage({ type: "notes", t: currentTime, on: on || [], off: off || [] });

    if (currentTime - this.last >= 1 / 30) {
      this.last = currentTime;
      const msg = { type: "frame", ms: ex.web_now(), keys: ex.web_led_keys() >>> 0, buttons: ex.web_led_buttons() >>> 0,
                    engine: ex.game_cur_engine(), preset: ex.game_cur_preset(),
                    tracks: PARTS.map((t) => [ex.game_track_engine(t), ex.game_track_preset(t)]),
                    palette: ex.game_palette_index(), act: PARTS.map((t) => ex.game_track_active(t)) };
      const gen = ex.web_fb_gen(), transfer = [];
      if (gen !== this.sentFb) {
        this.sentFb = gen;
        msg.fb = new Uint16Array(this.mem.buffer, ex.web_fb(), 240 * 240).slice();
        transfer.push(msg.fb.buffer);
      }
      this.port.postMessage(msg, transfer);
    }
    return true;
  }
}

registerProcessor("melodee-game", MelodeeGame);
