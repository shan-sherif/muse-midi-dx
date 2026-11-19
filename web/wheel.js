// The chord wheel: the device screen's place when you play the keys alone (Keyboard), drawn by the page as the rhythm
// ring is (ring.js). The twelve notes round a circle of fifths; the notes you hold light up, joined into the chord's
// shape, and the centre names them (ring.js's chordName: the same names as Both); the song's notes due next show as
// rings on theirs, and their name waits in the centre while you hold nothing. Under it, the keys on screen (the piano's
// range), what you hold lit. Above: the tempo, the Keys part's sound.

import { chordName } from "./ring.js";

const FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"];
const slot = (pc) => (pc * 7) % 12;               // a pitch class -> its place round the circle of fifths
const BLACK = new Set([1, 3, 6, 8, 10]);
const AHEAD = 0.6;                                 // s: the song's notes this soon show as due

export class ChordWheel {
  constructor(canvas, { game, bpm, sound }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.bpm = bpm;                               // () -> the tempo the device has
    this.sound = sound;                           // () -> the Keys part's engine name ("CZ-1")
    this.last = { name: "", at: 0 };              // the last chord held (it fades from the centre)
    this.th = { bg: "16,20,28", text: "232,244,255", keys: "142,164,206", drums: "146,184,142" };
  }
  setTheme(t) { this.th = { ...this.th, ...t }; }

