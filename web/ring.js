// The rhythm ring: the device screen's place when you play the drums (Drums, and Both). One turn is one bar, a hand
// sweeping round with the song; each lane is a ring in its kit colour (the cymbals outside, the toms and snare inward,
// the kick the centre). The chart's hits in this bar are hollow dots (red once missed); your hits are filled dots where
// they landed, so early or late shows against the target; the last bar's fade as the hand comes round. With no song
// playing, the hand runs at the song's tempo and your hits draw the same way (free play).
// Both: one more ring outside, the keys (their colour), the same way: the song's notes hollow, yours filled; the centre
// names what you hold (a chord, else the note), so hands and feet show against each other in the bar.

import { LANES } from "./drums.js";
import { beatAt } from "./songs.js";

// outside to inside, a drum staff read bottom to top: the kick (the staff's bottom space) outermost, Snare, the toms
// (Tom 1, Tom 2, Floor: one ring, each dot its own colour), Ride, Hi-hat, Crash innermost; the centre holds the beat.
// Both: the keys outside them all
const KEYS = "keys", TOMS = [4, 5, 6], TOM_RING = "toms";
const DRUM_RINGS = [3, 2, TOM_RING, 7, 1, 0], BOTH_RINGS = [KEYS, ...DRUM_RINGS];
const ringOf = (lane) => (TOMS.includes(lane) ? TOM_RING : lane);
const KICK = 3, MISS_RGB = "255,107,129", FLASH_MS = 220;

// what is held, named: a chord from its pitch classes (its root the lowest note that makes one; another bass: "/E"),
// else the note ("G4"), else the lowest and how many more ("C4 +1")
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORDS = [[[0, 4, 7], ""], [[0, 3, 7], "m"], [[0, 4, 7, 10], "7"], [[0, 4, 7, 11], "maj7"], [[0, 3, 7, 10], "m7"],
  [[0, 3, 7, 11], "mMaj7"], [[0, 3, 6], "dim"], [[0, 3, 6, 9], "dim7"], [[0, 3, 6, 10], "m7b5"], [[0, 4, 8], "aug"],
  [[0, 2, 7], "sus2"], [[0, 5, 7], "sus4"], [[0, 5, 7, 10], "7sus4"], [[0, 4, 7, 9], "6"], [[0, 3, 7, 9], "m6"],
  [[0, 2, 4, 7], "add9"], [[0, 2, 4, 7, 10], "9"], [[0, 2, 4, 7, 11], "maj9"], [[0, 2, 3, 7, 10], "m9"], [[0, 4, 10], "7"],
  [[0, 3, 10], "m7"], [[0, 4, 11], "maj7"], [[0, 7], "5"]];
const noteOf = (p) => PC[p % 12] + (Math.floor(p / 12) - 1);
export function chordName(pitches) {
  const ps = [...pitches].sort((a, b) => a - b);
  if (!ps.length) return "";
  if (ps.length === 1) return noteOf(ps[0]);
  const pcs = [...new Set(ps.map((p) => p % 12))];
  const bass = ps[0] % 12, roots = [bass, ...pcs.filter((c) => c !== bass)];
  for (const root of roots) {
    const iv = pcs.map((c) => (c - root + 12) % 12).sort((a, b) => a - b).join(",");
    const hit = CHORDS.find(([set]) => set.join(",") === iv);
    if (hit) return PC[root] + hit[1] + (root !== bass ? "/" + PC[bass] : "");
  }
  return pcs.length === 1 ? PC[bass] : `${noteOf(ps[0])} +${ps.length - 1}`;
}

// a time (song seconds) -> its beat, fractional (before the first beat and past the last: at the tempo there)
function beatOf(chart, t) {
  const b = chart.beats;
  if (!b || b.length < 2) return t / (60 / (chart.bpm || 120));
  if (t < b[0]) return (t - b[0]) / (b[1] - b[0]);
  const n = b.length - 1;
  if (t >= b[n]) return n + (t - b[n]) / (b[n] - b[n - 1]);
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m; }
  return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
}

