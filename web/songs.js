// Built-in piano charts (public-domain melodies), written in a small notation:
//   "E4:1"      a note and its length in beats      "C4+E4+G4:2"  a chord
//   "r:1"       a rest                               "|"           a bar line (ignored, for reading)
// All of them sit inside the FM-1's 27 keys (F3..G5), so the computer keyboard reaches every note
// without OCT changes.

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteNumber(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error("bad note " + name);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// the time (s) of beat n of a chart: its tempo map (chart.beats), the count-in (n < 0) at the opening tempo,
// past the end at the last beat's spacing
export function beatAt(chart, n) {
  const b = chart.beats, first = b && b.length > 1 ? b[1] - b[0] : 60 / chart.bpm;
  if (!b || !b.length) return n * (60 / chart.bpm);
  if (n < 0) return b[0] + n * first;
  if (n < b.length) return b[n];
  const last = b.length > 1 ? b[b.length - 1] - b[b.length - 2] : first;
  return b[b.length - 1] + (n - b.length + 1) * last;
}

// -> { title, bpm, beatsPerBar, length, beats, parts: [{ name, ch, notes: [{ t, d, p, v }] }] } (t, d: seconds)
export function parseChart({ title, bpm, beatsPerBar = 4, score }) {
  const spb = 60 / bpm, notes = [];
  let beat = 0;
  for (const tok of score.trim().split(/\s+/)) {
    if (tok === "|") continue;
    const [what, len] = tok.split(":");
    const beats = Number(len);
    if (!(beats > 0)) throw new Error(`${title}: bad length in ${tok}`);
    if (what !== "r")
      for (const n of what.split("+")) notes.push({ t: beat * spb, d: beats * spb * 0.9, p: noteNumber(n) });
    beat += beats;
  }
  const beats = Array.from({ length: Math.ceil(beat) + 1 }, (_, i) => i * spb);
  for (const n of notes) n.v = 96;
  const parts = [{ id: 0, name: "Melody", ch: 1, program: 0, drum: false, notes },   // the player's
                 { id: 1, name: "Drum kit", track: "basic beat", ch: 10, program: 0, drum: true, generated: true,
                   notes: basicBeat(beat, beatsPerBar, spb) }];
  return { title, bpm, beatsPerBar, length: beat * spb, beats, parts };
}

// a plain beat for a song without drums (the Drums game on the built-in songs): 4/4 kick 1 3, snare 2 4, hi-hat in eighths,
// a crash on the first bar; 3/4 kick 1, snare 2 3, hi-hat on the beats. Generated, so Keyboard mode leaves it out
function basicBeat(beats, bar, spb) {
  const out = [], hit = (b, p, v) => out.push({ t: b * spb, d: spb * 0.25, p, v });
  for (let b = 0; b < Math.floor(beats); b++) {
    const k = b % bar;
    if (b === 0) hit(b, 49, 100);
    if (bar === 3) { hit(b, k === 0 ? 36 : 38, k === 0 ? 105 : 80); if (b) hit(b, 42, 70); continue; }
    if (k % 2 === 0) hit(b, 36, 105); else hit(b, 38, 95);
    if (b) hit(b, 42, 75);
    hit(b + 0.5, 42, 60);
  }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}

export const SONGS = [
  {
    title: "Warm-up: C major",
    bpm: 84,
    score: `C4:1 D4:1 E4:1 F4:1 | G4:1 A4:1 B4:1 C5:1 | C5:1 B4:1 A4:1 G4:1 | F4:1 E4:1 D4:1 C4:1 |
            C4+E4+G4:2 F4+A4+C5:2 | G4+B4+D5:2 C4+E4+G4:2`,
  },
  {
    title: "Twinkle, Twinkle",
    bpm: 96,
    score: `C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 | F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2 |
            G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2 | G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2 |
            C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 | F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2`,
  },
  {
    title: "Ode to Joy",
    bpm: 108,
    score: `E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | E4:1.5 D4:0.5 D4:2 |
            E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | D4:1.5 C4:0.5 C4:2`,
  },
  {
    title: "Minuet in G",
    bpm: 120,
    beatsPerBar: 3,
    score: `D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 |
            C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3`,
  },
  {
    title: "Für Elise (opening)",
    bpm: 132,
    beatsPerBar: 3,
    // a beat here = an eighth note of the 3/8 (sixteenths are 0.5); the rest puts the pickup at the bar line
    score: `r:2 E5:0.5 D#5:0.5 | E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4:1 r:0.5 C4:0.5 E4:0.5 A4:0.5 |
            B4:1 r:0.5 E4:0.5 G#4:0.5 B4:0.5 | C5:1 r:0.5 E4:0.5 E5:0.5 D#5:0.5 |
            E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4:1 r:0.5 C4:0.5 E4:0.5 A4:0.5 |
            B4:1 r:0.5 E4:0.5 C5:0.5 B4:0.5 | A4:2`,
  },
].map(parseChart);