  frame() {
    const cv = this.cv;
    if (!cv.offsetParent) return;                 // (hidden: not drawn)
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const S = Math.round(Math.min(r.width, r.height) * dpr);
    if (cv.width !== S || cv.height !== S) { cv.width = S; cv.height = S; }
    const ctx = this.ctx, th = this.th, g = this.game, now = performance.now(), font = getComputedStyle(cv).fontFamily;
    const u = S / 240;                            // (the device screen's pixel, scaled)
    ctx.fillStyle = `rgb(${th.bg})`;
    ctx.fillRect(0, 0, S, S);

    // what is held, and the song's notes due next
    const held = [...g.held.keys()], heldPc = new Set(held.map((p) => p % 12));
    const due = [];
    if (g.playing && g.chart) {
      const st = g.songTime() - g.offset;
      for (const n of g.chart.notes) {
        if (n.t > st + AHEAD) break;
        if (!n.j && n.t >= st - 0.05) due.push(n);
      }
    }
    const duePc = new Map();                      // pitch class -> nearness 0..1
    for (const n of due) {
      const st = g.songTime() - g.offset, near = 1 - Math.max(0, n.t - st) / AHEAD;
      duePc.set(n.p % 12, Math.max(duePc.get(n.p % 12) || 0, near));
    }

    // the wheel: a dot per note on the circle, its name outside
    const cx = S / 2, cy = 110 * u, R = 61 * u, ang = (k) => -Math.PI / 2 + (k * Math.PI) / 6;
    const at = (k, rr) => [cx + Math.cos(ang(k)) * rr, cy + Math.sin(ang(k)) * rr];
    ctx.strokeStyle = `rgba(${th.text},0.1)`;
    ctx.lineWidth = 1 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // the chord's shape: the held notes joined round the circle
    const shape = [...heldPc].map(slot).sort((a, b) => a - b);
    if (shape.length > 1) {
      ctx.beginPath();
      shape.forEach((k, i) => { const [x, y] = at(k, R); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = `rgba(${th.keys},0.16)`; ctx.fill();
      ctx.strokeStyle = `rgba(${th.keys},0.75)`; ctx.lineWidth = 1.5 * u; ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let pc = 0; pc < 12; pc++) {
      const k = slot(pc), [x, y] = at(k, R), [lx, ly] = at(k, R + 17 * u), on = heldPc.has(pc), near = duePc.get(pc);
      if (near !== undefined) {                   // due: a ring, closing in as it nears
        ctx.strokeStyle = `rgba(${th.keys},${0.35 + 0.5 * near})`;
        ctx.lineWidth = 1.5 * u;
        ctx.beginPath(); ctx.arc(x, y, (9 - 4 * near) * u, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = on ? `rgb(${th.keys})` : `rgba(${th.text},0.35)`;
      ctx.beginPath(); ctx.arc(x, y, (on ? 5.5 : 2.6) * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = on ? `rgb(${th.keys})` : near !== undefined ? `rgba(${th.text},0.85)` : `rgba(${th.text},0.55)`;
      ctx.font = `${on ? 800 : 600} ${Math.round((on ? 12 : 10.5) * u)}px ${font}`;
      ctx.fillText(FIFTHS[k], lx, ly);
    }

    // the centre: what you hold; else the song's next notes (dim, "next"); else the last chord, fading
    const name = held.length ? chordName(held) : "";
    if (name) this.last = { name, at: now };
    let text = name, color = `rgb(${th.keys})`, sub = "";
    if (!text && due.length) {
      const t0 = due[0].t, next = due.filter((n) => n.t - t0 < 0.03).map((n) => n.p);
      text = chordName(next); color = `rgba(${th.text},0.55)`; sub = "next";
    } else if (!text && this.last.name && now - this.last.at < 1500) {
      text = this.last.name; color = `rgba(${th.keys},${0.6 * (1 - (now - this.last.at) / 1500)})`;
    }
    if (text) {
      let size = 30 * u;
      ctx.font = `800 ${size}px ${font}`;
      const w = ctx.measureText(text).width, room = 2 * R - 22 * u;
      if (w > room) { size = Math.max(10 * u, (size * room) / w); ctx.font = `800 ${size}px ${font}`; }
      ctx.fillStyle = color;
      ctx.fillText(text, cx, cy + (sub ? 3 * u : 0));
      if (sub) {
        ctx.font = `600 ${Math.round(9 * u)}px ${font}`;
        ctx.fillStyle = `rgba(${th.text},0.5)`;
        ctx.fillText(sub, cx, cy - 17 * u);
      }
    }

    // the keys on screen (the piano's range): white, black; held ones lit (a judged press: its rating's colour, briefly)
    const lo = g.lo, hi = g.hi, x0 = 10 * u, x1 = S - 10 * u, y0 = 200 * u, h = 30 * u;
    const whites = [];
    for (let p = lo; p <= hi; p++) if (!BLACK.has(p % 12)) whites.push(p);
    const ww = (x1 - x0) / whites.length, xOf = new Map();
    whites.forEach((p, i) => xOf.set(p, x0 + i * ww));
    const keyFill = (p) => {
      const hd = g.held.get(p);
      if (!hd) return null;
      return hd.until > now && hd.color ? hd.color : `rgb(${th.keys})`;
    };
    const dueP = new Set(due.map((n) => n.p));
    for (const p of whites) {
      const x = xOf.get(p), f = keyFill(p);
      ctx.fillStyle = f || `rgba(${th.text},0.82)`;
      ctx.fillRect(x + 0.5 * u, y0, ww - 1 * u, h);
      if (!f && dueP.has(p)) { ctx.fillStyle = `rgba(${th.keys},0.9)`; ctx.fillRect(x + 0.5 * u, y0 + h - 4 * u, ww - 1 * u, 4 * u); }
    }
    for (let p = lo; p <= hi; p++) {
      if (!BLACK.has(p % 12) || !xOf.has(p - 1)) continue;
      const x = xOf.get(p - 1) + ww * 0.68, f = keyFill(p);
      ctx.fillStyle = f || `rgb(${th.bg})`;
      ctx.fillRect(x, y0, ww * 0.64, h * 0.6);
      if (!f && dueP.has(p)) { ctx.fillStyle = `rgba(${th.keys},0.9)`; ctx.fillRect(x, y0 + h * 0.6 - 3 * u, ww * 0.64, 3 * u); }
    }

    // above: the tempo, the Keys part's sound
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.font = `700 ${Math.round(13 * u)}px ${font}`;
    ctx.fillStyle = `rgb(${th.text})`;
    ctx.fillText(String(Math.round(this.bpm() || 0)), 9 * u, 7 * u);
    ctx.textAlign = "right";
    ctx.font = `700 ${Math.round(11 * u)}px ${font}`;
    ctx.fillStyle = `rgb(${th.keys})`;
    ctx.fillText(this.sound() || "", S - 9 * u, 8 * u);
  }
}
