// The note highway: notes fall onto a piano keyboard; the player's notes (as the Melodee engine heard
// them) are judged against the chart by pitch and time.

import { beatAt } from "./songs.js";

export const WINDOWS = [                        // seconds either side of the note
  { name: "PERFECT", w: 0.05, pts: 300, color: "#9ff0ff" },
  { name: "GREAT", w: 0.1, pts: 200, color: "#8ff0b0" },
  { name: "GOOD", w: 0.15, pts: 100, color: "#ffd6a0" },
];
const MISS = { name: "MISS", color: "#ff6b81" };
const DEVICE_LO = 53, DEVICE_HI = 79;           // the FM-1's 27 keys at the default octave: F3..G5 (computer keys)
// keyboard sizes -> their usual range as MIDI notes (C4 = 60)
export const KEYBOARDS = {
  25: [60, 84],                                 // C4..C6
  37: [48, 84],                                 // C3..C6
  49: [36, 84],                                 // C2..C6
  61: [36, 96],                                 // C2..C7
  73: [28, 100],                                // E1..E7
};
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// the computer keys of the FM-1's keys (Melodee's tracker layout), key 0 = F3 at the default octave
const COMPUTER = ["Z", "S", "X", "D", "C", "F", "V", "B", "H", "N", "J", "M", ",", "L", ".", ";", "/", "4", "R", "T", "6", "Y", "7", "U", "I", "9", "O"];
const isBlack = (p) => BLACK[p % 12] === 1;
const KEY_LIT_WHITE = "#4ea8ff", KEY_LIT_BLACK = "#ffd23f";   // a pressed key's light (and its column's in free play)
const COLUMN_FADE = 450;                        // ms a column takes to fade once its key is let go
export const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);

export class Game {
  constructor(canvas, { now, onHud, onEnd, onPianoKey }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.now = now;
    this.onHud = onHud;
    this.onEnd = onEnd;
    this.onPianoKey = onPianoKey;
    this.speed = 260;                           // px per second, at a 600 px tall highway
    this.offset = 0;                            // s, added to the chart (positive: notes expected later)
    this.showLetters = true;
    this.chart = null;
    this.t0 = null;                             // audio time of chart time 0 (null: not playing)
    this.held = new Map();                      // pitch -> {flash color, until}
    this.setTheme({ top: "5,13,27", mid: "10,29,53", bottom: "15,44,74", glow: "111,227,212", text: "232,244,255",
                    accent: "255,122,133", warm: "255,214,160", ink: "6,35,63", base: "6,14,28" });   // (app.js: the device's palette)
    this.columns = new Map();                   // free play: pitch -> {on, off (ms)}: its column lit, fading once let go
    this.pops = [];                             // judgment texts
    this.setKeyboard(49);
    this.bindPointer();
    this.reset();
  }

  // the highway's colours (each "r,g,b"): top / mid / bottom of the water, glow (the hit line's), text, accent, warm, ink
  // (text on a note), base (under the keys)
  setTheme(t) { this.th = t; }

  /* ---- chart and session */
  load(chart) {
    this.chart = { ...chart, notes: chart.notes.map((n) => ({ ...n, j: null })) };
    this.stop();
  }
  // the piano: a keyboard size (25 37 49 61 73) at its usual range, moved by whole octaves
  setKeyboard(size, shift = 0) {
    const [lo, hi] = KEYBOARDS[size] || KEYBOARDS[37];
    this.size = size;
    this.shift = shift;
    this.setRange(lo + 12 * shift, hi + 12 * shift);
  }
  outOfRange() { return this.chart ? this.chart.notes.filter((n) => n.p < this.lo || n.p > this.hi).length : 0; }
  reset() {
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.judged = 0; this.weight = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.pops = [];
    if (this.chart) for (const n of this.chart.notes) n.j = null;
    this.hud();
  }
  start(t0) { this.reset(); this.t0 = t0; }
  stop() { this.t0 = null; this.reset(); }
  get playing() { return this.t0 !== null; }
  songTime() { return this.playing ? this.now() - this.t0 : -1; }

