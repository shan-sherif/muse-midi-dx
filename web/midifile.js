// A Standard MIDI File (type 0 or 1) -> a chart with its instruments kept apart:
//   { title, bpm, beatsPerBar, length, beats, trimmed,
//     parts: [{ id, name, track, ch, program, drum, notes: [{ t, d, p, v }] }] }   (parts: the busiest first)
// A part is one track's notes on one channel. Times go through the tempo map; the silence before the first note is
// trimmed in whole bars.

// the General MIDI program names (the standard's instrument list)
export const GM = [
  "Acoustic Grand Piano", "Bright Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2",
  "Harpsichord", "Clavinet", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells",
  "Dulcimer", "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica",
  "Tango Accordion", "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar", "Overdriven Guitar",
  "Distortion Guitar", "Guitar Harmonics", "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass", "Slap Bass 1",
  "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings",
  "Pizzicato Strings", "Orchestral Harp", "Timpani", "String Ensemble 1", "String Ensemble 2", "Synth Strings 1",
  "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit", "Trumpet", "Trombone", "Tuba",
  "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2", "Soprano Sax", "Alto Sax", "Tenor Sax",
  "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle",
  "Shakuhachi", "Whistle", "Ocarina", "Square Lead", "Saw Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead",
  "Fifths Lead", "Bass + Lead", "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad", "Bowed Pad", "Metallic Pad",
  "Halo Pad", "Sweep Pad", "Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX", "Brightness FX", "Goblins FX",
  "Echoes FX", "Sci-fi FX", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai", "Tinkle Bell",
  "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal", "Guitar Fret Noise",
  "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
];