export class RhythmRing {
  constructor(canvas, { drum, game, now, engines }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.drum = drum;
    this.game = game;                             // (Both: the keys' notes, and what is held)
    this.engines = engines || (() => ["", ""]);   // () -> [the Keys part's engine, the Drums part's] (the top right)
    this.both = false;
    this.keyFlash = 0;
    this.now = now;                               // audio time (s)
    this.chart = null;                            // the song as it would play (the ring's bars when idle)
    this.hits = [];                               // { lane, t: song seconds }
    this.flash = new Array(LANES.length).fill(0); // lane -> performance.now() of its last hit
    this.free0 = 0;                               // free play: the audio time its bar 1 began
    this.th = { bg: "16,20,28", text: "232,244,255", accent: "255,122,133", keys: "142,164,206" };
  }
  setTheme(t) { this.th = { ...this.th, ...t }; }
  setChart(chart) { this.chart = chart; this.hits = []; }
  // a hit on a lane at audio time t (yours or the CPU's)
  hit(lane, t) {
    if (lane < 0 || lane >= LANES.length) return;
    this.flash[lane] = performance.now();
    this.hits.push({ lane, t: this.songTime(t) });
    if (this.hits.length > 400) this.hits.splice(0, this.hits.length - 400);
  }
  // a key pressed (Both), yours or the CPU's, at audio time t
  keyHit(t) {
    if (!this.both) return;
    this.keyFlash = performance.now();
    this.hits.push({ lane: KEYS, t: this.songTime(t) });
    if (this.hits.length > 400) this.hits.splice(0, this.hits.length - 400);
  }
  // the ring's clock: the song's while it plays, else free play's (at the song's opening tempo)
  songTime(at = this.now()) {
    const d = this.drum;
    if (d.playing) return at - d.t0 - d.offset;
    if (!this.free0 || at - this.free0 > 3600) this.free0 = at;
    return at - this.free0;
  }
  start() { this.hits = []; }                     // (a new run: what was played before goes)