  /* ---- input: the engine's notes, audio-clock stamped */
  noteOn(p, t) {
    this.columns.set(p, { on: true, off: 0 });
    this.held.set(p, { color: "#ffffff", until: 0 });
    if (!this.playing) return;
    const st = t - this.t0 - this.offset;
    let best = null, bestErr = Infinity;
    for (const n of this.chart.notes) {
      if (n.j || n.p !== p) continue;
      const err = Math.abs(st - n.t);
      if (err <= WINDOWS[2].w && err < bestErr) { best = n; bestErr = err; }
      if (n.t > st + WINDOWS[2].w) break;     // (notes are in time order)
    }
    if (!best) return;                          // a stray note: no penalty
    const win = WINDOWS.find((w) => bestErr <= w.w);
    // one press plays every note of this key at that moment (notes folded onto the same key: each one counts)
    for (const n of this.chart.notes) {
      if (n !== best && (n.j || n.p !== p || Math.abs(n.t - best.t) > 0.03)) continue;
      n.j = win.name;
      n.err = st - n.t;
      this.counts[win.name]++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(win.pts * (1 + Math.min(this.combo, 100) / 100));
      this.judged++;
      this.weight += win.pts / 300;
      if (n.t > best.t + 0.03) break;
    }
    this.held.set(p, { color: win.color, until: performance.now() + 180 });
    this.pop(win.name + (win.name === "PERFECT" ? "" : best.err < 0 ? " · early" : " · late"), win.color, p);
    this.hud();
  }
  noteOff(p) {
    this.held.delete(p);
    const c = this.columns.get(p);
    if (c) { c.on = false; c.off = performance.now(); }
  }
  clearHeld() { this.held.clear(); this.columns.clear(); }

  pop(text, color, p) {
    this.pops.push({ text, color, x: this.keyX(p).c, born: performance.now() });
    if (this.pops.length > 8) this.pops.shift();
  }
  hud() {
    const total = this.chart ? this.chart.notes.length : 0;
    this.onHud && this.onHud({
      score: this.score, combo: this.combo, maxCombo: this.maxCombo, counts: this.counts, total,
      accuracy: this.judged + this.counts.MISS ? (100 * this.weight) / (this.judged + this.counts.MISS) : 100,
    });
  }
  results() {
    const total = this.chart.notes.length, acc = total ? (100 * this.weight) / total : 0;
    const grade = acc >= 95 ? "S" : acc >= 88 ? "A" : acc >= 75 ? "B" : acc >= 60 ? "C" : "D";
    return { score: this.score, maxCombo: this.maxCombo, counts: this.counts, total, accuracy: acc, grade, weight: this.weight, judged: this.judged,
             fullCombo: this.counts.MISS === 0 && this.judged === total };
  }

