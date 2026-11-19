// A General MIDI instrument's nearest sound here: a song's instruments get a sound like theirs on the parts that play
// them. Each GM program (0..127) names a preferred sound ("ENGINE|NAME", as the browser lists them); one missing (an
// engine taken out: engines/<source>/DISABLED) falls back to the first sound of the program's family's category.

const PREFER = [
  // piano 0..7
  "CZ-1|PIANO 1", "CZ-1|PIANO 2", "CZ-1|PIANO 3", "CZ-1|HONKY-TONK", "FM6|TINE EP", "FM6|DX TINE", "CZ-1|HARPSICHORD", "FM6|CLAVINET",
  // chromatic percussion 8..15
  "CZ-1|MUSIC BOX", "FM6|BELLS", "CZ-1|MUSIC BOX", "CZ-1|VIBRAPHONE", "FM6|MARIMBA", "CZ-1|XYLOPHONE", "FM6|TUBULAR", "CZ-1|KOTO",
  // organ 16..23
  "FM6|DRAWBARS", "PROPHET|PERCUSSIVE ORGAN", "PROPHET|Leslied", "CZ-1|PIPE ORGAN 1", "PROPHET|REED ORGAN", "CZ-1|ACCORDION",
  "CZ-1|HARMONICA", "CZ-1|ACCORDION",
  // guitar 24..31
  "PROPHET|Nylon Fingers", "CZ-1|ACO.GUITAR", "CZ-1|JAZZ GUITAR", "CZ-1|ELEC.GUITAR", "FM6|PLUCK", "PROPHET|Dirty Lead",
  "PROPHET|Skreamer Solo", "FM6|PLUCK",
  // bass 32..39
  "PROPHET|Uptight Bass", "CZ-1|ELEC.BASS 1", "CZ-1|ELEC.BASS 2", "FM6|SOLID BASS", "CZ-1|SLAP BASS", "PROPHET|Funk Bass II",
  "ANALOG|MONO BASS", "ANALOG|SAW BASS",
  // strings 40..47
  "PROPHET|HIGH STRINGS", "CZ-1|STRINGS 1", "CZ-1|CELLO", "PROPHET|LOW STRINGS", "CZ-1|STRINGS 2", "PROPHET|Pluck Hollow",
  "FM6|HARP", "CZ-1|MALLET LOG",
  // ensemble 48..55
  "FM6|STRINGS", "CZ-1|STRINGS 3", "CZ-1|SYN STRINGS", "PROPHET|Old String Machine", "CZ-1|VOICE 1", "CZ-1|VOICE 2",
  "PROPHET|Vocal Pad", "CZ-1|ORCHESTRA",
  // brass 56..63
  "CZ-1|BRASS 1", "CZ-1|BRASS 2", "CZ-1|BRASS 3", "PROPHET|TRUMPET FLUTE", "PROPHET|Afterblow Horn", "FM6|BRASS SECT",
  "ANALOG|SYN BRASS", "PROPHET|Stabby Brass",
  // reed 64..71
  "CZ-1|SAXOPHONE", "CZ-1|SAXOPHONE", "CZ-1|SAXOPHONE", "CZ-1|SAXOPHONE", "PROPHET|FM Clarinet", "PROPHET|FM Clarinet",
  "PROPHET|FM Clarinet", "PROPHET|FM Clarinet",
  // pipe 72..79
  "CZ-1|FLUTE", "FM6|FLUTE", "CZ-1|RECORDER", "ANALOG|PAN FLUTE", "PROPHET|FLUTES", "CZ-1|FLUTE", "CZ-1|WHISTLE", "PROPHET|Recorder",
  // synth lead 80..87
  "SID|PULSE LEAD", "ANALOG|FAT LEAD", "PROPHET|PIPE ORGAN FLUTES", "PROPHET|Blow by Blow", "PROPHET|Dirty Lead",
  "PROPHET|Hum-Along Solo", "PROPHET|OCTAVE SAWTEETH", "PROPHET|Unisawyer",
  // synth pad 88..95
  "FM6|GLASS PAD", "ANALOG|WARM PAD", "ANALOG|SUPERSAW", "PROPHET|Choral Voices", "PROPHET|Reedy String Pad",
  "PROPHET|Hollow Dreams", "PROPHET|Ghostly Glow", "PROPHET|Pedaling Sweep",
  // synth effects 96..103
  "PROPHET|Watery Plucks", "ANALOG|ATMOS PAD", "FM6|BELL", "ANALOG|ATMOS PAD", "FM6|GLASS PAD", "PROPHET|Another Ocean",
  "PROPHET|Ghostly Glow", "PROPHET|Unicorn Dreams",
  // ethnic 104..111
  "CZ-1|SITAR", "PROPHET|Pluckyness", "CZ-1|KOTO", "CZ-1|KOTO", "FM6|KALIMBA", "PROPHET|HARMONIUM", "PROPHET|HIGH STRINGS",
  "PROPHET|FM Clarinet",
  // percussive 112..119
  "FM6|BELL", "PROPHET|Tuned Percussion", "FM6|DX MARIMBA", "CZ-1|MALLET LOG", "CZ-1|MALLET LOG", "CZ-1|MALLET LOG",
  "CZ-1|MALLET LOG", "PROPHET|Ominous Bellfall",
  // sound effects 120..127
  "CZ-1|METALLIC", "CZ-1|METALLIC", "PROPHET|Another Ocean", "CZ-1|WHISTLE", "CZ-1|METALLIC", "PROPHET|Small Gong",
  "PROPHET|Impact Bass", "PROPHET|Small Gong",
];
// each family's category (the browser's), for the fallback
const FAMILY_CAT = ["KEYS", "BELL", "ORGAN", "PLUCK", "BASS", "STRING", "STRING", "BRASS", "WIND", "WIND", "LEAD", "PAD", "PAD",
                    "PLUCK", "BELL", "OTHER"];

// sounds: the browser's list ({ engine, engineName, preset, name, cat }); -> that sound, or null
export function soundForProgram(sounds, program) {
  const p = Math.max(0, Math.min(127, program | 0));
  const [engineName, name] = PREFER[p].split("|");
  return sounds.find((s) => s.engineName === engineName && s.name === name) ||
    sounds.find((s) => s.cat === FAMILY_CAT[p >> 3] && s.engineName !== "DRUM") || null;
}
