// The drum highway: General MIDI drum notes fall into eight lanes onto pads; the player's hits (an e-drum kit or pad
// controller over MIDI, the computer keys, or the pads on screen) are judged by lane and time. The device's drum
// track (part 2, MIDI channel 2) plays them.

import { beatAt } from "./songs.js";
import { WINDOWS, roundRect } from "./game.js";

const MISS = { name: "MISS", color: "#ff6b81" };
// the lanes, left to right: the General MIDI notes each takes, the note a pad plays, its computer key, its colour (fixed,
// as drum games colour a kit: the snare yellow, the toms green / red / orange, the kick violet, the cymbals pink and blues);
// every pad a plain circle
export const LANES = [
  { name: "Crash", notes: [49, 52, 55, 57], play: 49, key: "A", color: "255,79,163" },
  { name: "Hi-hat", notes: [42, 44, 46], play: 42, key: "S", color: "63,169,255" },
  { name: "Snare", notes: [37, 38, 39, 40], play: 38, key: "D", color: "255,210,63" },
  { name: "Kick", notes: [35, 36], play: 36, key: "F", color: "154,123,255" },
  { name: "Tom 1", notes: [48, 50], play: 48, key: "J", color: "79,224,122" },
  { name: "Tom 2", notes: [45, 47], play: 45, key: "K", color: "255,90,79" },
  { name: "Floor", notes: [41, 43], play: 43, key: "L", color: "255,154,60" },
  { name: "Ride", notes: [51, 53, 59], play: 51, key: ";", color: "79,139,255" },
];
export const DRUM_KEYS = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyJ: 4, KeyK: 5, KeyL: 6, Semicolon: 7 };
const LANE_OF = new Map(LANES.flatMap((l, i) => l.notes.map((n) => [n, i])));
export const laneOf = (note) => (LANE_OF.has(note) ? LANE_OF.get(note) : -1);   // (-1: a drum the lanes do not have)
const FADE = 260;                                 // ms a lane's light takes to fade after a hit

export class DrumGame {
  constructor(canvas, { now, onHud, onEnd, onPad }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.now = now;
    this.onHud = onHud;
    this.onEnd = onEnd;
    this.onPad = onPad;
    this.speed = 260;
    this.offset = 0;
    this.chart = null;
    this.t0 = null;
    this.flash = new Map();                       // lane -> {at (ms), color}
    this.pops = [];
    this.th = { top: "5,13,27", mid: "10,29,53", bottom: "15,44,74", glow: "111,227,212", text: "232,244,255",
                accent: "255,122,133", warm: "255,214,160", ink: "6,35,63", base: "6,14,28", accent2: "142,164,206" };
    this.bindPointer();
    this.reset();
  }
  setTheme(t) { this.th = { ...this.th, ...t }; }
  laneColor(i) { return LANES[i].color; }

  /* ---- chart and session (the chart's drum notes: chart.drums, each with its lane) */
  load(chart) {
    this.chart = { ...chart, notes: (chart.drums || []).map((n) => ({ ...n, lane: laneOf(n.p), j: null })).filter((n) => n.lane >= 0) };
    this.stop();
  }
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

  /* ---- a hit on lane `lane` at audio time t */
  hit(lane, t) {
    if (lane < 0 || lane >= LANES.length) return;
    this.flash.set(lane, { at: performance.now(), color: null });
    if (!this.playing) return;
    const st = t - this.t0 - this.offset;
    let best = null, bestErr = Infinity;
    for (const n of this.chart.notes) {
      if (n.j || n.lane !== lane) continue;
      const err = Math.abs(st - n.t);
      if (err <= WINDOWS[2].w && err < bestErr) { best = n; bestErr = err; }
      if (n.t > st + WINDOWS[2].w) break;
    }
    if (!best) return;                            // a stray hit: no penalty
    const win = WINDOWS.find((w) => bestErr <= w.w);
    best.j = win.name;
    best.err = st - best.t;
    this.counts[win.name]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(win.pts * (1 + Math.min(this.combo, 100) / 100));
    this.judged++;
    this.weight += win.pts / 300;
    this.flash.set(lane, { at: performance.now(), color: win.color });
    this.pop(win.name + (win.name === "PERFECT" ? "" : best.err < 0 ? " · early" : " · late"), win.color, lane);
    this.hud();
  }
  pop(text, color, lane) {
    this.pops.push({ text, color, lane, born: performance.now() });
    if (this.pops.length > 8) this.pops.shift();
  }
  hud() { this.onHud && this.onHud(); }
  results() {
    const total = this.chart ? this.chart.notes.length : 0;
    return { score: this.score, maxCombo: this.maxCombo, counts: this.counts, total, weight: this.weight, judged: this.judged };
  }