  /* ---- geometry */
  setRange(lo, hi) {
    this.lo = lo; this.hi = hi;
    this.whites = [];
    for (let p = lo; p <= hi; p++) if (!isBlack(p)) this.whites.push(p);
  }
  layout() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = dpr;
    this.W = w; this.H = h;
    this.kbH = Math.min(h * 0.2, 150 * dpr);
    this.hitY = h - this.kbH - 6 * dpr;
    this.ww = w / this.whites.length;
  }
  keyX(p) {                                     // {x, w, c}: the key's column
    let i = 0;
    for (; i < this.whites.length && this.whites[i] < p; i++);
    if (!isBlack(p)) return { x: i * this.ww, w: this.ww, c: (i + 0.5) * this.ww };
    const bw = this.ww * 0.62, c = i * this.ww;
    return { x: c - bw / 2, w: bw, c };
  }
  keyAt(x, y) {                                 // the piano key under a canvas point (or null)
    if (y < this.H - this.kbH) return null;
    if (y < this.H - this.kbH * 0.38)
      for (let p = this.lo; p <= this.hi; p++)
        if (isBlack(p)) { const k = this.keyX(p); if (x >= k.x && x < k.x + k.w) return p; }
    const i = Math.floor(x / this.ww);
    return this.whites[Math.max(0, Math.min(this.whites.length - 1, i))];
  }
  bindPointer() {
    const down = new Map();
    const at = (e) => { const r = this.cv.getBoundingClientRect(); return this.keyAt((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr); };
    this.cv.addEventListener("pointerdown", (e) => {
      const p = at(e);
      if (p == null) return;
      e.preventDefault();
      this.cv.setPointerCapture(e.pointerId);
      down.set(e.pointerId, p);
      this.onPianoKey(p, true);
    });
    const up = (e) => { if (down.has(e.pointerId)) { this.onPianoKey(down.get(e.pointerId), false); down.delete(e.pointerId); } };
    this.cv.addEventListener("pointerup", up);
    this.cv.addEventListener("pointercancel", up);
    this.cv.addEventListener("pointermove", (e) => {   // glissando
      if (!down.has(e.pointerId)) return;
      const p = at(e);
      if (p != null && p !== down.get(e.pointerId)) { this.onPianoKey(down.get(e.pointerId), false); down.set(e.pointerId, p); this.onPianoKey(p, true); }
    });
  }

  /* ---- each animation frame */
  frame() {
    if (!this.cv.offsetParent) return;          // (hidden: the drums alone)
    this.layout();
    const { ctx, W, H, dpr, hitY } = this;
    const st = this.songTime(), pxs = (this.speed * H) / (600 * dpr) * dpr;
    const yOf = (t) => hitY - (t - st) * pxs;

    // misses
    if (this.playing) {
      for (const n of this.chart.notes)
        if (!n.j && st - this.offset > n.t + WINDOWS[2].w) {
          n.j = "MISS"; this.counts.MISS++; this.combo = 0; this.pop("MISS", MISS.color, n.p); this.hud();
        }
      if (st > this.chart.length + 1.2) { const r = this.results(); this.t0 = null; this.onEnd && this.onEnd(r); }
    }

    // ground: open water, darker at depth; a soft light from the surface; dotted dividers at each C only
    const g0 = ctx.createLinearGradient(0, 0, 0, hitY);
    g0.addColorStop(0, `rgb(${this.th.top})`);
    g0.addColorStop(0.65, `rgb(${this.th.mid})`);
    g0.addColorStop(1, `rgb(${this.th.bottom})`);
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);
    const lightX = W * 0.62, glow = ctx.createRadialGradient(lightX, hitY, 0, lightX, hitY, Math.max(W, hitY) * 0.8);
    glow.addColorStop(0, `rgba(${this.th.glow},0.10)`);
    glow.addColorStop(1, `rgba(${this.th.glow},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, hitY);
    ctx.lineWidth = dpr;
    ctx.setLineDash([2 * dpr, 7 * dpr]);
    ctx.strokeStyle = `rgba(${this.th.text},0.16)`;
    this.whites.forEach((p, i) => {
      if (p % 12 !== 0 || i === 0) return;
      ctx.beginPath(); ctx.moveTo(i * this.ww, 0); ctx.lineTo(i * this.ww, hitY); ctx.stroke();
    });
    ctx.setLineDash([]);

    if (!this.playing) this.drawColumns();     // free play: the keys' columns light up

    // beat and bar lines
    if (this.chart && this.playing) {
      const bar = this.chart.beatsPerBar || 4, tTop = st + hitY / pxs;
      let b = 0;
      while (beatAt(this.chart, b) < st - 1) b++;                  // (the first beat still on screen)
      for (; beatAt(this.chart, b) <= tTop && b < 100000; b++) {
        const y = yOf(beatAt(this.chart, b) + this.offset);
        ctx.strokeStyle = b % bar === 0 ? `rgba(${this.th.text},0.16)` : `rgba(${this.th.text},0.05)`;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    }

    // ghosts: notes outside the keys the device plays for you (Outside: Auto-play): faint, at the edge, never judged
    if (this.chart && this.playing && this.chart.ghosts) {
      const ew = Math.max(this.ww * 0.6, 10 * dpr);
      ctx.fillStyle = `rgba(${this.th.text},0.18)`;
      for (const n of this.chart.ghosts) {
        const t = n.t + this.offset, y0 = yOf(t), y1 = yOf(t + n.d);
        if (y1 > hitY || y0 < -40) continue;
        const x = n.p < this.lo ? 0 : W - ew;
        roundRect(ctx, x + dpr, y1, ew - 2 * dpr, Math.max(y0 - y1, 8 * dpr), Math.min(6 * dpr, ew / 2));
        ctx.fill();
      }
    }

    // notes: blue for white keys, yellow for black keys (free play: none)
    if (this.chart && this.playing) {
      const r = Math.min(9 * dpr, this.ww * 0.42);                    // (capsules)
      ctx.font = `700 ${Math.min(10 * dpr, this.ww * 0.34)}px Sora, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const n of this.chart.notes) {
        const t = n.t + this.offset, y0 = yOf(t), y1 = yOf(t + n.d);
        if (y1 > H || y0 < -40) continue;
        const out = n.p < this.lo ? -1 : n.p > this.hi ? 1 : 0;   // off this keyboard: pinned to its edge, faint
        const ew = Math.max(this.ww * 0.6, 10 * dpr);
        const k = out ? { x: out < 0 ? 0 : W - ew, w: ew, c: out < 0 ? ew / 2 : W - ew / 2 } : this.keyX(n.p);
        const black = isBlack(n.p), pad = out || black ? 1 * dpr : 3 * dpr;
        const x = k.x + pad, w = k.w - 2 * pad, top = y1, h = Math.min(Math.max(y0 - y1, 10 * dpr), hitY + 60 * dpr - top);
        if (out && !n.j) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "#ffffff";
          ctx.fillText(out < 0 ? "◀" : "▶", k.c, y0 - 7 * dpr);
        }
        if (n.j === "MISS") {
          ctx.fillStyle = `rgba(${this.th.text},0.16)`;
          roundRect(ctx, x, top, w, h, r);
          ctx.fill();
        } else if (n.j) {                         // a hit: flashes in its judgment's colour and fades
          const age = st - this.offset - n.t;
          if (age > 0.25 && y1 > hitY) continue;
          ctx.globalAlpha = Math.max(0.12, 1 - age * 2);
          ctx.fillStyle = WINDOWS.find((v) => v.name === n.j).color;
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 16 * dpr;
          roundRect(ctx, x, top, w, h, r);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.shadowColor = black ? "rgba(255,210,63,0.7)" : "rgba(78,168,255,0.7)";
          ctx.shadowBlur = 10 * dpr;
          ctx.fillStyle = black ? KEY_LIT_BLACK : KEY_LIT_WHITE;
          roundRect(ctx, x, top, w, h, r);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = black ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.30)";   // a soft sheen down the left
          roundRect(ctx, x + w * 0.12, top + 2 * dpr, Math.max(1.5 * dpr, w * 0.16), Math.max(0, h - 4 * dpr), r);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.9)";                // the head: where to press
          roundRect(ctx, x + 2 * dpr, y0 - 3.5 * dpr, w - 4 * dpr, 2.5 * dpr, 1.25 * dpr);
          ctx.fill();
          if (!out && this.ww > 22 * dpr && !black) { ctx.fillStyle = `rgb(${this.th.ink})`; ctx.fillText(noteName(n.p), k.c, y0 - 6 * dpr); }
        }
        ctx.globalAlpha = 1;
      }
    }

    // the hit line: a shoreline of sea-foam
    const g = ctx.createLinearGradient(0, hitY - 26 * dpr, 0, hitY + 2 * dpr);
    g.addColorStop(0, `rgba(${this.th.glow},0)`);
    g.addColorStop(1, `rgba(${this.th.glow},0.22)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, hitY - 26 * dpr, W, 28 * dpr);
    ctx.fillStyle = `rgba(${this.th.text},0.9)`;
    ctx.fillRect(0, hitY - dpr, W, 2 * dpr);

    this.drawKeyboard();

    // judgment pops and combo
    const nowMs = performance.now();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.pops = this.pops.filter((p) => nowMs - p.born < 650);
    for (const p of this.pops) {
      const a = (nowMs - p.born) / 650;
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = p.color;
      ctx.font = `800 ${13 * dpr}px Sora, system-ui, sans-serif`;
      ctx.fillText(p.text, Math.max(60 * dpr, Math.min(W - 60 * dpr, p.x)), hitY - 34 * dpr - a * 30 * dpr);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (this.playing && this.combo >= 5 && st > 0.6) {
      const size = Math.min(96, W / dpr / 6) * dpr;
      ctx.fillStyle = `rgba(${this.th.warm},0.13)`;
      ctx.font = `800 ${size}px Sora, system-ui, sans-serif`;
      ctx.fillText(String(this.combo), W / 2, hitY * 0.42);
      ctx.font = `700 ${12 * dpr}px Sora, system-ui, sans-serif`;
      ctx.fillText("COMBO", W / 2, hitY * 0.42 + size * 0.62);
    }
    if (this.playing && st < 0.6) {             // count-in: GET READY, the beats left, then GO!
      const spb = beatAt(this.chart, 1) - beatAt(this.chart, 0), cy = hitY * 0.4;
      if (st < 0) {
        const left = Math.ceil(-st / spb), frac = (-st / spb) % 1 || 1;   // (each number swells on its beat)
        ctx.fillStyle = `rgb(${this.th.glow})`;
        ctx.font = `700 ${14 * dpr}px Sora, system-ui, sans-serif`;
        ctx.fillText("Get ready", W / 2, cy - 70 * dpr);
        ctx.globalAlpha = 0.35 + 0.65 * frac;
        ctx.fillStyle = `rgb(${this.th.text})`;
        ctx.font = `800 ${(64 + 26 * frac) * dpr}px Sora, system-ui, sans-serif`;
        ctx.fillText(String(left), W / 2, cy);
      } else {
        ctx.globalAlpha = 1 - st / 0.6;
        ctx.fillStyle = `rgb(${this.th.accent})`;
        ctx.font = `800 ${80 * dpr}px Sora, system-ui, sans-serif`;
        ctx.fillText("Go!", W / 2, cy);
      }
      ctx.globalAlpha = 1;
    }
  }

  // free play: each pressed key lights its whole column (brightest at the keys), fading out once let go
  drawColumns() {
    const { ctx, hitY, dpr } = this, now = performance.now();
    for (const [p, c] of this.columns) {
      const a = c.on ? 1 : 1 - (now - c.off) / COLUMN_FADE;
      if (a <= 0) { this.columns.delete(p); continue; }
      if (p < this.lo || p > this.hi) continue;
      const k = this.keyX(p), black = isBlack(p), rgb = black ? "255,210,63" : "78,168,255";
      const g = ctx.createLinearGradient(0, hitY, 0, 0);
      g.addColorStop(0, `rgba(${rgb},${0.55 * a})`);
      g.addColorStop(0.45, `rgba(${rgb},${0.18 * a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(k.x, 0, k.w, hitY);
      ctx.fillStyle = `rgba(255,255,255,${0.35 * a})`;           // a bright core down the middle
      ctx.fillRect(k.c - dpr, hitY * 0.35, 2 * dpr, hitY * 0.65);
      ctx.shadowColor = `rgba(${rgb},${a})`;                    // and a flare where it meets the keys
      ctx.shadowBlur = 18 * dpr;
      ctx.fillStyle = `rgba(${rgb},${0.9 * a})`;
      ctx.fillRect(k.x, hitY - 3 * dpr, k.w, 3 * dpr);
      ctx.shadowBlur = 0;
    }
    if (!this.columns.size) {                                     // a quiet hint
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(${this.th.text},0.45)`;
      ctx.font = `600 ${13 * dpr}px Sora, system-ui, sans-serif`;
      ctx.fillText("Free play · press any key, or Play to start the song", this.W / 2, hitY * 0.45);
    }
  }

  drawKeyboard() {
    const { ctx, W, H, dpr, kbH, ww } = this, top = H - kbH, nowMs = performance.now();
    ctx.fillStyle = `rgb(${this.th.base})`;
    ctx.fillRect(0, top - 4 * dpr, W, kbH + 4 * dpr);
    const lit = (p) => {                         // a held key: its judgment's colour a moment, then its notes' colour
      const h = this.held.get(p);
      if (!h) return null;
      return h.until > nowMs ? h.color : isBlack(p) ? KEY_LIT_BLACK : KEY_LIT_WHITE;
    };
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    this.whites.forEach((p, i) => {
      const c = lit(p);
      if (c) { ctx.shadowColor = c; ctx.shadowBlur = 16 * dpr; ctx.fillStyle = c; }
      else {
        const gw = ctx.createLinearGradient(0, top, 0, H);
        gw.addColorStop(0, "#c9d8ea"); gw.addColorStop(0.15, "#f4f8fd"); gw.addColorStop(1, "#e2ebf6");
        ctx.fillStyle = gw;
      }
      roundRect(ctx, i * ww + dpr, top, ww - 2 * dpr, kbH - 2 * dpr, 3 * dpr);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = c ? `rgb(${this.th.ink})` : "#5a7394";
      ctx.font = `700 ${Math.min(9 * dpr, ww * 0.3)}px Sora, system-ui, sans-serif`;
      if (p % 12 === 0) ctx.fillText(noteName(p), i * ww + ww / 2, H - 6 * dpr);
      if (this.showLetters && p >= DEVICE_LO && p <= DEVICE_HI && ww > 16 * dpr) {
        ctx.fillStyle = c ? `rgb(${this.th.ink})` : "#93a8c2";
        ctx.fillText(COMPUTER[p - DEVICE_LO], i * ww + ww / 2, H - (p % 12 === 0 ? 20 : 6) * dpr);
      }
    });
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlack(p)) continue;
      const k = this.keyX(p), c = lit(p);
      if (c) { ctx.shadowColor = c; ctx.shadowBlur = 16 * dpr; ctx.fillStyle = c; }
      else {
        const gb = ctx.createLinearGradient(0, top, 0, top + kbH * 0.62);
        gb.addColorStop(0, "#2a3c58"); gb.addColorStop(0.85, "#0b1424"); gb.addColorStop(1, "#1c2a40");
        ctx.fillStyle = gb;
      }
      roundRect(ctx, k.x, top, k.w, kbH * 0.62, 2 * dpr);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (this.showLetters && p >= DEVICE_LO && p <= DEVICE_HI && k.w > 12 * dpr) {
        ctx.fillStyle = c ? "#2a1f00" : "#8ea6c4";
        ctx.font = `700 ${Math.min(9 * dpr, k.w * 0.42)}px Sora, system-ui, sans-serif`;
        ctx.fillText(COMPUTER[p - DEVICE_LO], k.c, top + kbH * 0.62 - 5 * dpr);
      }
    }
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