  frame() {
    const cv = this.cv;
    if (!cv.offsetParent || !this.chart) return;  // (hidden: not drawn)
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const S = Math.round(Math.min(r.width, r.height) * dpr);
    if (cv.width !== S || cv.height !== S) { cv.width = S; cv.height = S; }
    const ctx = this.ctx, th = this.th, chart = this.chart, playing = this.drum.playing;
    const bpb = chart.beatsPerBar || 4, now = performance.now();
    // free play: the song's opening tempo, bars from free0
    const clock = playing ? chart : { beats: null, bpm: chart.beats && chart.beats.length > 1 ? 60 / (chart.beats[1] - chart.beats[0]) : chart.bpm || 120 };
    const t = this.songTime(), beat = beatOf(clock, t), bar = Math.floor(beat / bpb), frac = (beat - bar * bpb) / bpb;
    const RINGS = this.both ? BOTH_RINGS : DRUM_RINGS;
    const cx = S / 2, cy = S / 2 + 6 * dpr, R = S * 0.4, r0 = S * 0.12, step = (R - r0) / (RINGS.length - 1);
    const radius = (lane) => R - RINGS.indexOf(ringOf(lane)) * step;
    const rgbOf = (lane) => (lane === KEYS ? th.keys : LANES[lane].color);
    const ang = (f) => -Math.PI / 2 + f * Math.PI * 2;
    const posOf = (tt) => { const b = beatOf(clock, tt), k = Math.floor(b / bpb); return { bar: k, f: (b - k * bpb) / bpb }; };
    const lit = (lane) => Math.max(0, 1 - (now - (lane === KEYS ? this.keyFlash : this.flash[lane])) / FLASH_MS);

    ctx.fillStyle = `rgb(${th.bg})`;
    ctx.fillRect(0, 0, S, S);
    // the beats: spokes, the bar's first brighter; sixteenths as ticks outside
    for (let k = 0; k < bpb * 4; k++) {
      const a = ang(k / (bpb * 4)), beatTick = k % 4 === 0;
      ctx.strokeStyle = `rgba(${th.text},${k === 0 ? 0.35 : beatTick ? 0.16 : 0.1})`;
      ctx.lineWidth = (beatTick ? 1.2 : 1) * dpr;
      ctx.beginPath();
      const a0 = beatTick ? r0 * 0.9 : R + 4 * dpr, a1 = R + (beatTick ? 10 : 7) * dpr;
      ctx.moveTo(cx + Math.cos(a) * a0, cy + Math.sin(a) * a0);
      ctx.lineTo(cx + Math.cos(a) * a1, cy + Math.sin(a) * a1);
      ctx.stroke();
    }
    // the lanes' rings (a hit: it lights). The toms' ring: segments in their three colours, round; a hit lights it in
    // the colour of the tom hit
    for (const lane of RINGS) {
      if (lane === TOM_RING) {
        const hot = TOMS.reduce((a, b) => (this.flash[b] > this.flash[a] ? b : a)), L = lit(hot), seg = (Math.PI * 2) / 24;
        ctx.lineWidth = (1 + 2.5 * L) * dpr;
        for (let k = 0; k < 24; k++) {
          ctx.strokeStyle = L > 0.02 ? `rgba(${LANES[hot].color},${0.16 + 0.6 * L})` : `rgba(${LANES[TOMS[k % 3]].color},0.2)`;
          ctx.beginPath(); ctx.arc(cx, cy, radius(TOMS[0]), k * seg, (k + 1) * seg); ctx.stroke();
        }
        continue;
      }
      const L = lit(lane);
      ctx.strokeStyle = `rgba(${rgbOf(lane)},${0.16 + 0.6 * L})`;
      ctx.lineWidth = (1 + 2.5 * L) * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, radius(lane), 0, Math.PI * 2); ctx.stroke();
    }
    // the centre: a plain disc for the beat (Both: the chord)
    ctx.fillStyle = `rgba(${th.text},0.07)`;
    ctx.beginPath(); ctx.arc(cx, cy, r0 * 0.78, 0, Math.PI * 2); ctx.fill();
    const dot = (lane, f, fill, rgb, alpha) => {    // a dot on a lane's ring
      const rr = radius(lane), a = ang(f), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const s = 5.5 * (S / 240);                       // (a dot: the chord wheel's size, wheel.js: 5.5 of the screen's 240)
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2);
      if (fill) {                                      // (a rim in the screen's colour: dots on rings side by side stay apart)
        ctx.fillStyle = `rgb(${rgb})`; ctx.fill();
        ctx.strokeStyle = `rgb(${th.bg})`; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      }
      else { ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 1.7 * dpr; ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    // the chart's hits: this bar's (and the last bar's, fading as the hand passes their place)
    if (playing && this.drum.chart) {
      for (const n of this.drum.chart.notes) {
        const p = posOf(n.t);
        if (p.bar > bar) break;
        const old = p.bar === bar - 1;
        if (p.bar !== bar && !old) continue;
        const alpha = old ? Math.max(0, 0.5 * (p.f - frac)) : n.j === "MISS" ? 0.9 : 0.55;
        if (alpha > 0.02) dot(n.lane, p.f, false, n.j === "MISS" ? MISS_RGB : LANES[n.lane].color, alpha);
      }
    }
    // Both: the song's notes for your keys, the same way (a chord: its notes on one spot)
    if (this.both && this.game.playing && this.game.chart) {
      let lastF = -1, lastBar = -9;
      for (const n of this.game.chart.notes) {
        const p = posOf(n.t);
        if (p.bar > bar) break;
        const old = p.bar === bar - 1;
        if (p.bar !== bar && !old) continue;
        if (p.bar === lastBar && Math.abs(p.f - lastF) < 0.004 && n.j !== "MISS") continue;   // (a chord: one dot)
        lastF = p.f; lastBar = p.bar;
        const alpha = old ? Math.max(0, 0.5 * (p.f - frac)) : n.j === "MISS" ? 0.9 : 0.55;
        if (alpha > 0.02) dot(KEYS, p.f, false, n.j === "MISS" ? MISS_RGB : th.keys, alpha);
      }
    }
    // your hits, where they landed
    for (const h of this.hits) {
      if (h.lane === KEYS && !this.both) continue;
      const p = posOf(h.t);
      const old = p.bar === bar - 1;
      if (p.bar !== bar && !old) continue;
      const alpha = old ? Math.max(0, 0.8 * (p.f - frac)) : 1;
      if (alpha > 0.02) dot(h.lane, p.f, true, rgbOf(h.lane), alpha);
    }
    // the hand, and a short trail behind it
    const a = ang(frac), trail = ctx.createConicGradient ? ctx.createConicGradient(a - 0.5, cx, cy) : null;
    if (trail) {
      trail.addColorStop(0, `rgba(${th.accent},0)`); trail.addColorStop(0.5 / (Math.PI * 2), `rgba(${th.accent},0.16)`);
      trail.addColorStop(0.5 / (Math.PI * 2) + 0.001, `rgba(${th.accent},0)`); trail.addColorStop(1, `rgba(${th.accent},0)`);
      ctx.fillStyle = trail;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R + 6 * dpr, a - 0.5, a); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = `rgba(${th.text},0.85)`;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (R + 8 * dpr), cy + Math.sin(a) * (R + 8 * dpr));
    ctx.stroke();
    // the centre: the beat (1 .. bpb), the bar under it (Both: what you hold, named, while you hold it); above: the tempo,
    // and DRUMS (Both: KEYS + DRUMS)
    const beatNo = ((Math.floor(beat) % bpb) + bpb) % bpb + 1, font = getComputedStyle(this.cv).fontFamily;
    const held = this.both ? chordName(this.game.held.keys()) : "";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let size = Math.round(r0 * (held ? 0.62 : 0.9));
    ctx.font = `800 ${size}px ${font}`;
    if (held) {                                         // (a long name: smaller, to fit the centre)
      const w = ctx.measureText(held).width, room = r0 * 2.3;
      if (w > room) { size = Math.max(Math.round(8 * dpr), Math.floor((size * room) / w)); ctx.font = `800 ${size}px ${font}`; }
    }
    ctx.fillStyle = held ? `rgb(${th.keys})` : `rgb(${th.text})`;
    ctx.fillText(held || String(beatNo), cx, cy - r0 * 0.08);
    ctx.font = `600 ${Math.round(9 * dpr)}px ${getComputedStyle(this.cv).fontFamily}`;
    ctx.fillStyle = `rgba(${th.text},0.7)`;
    ctx.fillText(playing ? (bar < 0 ? "count-in" : held ? `beat ${beatNo} · bar ${bar + 1}` : `bar ${bar + 1}`) : "free play", cx, cy + r0 * 0.5);
    const bpm = playing ? Math.round(60 / Math.max(1e-3, beatAt(chart, Math.max(0, Math.floor(beat)) + 1) - beatAt(chart, Math.max(0, Math.floor(beat))))) : Math.round(clock.bpm);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.font = `700 ${Math.round(13 * dpr)}px ${getComputedStyle(this.cv).fontFamily}`;
    ctx.fillStyle = `rgb(${th.text})`;
    ctx.fillText(String(bpm), 9 * dpr, 7 * dpr);
    // the top right: the engines playing (Drums: the drum part's, in the kick's colour; Both: the keys' and the drums',
    // each in its colour), as the chord wheel shows the keys'
    const [keysEng, drumEng] = this.engines(), drumRgb = LANES[KICK].color;
    ctx.textAlign = "right";
    ctx.font = `700 ${Math.round(11 * (S / 240))}px ${font}`;
    const right = S - 9 * (S / 240), top = 8 * (S / 240);
    ctx.fillStyle = `rgb(${drumRgb})`;
    ctx.fillText(drumEng || "DRUMS", right, top);
    if (this.both) {
      const w = ctx.measureText(drumEng || "DRUMS").width, sep = " · ";
      ctx.fillStyle = `rgba(${th.text},0.5)`;
      ctx.fillText(sep, right - w, top);
      ctx.fillStyle = `rgb(${th.keys})`;
      ctx.fillText(keysEng || "KEYS", right - w - ctx.measureText(sep).width, top);
    }
  }
}