  /* ---- geometry: equal lanes; the pads under the hit line */
  layout() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = dpr; this.W = w; this.H = h;
    this.padH = Math.min(h * 0.2, 150 * dpr);
    this.hitY = h - this.padH - 6 * dpr;
    this.lw = w / LANES.length;
  }
  laneAt(x, y) { return y >= this.hitY ? Math.max(0, Math.min(LANES.length - 1, Math.floor(x / this.lw))) : null; }
  bindPointer() {
    this.cv.addEventListener("pointerdown", (e) => {
      const r = this.cv.getBoundingClientRect(), lane = this.laneAt((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      if (lane === null) return;
      e.preventDefault();
      this.onPad(lane);
    });
  }

  frame() {
    if (!this.cv.offsetParent) return;            // (hidden: not drawn)
    this.layout();
    const { ctx, W, H, dpr, hitY, lw } = this, th = this.th;
    const st = this.songTime(), pxs = (this.speed * H) / 600;
    const yOf = (t) => hitY - (t - st) * pxs;
    if (this.playing) {
      for (const n of this.chart.notes)
        if (!n.j && st - this.offset > n.t + WINDOWS[2].w) {
          n.j = "MISS"; this.counts.MISS++; this.combo = 0; this.pop("MISS", MISS.color, n.lane); this.hud();
        }
      if (st > this.chart.length + 1.2) { const r = this.results(); this.t0 = null; this.onEnd && this.onEnd(r); }
    }

    // ground and lanes
    const g0 = ctx.createLinearGradient(0, 0, 0, hitY);
    g0.addColorStop(0, `rgb(${th.top})`); g0.addColorStop(0.65, `rgb(${th.mid})`); g0.addColorStop(1, `rgb(${th.bottom})`);
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);
    const now = performance.now();
    LANES.forEach((l, i) => {
      const tint = ctx.createLinearGradient(0, 0, 0, hitY);     // each lane faintly in its colour, a little more at the pads
      tint.addColorStop(0, `rgba(${l.color},0.03)`);
      tint.addColorStop(1, `rgba(${l.color},0.11)`);
      ctx.fillStyle = tint;
      ctx.fillRect(i * lw, 0, lw, hitY);
      const f = this.flash.get(i), a = f ? 1 - (now - f.at) / FADE : 0;   // a hit lights its lane
      if (a > 0) {
        const g = ctx.createLinearGradient(0, hitY, 0, 0);
        g.addColorStop(0, `rgba(${this.laneColor(i)},${0.5 * a})`);
        g.addColorStop(1, `rgba(${this.laneColor(i)},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(i * lw, 0, lw, hitY);
      } else if (f) this.flash.delete(i);
    });
    ctx.strokeStyle = `rgba(${th.text},0.12)`;
    ctx.lineWidth = dpr;
    for (let i = 1; i < LANES.length; i++) { ctx.beginPath(); ctx.moveTo(i * lw, 0); ctx.lineTo(i * lw, hitY); ctx.stroke(); }

    if (this.chart && this.playing) {
      const bar = this.chart.beatsPerBar || 4, tTop = st + hitY / pxs;
      let b = 0;
      while (beatAt(this.chart, b) < st - 1) b++;
      for (; beatAt(this.chart, b) <= tTop && b < 100000; b++) {
        const y = yOf(beatAt(this.chart, b) + this.offset);
        ctx.strokeStyle = b % bar === 0 ? `rgba(${th.text},0.16)` : `rgba(${th.text},0.05)`;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // the gems: a lane's colour; a hit flashes in its judgment's colour and fades
      const gh = Math.max(10 * dpr, Math.min(18 * dpr, lw * 0.22));
      for (const n of this.chart.notes) {
        const y = yOf(n.t + this.offset);
        if (y < -gh || y > H) continue;
        const x = n.lane * lw + 5 * dpr, w = lw - 10 * dpr;
        if (n.j === "MISS") { ctx.fillStyle = `rgba(${th.text},0.14)`; roundRect(ctx, x, y - gh, w, gh, gh / 2); ctx.fill(); continue; }
        if (n.j) {
          const age = st - this.offset - n.t;
          if (age > 0.25) continue;
          ctx.globalAlpha = Math.max(0.1, 1 - age * 4);
          ctx.fillStyle = WINDOWS.find((v) => v.name === n.j).color;
        } else ctx.fillStyle = `rgb(${this.laneColor(n.lane)})`;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10 * dpr;
        roundRect(ctx, x, y - gh, w, gh, gh / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (!n.j) { ctx.fillStyle = "rgba(255,255,255,0.55)"; roundRect(ctx, x + w * 0.2, y - gh + 2 * dpr, w * 0.6, 2.5 * dpr, 1.25 * dpr); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }

    // the hit line, then the pads
    const g = ctx.createLinearGradient(0, hitY - 26 * dpr, 0, hitY + 2 * dpr);
    g.addColorStop(0, `rgba(${th.glow},0)`); g.addColorStop(1, `rgba(${th.glow},0.22)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, hitY - 26 * dpr, W, 28 * dpr);
    ctx.fillStyle = `rgba(${th.text},0.9)`;
    ctx.fillRect(0, hitY - dpr, W, 2 * dpr);
    ctx.fillStyle = `rgb(${th.base})`;
    ctx.fillRect(0, hitY + dpr, W, H - hitY);
    ctx.textAlign = "center";
    LANES.forEach((l, i) => {
      const cx = i * lw + lw / 2, cy = hitY + (H - hitY) / 2, r = Math.min(lw * 0.4, (H - hitY) * 0.38);
      const f = this.flash.get(i), a = f ? Math.max(0, 1 - (now - f.at) / FADE) : 0, c = l.color;
      ctx.fillStyle = `rgba(${c},${0.16 + 0.7 * a})`;
      ctx.strokeStyle = `rgb(${c})`;
      if (a > 0) { ctx.shadowColor = `rgb(${c})`; ctx.shadowBlur = 18 * dpr * a; }
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);   // a plain circle, in the drum's colour
      ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
      ctx.fillStyle = `rgb(${th.text})`;
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.min(11 * dpr, lw * 0.16)}px Sora, system-ui, sans-serif`;
      ctx.fillText(l.name, cx, cy - (r > 22 * dpr ? 5 * dpr : 0));
      if (r > 22 * dpr) {
        ctx.fillStyle = `rgba(${th.text},0.6)`;
        ctx.font = `600 ${Math.min(10 * dpr, lw * 0.14)}px "JetBrains Mono", monospace`;
        ctx.fillText(l.key, cx, cy + 9 * dpr);
      }
    });

    // judgment pops, the combo, the count-in, the free-play hint
    ctx.textBaseline = "middle";
    this.pops = this.pops.filter((p) => now - p.born < 650);
    for (const p of this.pops) {
      const a = (now - p.born) / 650;
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = p.color;
      ctx.font = `800 ${12 * dpr}px Sora, system-ui, sans-serif`;
      ctx.fillText(p.text.replace(" · ", " "), Math.max(44 * dpr, Math.min(W - 44 * dpr, p.lane * lw + lw / 2)), hitY - 34 * dpr - a * 30 * dpr);
    }
    ctx.globalAlpha = 1;
    if (this.playing && this.combo >= 5 && st > 0.6) {
      const size = Math.min(80, W / dpr / 5) * dpr;
      ctx.fillStyle = `rgba(${th.warm},0.13)`;
      ctx.font = `800 ${size}px Sora, system-ui, sans-serif`;
      ctx.fillText(String(this.combo), W / 2, hitY * 0.42);
    }
    if (this.playing && st < 0.6) {
      const spb = beatAt(this.chart, 1) - beatAt(this.chart, 0), cy = hitY * 0.4;
      if (st < 0) {
        const left = Math.ceil(-st / spb), frac = (-st / spb) % 1 || 1;
        ctx.globalAlpha = 0.35 + 0.65 * frac;
        ctx.fillStyle = `rgb(${th.text})`;
        ctx.font = `800 ${(56 + 22 * frac) * dpr}px Sora, system-ui, sans-serif`;
        ctx.fillText(String(left), W / 2, cy);
      } else {
        ctx.globalAlpha = 1 - st / 0.6;
        ctx.fillStyle = `rgb(${th.accent})`;
        ctx.font = `800 ${70 * dpr}px Sora, system-ui, sans-serif`;
        ctx.fillText("Go!", W / 2, cy);
      }
      ctx.globalAlpha = 1;
    }
    if (!this.playing && !this.flash.size) {
      ctx.fillStyle = `rgba(${th.text},0.45)`;
      ctx.font = `600 ${13 * dpr}px Sora, system-ui, sans-serif`;
      ctx.fillText("Drums · hit a pad (or A S D F J K L ;)", W / 2, hitY * 0.45);
    }
  }
}