export function parseMidiFile(buf, title = "") {
  const v = new DataView(buf);
  let pos = 0;
  const u32 = () => { const x = v.getUint32(pos); pos += 4; return x; };
  const u16 = () => { const x = v.getUint16(pos); pos += 2; return x; };
  const u8 = () => v.getUint8(pos++);
  const vlq = () => { let x = 0, b; do { b = u8(); x = (x << 7) | (b & 0x7f); } while (b & 0x80); return x; };
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());

  if (tag() !== "MThd") throw new Error("not a MIDI file");
  const hlen = u32();
  const format = u16(), ntrk = u16(), division = u16();
  pos = 8 + hlen;
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files are not supported");
  if (format > 1) throw new Error("MIDI format 2 is not supported");

  const tempos = [{ tick: 0, us: 500000 }];
  const byPart = new Map();                                        // "track:channel" -> { tr, ch, raw, program, trackName }
  let beatsPerBar = 4, name = null;
  for (let tr = 0; tr < ntrk && pos < buf.byteLength; tr++) {
    if (tag() !== "MTrk") throw new Error("bad track chunk");
    const end = u32() + pos;
    let tick = 0, status = 0, trackName = null;
    const program = new Array(16).fill(-1);
    const open = new Map();                                        // ch*128+note -> {tick, p, v}
    const part = (ch) => {
      const k = `${tr}:${ch}`;
      if (!byPart.has(k)) byPart.set(k, { tr, ch, raw: [], program: program[ch], trackName });
      return byPart.get(k);
    };
    const close = (ch, n, at) => part(ch).raw.push({ tick: n.tick, end: at, p: n.p, v: n.v });
    while (pos < end) {
      tick += vlq();
      let st = v.getUint8(pos);
      if (st & 0x80) pos++; else st = status;                      // running status
      if (st === 0xff) {
        const type = u8(), len = vlq(), at = pos;
        if (type === 0x51) tempos.push({ tick, us: (v.getUint8(at) << 16) | (v.getUint8(at + 1) << 8) | v.getUint8(at + 2) });
        else if (type === 0x58) beatsPerBar = v.getUint8(at) || 4;
        else if (type === 0x03) {                                  // the first track's name: the song's; others: the track's
          const s = new TextDecoder().decode(new Uint8Array(buf, at, len)).trim() || null;
          if (tr === 0 && !name) name = s; else if (!trackName) trackName = s;
        }
        pos = at + len;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { pos += vlq(); continue; }
      status = st;
      const kind = st >> 4, ch = st & 15;
      const d1 = u8(), d2 = kind === 0xc || kind === 0xd ? 0 : u8();
      if (kind === 0xc) {                                          // a program change: the part's instrument
        program[ch] = d1;
        const pt = byPart.get(`${tr}:${ch}`);
        if (pt && pt.program < 0) pt.program = d1;
        continue;
      }
      const key = ch * 128 + d1;
      if (kind === 0x9 && d2 > 0) {
        if (open.has(key)) close(ch, open.get(key), tick);
        part(ch);
        open.set(key, { tick, p: d1, v: d2 });
      } else if (kind === 0x8 || (kind === 0x9 && d2 === 0)) {
        if (open.has(key)) { close(ch, open.get(key), tick); open.delete(key); }
      }
    }
    for (const [key, n] of open) close(key >> 7, n, tick);
    for (const p of byPart.values()) if (p.tr === tr && !p.trackName) p.trackName = trackName;
    pos = end;
  }
  if (![...byPart.values()].some((p) => p.raw.length)) throw new Error("no notes in this file");

  tempos.sort((a, b) => a.tick - b.tick);
  const sec = (tick) => {                                          // tempo map
    let s = 0, i = 0;
    for (; i + 1 < tempos.length && tempos[i + 1].tick <= tick; i++)
      s += ((tempos[i + 1].tick - tempos[i].tick) * tempos[i].us) / division / 1e6;
    return s + ((tick - tempos[i].tick) * tempos[i].us) / division / 1e6;
  };
  const bpm = Math.round(60e6 / tempos.filter((t) => t.tick === 0).pop().us);   // the file's own, over the default

  const parts = [...byPart.values()].filter((p) => p.raw.length).map((p) => {
    const drum = p.ch === 9;
    const notes = p.raw.map((n) => ({ t: sec(n.tick), d: Math.max(0.05, sec(n.end) - sec(n.tick)), p: n.p, v: n.v }))
      .sort((a, b) => a.t - b.t || a.p - b.p);
    const gm = p.program >= 0 ? GM[p.program] : null;
    return { name: drum ? "Drum kit" : gm || p.trackName || `Channel ${p.ch + 1}`, track: p.trackName,
             ch: p.ch + 1, program: Math.max(0, p.program), drum, notes };
  });
  const length = Math.max(...parts.flatMap((p) => p.notes.map((n) => n.t + n.d)));
  let beats = [];                                                  // every quarter note, through the tempo map
  for (let tick = 0; ; tick += division) { const t = sec(tick); beats.push(t); if (t > length) break; }

  // trim the silence before the first note, in whole bars (the grid stays on the music; a pickup keeps its bar)
  const first = Math.min(...parts.map((p) => p.notes[0].t));
  let fb = 0;
  while (fb + 1 < beats.length && beats[fb + 1] <= first + 1e-6) fb++;
  const cut = Math.floor(fb / beatsPerBar) * beatsPerBar, trimmed = beats[cut];
  if (trimmed > 0) {
    beats = beats.slice(cut).map((t) => t - trimmed);
    for (const p of parts) for (const n of p.notes) n.t -= trimmed;
  }
  parts.sort((a, b) => b.notes.length - a.notes.length);
  parts.forEach((p, i) => (p.id = i));
  const spb0 = beats.length > 1 ? beats[1] - beats[0] : 60 / bpm;  // the tempo where the chart now starts
  // the title: the file's name (the caller's); the name inside the file is often an instrument's ("Piano"): only a fallback
  return { title: title || name || "MIDI file", embeddedTitle: name, bpm: Math.round(60 / spb0), beatsPerBar,
           length: length - trimmed, beats, parts, trimmed };
}
