// SPDX-License-Identifier: GPL-3.0-only
// muse-midi-dx: the drawn FM-1 (panel code adapted from Melodee's web/emu/index.html), the Melodee engine in
// an AudioWorklet, preset picking, MIDI in, and the rhythm game on the second screen.
import { Game, KEYBOARDS, noteName } from "./game.js";
import { DrumGame, LANES, DRUM_KEYS, laneOf } from "./drums.js";
import { SONGS, beatAt } from "./songs.js";
import { parseMidiFile } from "./midifile.js";

const $ = (id) => document.getElementById(id);

/* settings kept in this browser, every key prefixed: a site's storage is shared by all its pages (on GitHub Pages, every
 * project of shan-sherif.github.io), so "theme" alone could be another project's */
const STORE_PREFIX = "muse-midi-dx:";
const STORE_KEYS = ["theme", "sounds", "keysize", "keyshift", "transpose", "speed", "speedx", "offset", "metro", "letters",
                    "instrument", "routes", "mix", "drumw", "outside"];
const store = { get(k) { try { return localStorage.getItem(STORE_PREFIX + k); } catch { return null; } },
                set(k, v) { try { localStorage.setItem(STORE_PREFIX + k, v); } catch {} },
                del(k) { try { localStorage.removeItem(STORE_PREFIX + k); } catch {} } };
// (settings saved before the prefix, on this machine only: on a shared host a plain key may be another project's)
if (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  for (const k of STORE_KEYS) {
    try {
      const old = localStorage.getItem(k);
      if (old !== null && localStorage.getItem(STORE_PREFIX + k) === null) localStorage.setItem(STORE_PREFIX + k, old);
      if (old !== null) localStorage.removeItem(k);
    } catch {}
  }
const ui = {
  status(text, warn = false) { $("status").textContent = text; $("status").classList.toggle("warn", warn); },
};

/* =================================================================== the device's controls (Advanced) */
const BTN = { "OCT-": 0, "OCT+": 1, FX: 2, SCL: 3, ENV: 4, LFO: 5, EDIT: 6, GLO: 7, HOME: 8, SAVE: 9, ARP: 10, SEQ: 11, PLAY: 12, REC: 13 };
const ENC = { SELECT: 0, ALGORITHM: 1, KNOB1: 2, KNOB2: 3, KNOB3: 4, KNOB4: 5, PRESETS: 6 };
const WHITE_K = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];   // the FM-1's white keys (key 0 = F3)
const panel = $("panel");

let master = 700;
const knobs = [];
function knob(label, id) {
  const box = document.createElement("div"), el = document.createElement("div"), lab = document.createElement("span");
  el.className = "knob";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", label);
  lab.className = "label";
  lab.textContent = label;
  box.append(el, lab);
  $("knobs").append(box);
  const k = { el, id, angle: id === "master" ? -135 + (270 * master) / 1023 : 0 };
  el.style.setProperty("--angle", `${k.angle}deg`);
  knobs.push(k);
}
knob("MASTER", "master");
knob("SELECT", ENC.SELECT);
knob("PRESETS", ENC.PRESETS);
knob("ALGORITHM", ENC.ALGORITHM);
for (let i = 1; i <= 4; i++) knob(`KNOB ${i}`, ENC[`KNOB${i}`]);

const buttons = [];
for (const label of ["OCT-", "FX", "SCL", "ENV", "LFO", "EDIT", "GLO", "OCT+", "HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC"]) {
  const el = document.createElement("div");
  el.className = "btn";
  el.textContent = label;
  el.setAttribute("role", "button");
  $("buttons").append(el);
  buttons[BTN[label]] = el;
}

// white keys only (sharps: the computer keyboard, MIDI, or the piano under the notes)
const keys = [];
const KEY_CAP = { 0: "Z", 2: "X", 4: "C", 6: "V", 7: "B", 9: "N", 11: "M", 12: ",", 14: ".", 16: "/", 18: "R", 19: "T", 21: "Y", 23: "U", 24: "I", 26: "O" };
for (const k of WHITE_K) {
  const el = document.createElement("div");
  el.className = "key";
  el.textContent = KEY_CAP[k];
  $("keys").append(el);
  keys[k] = el;
}

// the computer keyboard, as a tracker (Melodee's layout): Z.. the first octave (F3..), Q.. the next
const TRACKER = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyF: 5, KeyV: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
                  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16, KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15,
                  KeyE: 16, Digit4: 17, KeyR: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26 };

/* ---- panel input */
let node = null, ac = null;
const send = (m) => node && node.port.postMessage(m);
const heldKeys = new Map(), heldBtns = new Map();
let keyMask = 0, btnMask = 0;
function sync() {
  let k = 0, b = 0;
  for (const v of heldKeys.values()) k |= 1 << v;
  for (const v of heldBtns.values()) b |= 1 << v;
  keys.forEach((el, i) => el.classList.toggle("held", !!(k & (1 << i))));
  buttons.forEach((el, i) => el.classList.toggle("held", !!(b & (1 << i))));
  if (k !== keyMask) send({ type: "keys", mask: (keyMask = k) });
  if (b !== btnMask) send({ type: "buttons", mask: (btnMask = b) });
}
function hold(el, map, v) {
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    map.set("p" + e.pointerId, v);
    sync();
  });
}
keys.forEach((el, i) => hold(el, heldKeys, i));
buttons.forEach((el, i) => hold(el, heldBtns, i));
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
  panel.addEventListener(ev, (e) => { if (heldKeys.delete("p" + e.pointerId) | heldBtns.delete("p" + e.pointerId)) sync(); }, true);

function turn(k, n) {
  if (!n) return;
  if (k.id === "master") {
    master = Math.max(0, Math.min(1023, master + n * 16));
    k.angle = -135 + (270 * master) / 1023;
    send({ type: "master", value: master });
  } else {
    k.angle = (k.angle + n * 18) % 360;
    send({ type: "encoder", id: k.id, n });
  }
  k.el.style.setProperty("--angle", `${k.angle}deg`);
}
for (const k of knobs) {
  let drag = null, wheel = 0;
  k.el.addEventListener("pointerdown", (e) => { e.preventDefault(); k.el.setPointerCapture(e.pointerId); drag = { y: e.clientY, acc: 0 }; });
  k.el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.acc += drag.y - e.clientY;
    drag.y = e.clientY;
    const n = Math.trunc(drag.acc / 6);
    if (n) { drag.acc -= n * 6; turn(k, n); }
  });
  for (const ev of ["pointerup", "pointercancel"]) k.el.addEventListener(ev, () => { drag = null; });
  k.el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(dy) >= 50) return turn(k, dy < 0 ? 1 : -1);
    wheel -= dy;
    const n = Math.trunc(wheel / 25);
    if (n) { wheel -= n * 25; turn(k, n); }
  }, { passive: false });
  k.el.addEventListener("keydown", (e) => {
    const n = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (n) { e.preventDefault(); e.stopPropagation(); turn(k, n); }
  });
}
function onKey(e, down) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("select, input, [role=slider]")) return;
  if (e.code === "Space") {                          // Play / Stop (not a focused button's own click)
    e.preventDefault();
    if (down && !e.repeat && !$("play").disabled) { document.activeElement?.blur?.(); $("play").click(); }
    return;
  }
  if (down && e.code === "Escape") { stopSong(); return; }
  if (inst === "drums" && DRUM_KEYS[e.code] !== undefined) {   // Drums: A S D F J K L ; are the pads
    e.preventDefault();
    if (down && !e.repeat) drumPad(DRUM_KEYS[e.code]);
    return;
  }
  const k = TRACKER[e.code];
  if (k === undefined) return;
  e.preventDefault();
  if (e.repeat) return;
  if (down) heldKeys.set(e.code, k); else heldKeys.delete(e.code);
  sync();
}
addEventListener("keydown", (e) => onKey(e, true));
addEventListener("keyup", (e) => onKey(e, false));
addEventListener("blur", () => { heldKeys.clear(); heldBtns.clear(); sync(); });

/* ---- the screen */
const sctx = $("lcd").getContext("2d"), img = sctx.createImageData(240, 240);
function draw(fb) {
  const d = img.data;
  for (let i = 0; i < 240 * 240; i++) {
    const c = ((fb[i] & 0xff) << 8) | (fb[i] >> 8);            // the panel's byte order
    d[4 * i] = ((c >> 11) * 255) / 31;
    d[4 * i + 1] = (((c >> 5) & 63) * 255) / 63;
    d[4 * i + 2] = ((c & 31) * 255) / 31;
    d[4 * i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
}

/* =================================================================== sounds: one browser over every factory preset */
// every engine's presets in one list, filtered by a search, a category (the firmware's PRESETS categories) and an engine
const CAT_ORDER = ["BASS", "LEAD", "PAD", "KEYS", "ORGAN", "STRING", "BRASS", "WIND", "PLUCK", "BELL", "DRUM", "FX", "OTHER"];   // browse.c
const PIANO_RE = /PIANO|\bEP\b|E\.P|TINE|RHODES|WURL|HONKY/i;
let sounds = [], current = { engine: -1, preset: -1 };
let trackSounds = [];                                  // [engine, preset] of tracks 1..4 (the worklet's frames)
// a tab per part (1 keys, 2, 3, 4 drums): the browser loads into the selected one; each tab keeps its own filters
// six parts (MIDI channels 1..6): 1 the keys, 2 the drums, 3..6 the band
const PART_TABS = [{ name: "Keys", part: "you" }, { name: "Drums", part: "drums" }, { name: "Instrument 1", part: 3 },
                   { name: "Instrument 2", part: 4 }, { name: "Instrument 3", part: 5 }, { name: "Instrument 4", part: 6 }];
// a part's name: Keys, Drums, Instrument 1..4; a loaded song's instruments name the parts they play on ("Finger Bass",
// two on one part: "Finger Bass +1")
function partName(t) {
  const tab = PART_TABS[t];
  if (t < 2) return tab.name;
  let c = null;
  try { c = charts[$("song").value]; } catch { return tab.name; }   // (before the songs exist: the plain names)
  if (!c || !c.assign) return tab.name;
  const on = c.parts.filter((p, i) => c.assign[i] === tab.part && !p.generated);
  return on.length ? on[0].name + (on.length > 1 ? ` +${on.length - 1}` : "") : tab.name;
}
const tabFilt = PART_TABS.map((t, i) => ({ q: "", cat: i === 0 ? "PIANO" : i === 1 ? "DRUM" : "ALL", engine: "ALL" }));
let sndTarget = 0, filt = tabFilt[0];

// a sound chosen: loaded into the selected part, then heard (a C4 on that part, half a second) while no song runs
let audition = null;                                   // { ch, timer }: the audition note sounding
function loadPreset(eid, k) {
  send({ type: "trackPreset", track: sndTarget, engine: eid, preset: k });
  if (!node || playing()) return;                      // (in a song a C4 on your part could be judged)
  if (audition) { clearTimeout(audition.timer); send({ type: "midi", data: [0x80 | audition.ch, 60, 0] }); }
  const ch = sndTarget;                                // (part t: MIDI channel t + 1)
  send({ type: "midi", data: [0x90 | ch, 60, 100] }); // (after the load: the worklet takes messages in order)
  audition = { ch, timer: setTimeout(() => { send({ type: "midi", data: [0x80 | ch, 60, 0] }); audition = null; }, 550) };
}
function renderTabs() {
  const box = $("snd-tabs");
  if (!box) return;
  box.textContent = "";
  PART_TABS.forEach((tab, t) => {
    const b = document.createElement("button"), cur = trackSounds[t], snd = cur && sounds.find((x) => x.engine === cur[0] && x.preset === cur[1]);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", t === sndTarget);
    b.style.setProperty("--c", PART_COLORS[tab.part]);
    b.innerHTML = `<b></b><small></small>`;
    b.firstChild.textContent = `${partName(t)}${(t === 0 && keysOn()) || (t === 1 && drumsOn()) ? " · you" : ""}`;
    b.title = t < 2 ? `Part ${t + 1} (MIDI channel ${t + 1})` : `${tab.name}: part ${t + 1} (MIDI channel ${t + 1})`;
    b.lastChild.textContent = snd ? snd.name : "part " + (t + 1);
    b.onclick = () => setSoundTab(t);
    box.append(b);
  });
}
// a part sounding: its tab (and its mixer strip) lit, at once; let go, a quick fade (CSS)
function showActivity(act) {
  const tabs = $("snd-tabs").children, strips = $("mx-strips").children;
  act.forEach((n, t) => {
    if (tabs[t]) tabs[t].classList.toggle("live", n > 0);
    if (strips[t] && !$("mixer").hidden) strips[t].classList.toggle("live", n > 0);
  });
}
function setSoundTab(t) {
  sndTarget = t;
  filt = tabFilt[t];
  $("snd-search").value = filt.q;
  current = { engine: -1, preset: -1 };
  const cur = trackSounds[t];
  if (cur) showCurrent(cur[0], cur[1]);
  renderTabs();
  if (sounds.length) renderSounds(true);
}
const matches = (s) =>
  (filt.engine === "ALL" || s.engineName === filt.engine) &&
  (filt.cat === "ALL" || (filt.cat === "PIANO" ? PIANO_RE.test(s.name) : s.cat === filt.cat)) &&
  (!filt.q || `${s.name} ${s.engineName} ${s.cat}`.toLowerCase().includes(filt.q));
const visible = () => sounds.filter(matches);

function chip(box, label, value, key, count) {
  const b = document.createElement("button");
  b.className = "fchip";
  b.textContent = label;
  if (count != null) { const n = document.createElement("small"); n.textContent = count; b.append(n); }
  b.classList.toggle("zero", count === 0);
  b.dataset.v = value;
  b.onclick = () => { filt[key] = value; renderSounds(true); };
  box.append(b);
}
function renderFilters() {
  const pool = (key) => {                              // the sounds the other filters leave (a chip's count)
    const keep = filt[key];
    filt[key] = "ALL";
    const out = sounds.filter(matches);
    filt[key] = keep;
    return out;
  };
  const forCats = pool("cat"), forEngines = pool("engine");
  $("snd-cats").textContent = "";
  chip($("snd-cats"), "★ Piano", "PIANO", "cat", forCats.filter((s) => PIANO_RE.test(s.name)).length);
  chip($("snd-cats"), "All", "ALL", "cat", forCats.length);
  for (const c of CAT_ORDER) {
    const n = forCats.filter((s) => s.cat === c).length;
    if (n) chip($("snd-cats"), c[0] + c.slice(1).toLowerCase(), c, "cat", n);
  }
  $("snd-engines").textContent = "";
  chip($("snd-engines"), "All engines", "ALL", "engine");
  for (const e of [...new Set(sounds.map((s) => s.engineName))])
    chip($("snd-engines"), e, e, "engine", forEngines.filter((s) => s.engineName === e).length);
  for (const b of $("snd-cats").children) b.classList.toggle("on", b.dataset.v === filt.cat);
  for (const b of $("snd-engines").children) b.classList.toggle("on", b.dataset.v === filt.engine);
}
function renderSounds(scroll = false) {
  renderFilters();
  const list = $("snd-list"), vis = visible();
  list.textContent = "";
  for (const s of vis) {
    const row = document.createElement("button");
    row.className = "snd";
    row.setAttribute("role", "option");
    row.dataset.e = s.engine;
    row.dataset.k = s.preset;
    const on = s.engine === current.engine && s.preset === current.preset;
    row.classList.toggle("on", on);
    row.setAttribute("aria-selected", on);
    row.innerHTML = `<span class="n"></span><span class="m"></span>`;
    row.firstChild.textContent = s.name;
    row.lastChild.textContent = `${s.engineName} · ${s.cat.toLowerCase()}`;
    row.onclick = () => loadPreset(s.engine, s.preset);
    list.append(row);
  }
  $("snd-count").textContent = `${vis.length} of ${sounds.length} sounds`;
  if (!vis.length) list.innerHTML = `<p class="empty">No sound matches. Try “All”.</p>`;
  if (scroll) markCurrent(true);
}
function markCurrent(scroll) {
  for (const r of $("snd-list").children) {
    const on = Number(r.dataset.e) === current.engine && Number(r.dataset.k) === current.preset;
    r.classList.toggle("on", on);
    r.setAttribute?.("aria-selected", on);
    if (on && scroll) {                                 // the list alone scrolls (scrollIntoView would move the sidebar too)
      const list = $("snd-list"), top = r.offsetTop, bottom = top + r.offsetHeight;   // (the list is the offsetParent)
      if (top < list.scrollTop) list.scrollTop = top - 4;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
    }
  }
}
function step(dir) {                                   // the previous / next sound of the list (wraps)
  const vis = visible();
  if (!vis.length) return;
  const i = vis.findIndex((s) => s.engine === current.engine && s.preset === current.preset);
  const s = vis[(i < 0 ? (dir > 0 ? 0 : vis.length - 1) : i + dir + vis.length) % vis.length];
  loadPreset(s.engine, s.preset);
}

function showCurrent(eid, k) {
  if (eid === current.engine && k === current.preset) return;
  current = { engine: eid, preset: k };
  const s = sounds.find((x) => x.engine === eid && x.preset === k);
  $("snd-name").textContent = s ? s.name : "—";
  $("snd-meta").textContent = s ? `${s.engineName} · ${s.cat.toLowerCase()} · ${String(k + 1).padStart(3, "0")}` : "";
  markCurrent(true);
  if (sndTarget === 0 && s && s.engineName === "DRUM" && keysOn())   // (the keys part on a drum kit: its notes aren't judged)
    ui.status("Keys on a DRUM kit aren't judged by the game; pick a melodic sound for Keys.", true);
  else if (s && statusIsWarn()) ui.status(`Ready: ${partName(sndTarget)} · ${s.engineName} · ${s.name}`);
}
const statusIsWarn = () => $("status").classList.contains("warn") || $("status").textContent.startsWith("Ready");

function setupSounds(list, categories) {
  sounds = [];
  for (const e of list.filter((x) => x.presets.length))
    e.presets.forEach((name, k) => sounds.push({ engine: e.id, engineName: e.name, preset: k, name, cat: categories[e.cats[k]] || "OTHER" }));
  $("snd-search").disabled = false;
  $("snd-search").placeholder = `Search ${sounds.length} sounds…`;
  $("snd-search").oninput = () => { filt.q = $("snd-search").value.trim().toLowerCase(); renderSounds(true); };
  $("snd-prev").disabled = $("snd-next").disabled = false;
  $("snd-prev").onclick = () => step(-1);
  $("snd-next").onclick = () => step(1);
  $("snd-list").addEventListener("keydown", (e) => {
    const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); step(d); }
  });
  renderSounds();
}                                                      // (the parts' sounds: restoreSettings, saved or the defaults)

/* =================================================================== the theme: the device's screen palette */
// The page takes its colours from the palette the device's screen uses (its settings, or Device theme here): background,
// surface, text, and the four track colours (part 1 = you: the primary accent, as the device's own highlight).
// (until the device is on: LO-FI, as the build has it: scripts/gen_palettes.py, track colours reversed)
let palettes = [{ name: "LO-FI", colors: [0x20e3, 0x3144, 0xef1a, 0xffbd, 0x8d39, 0x95d1, 0xd5ad, 0xdc70] }], themeIndex = -1;
const rgb565 = (v) => [((v >> 11) * 255 / 31) | 0, (((v >> 5) & 63) * 255 / 63) | 0, ((v & 31) * 255 / 31) | 0];
const mixRgb = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const hex = (c) => "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
const trip = (c) => c.join(",");
function applyTheme(i) {
  const p = palettes[i];
  if (!p || i === themeIndex) return;
  themeIndex = i;
  const [B, S, T, , P1, P2, P3, P4] = p.colors.map(rgb565);
  const light = (0.2126 * B[0] + 0.7152 * B[1] + 0.0722 * B[2]) / 255 > 0.5;
  const root = document.documentElement.style;
  root.setProperty("--B", hex(B)); root.setProperty("--S", hex(S)); root.setProperty("--T", hex(T));
  [P1, P2, P3, P4].forEach((c, k) => root.setProperty(`--P${k + 1}`, hex(c)));
  root.setProperty("color-scheme", light ? "light" : "dark");
  // the ratings' colours: light on a dark page, deep on a light one
  const j = light ? ["#00707a", "#1d7a3a", "#8a5a00", "#b0213a"] : ["#9ff0ff", "#8ff0b0", "#ffd6a0", "#ff7a85"];
  ["pf", "gr", "gd", "ms"].forEach((k, n) => root.setProperty(`--j-${k}`, j[n]));
  Object.assign(PART_COLORS, { you: hex(P1), drums: hex(P2), 3: hex(P3), 4: hex(P4),   // (parts 5, 6: between the palette's)
                               5: hex(mixRgb(P1, P3, 0.5)), 6: hex(mixRgb(P2, P4, 0.5)) });
  // the highway stays dark (the blue / yellow notes read on it): the palette's background, or its text on a light one
  const water = light ? T : B, black = [0, 0, 0];
  game.setTheme({ top: trip(mixRgb(water, black, 0.45)), mid: trip(mixRgb(water, P1, 0.08)), bottom: trip(mixRgb(water, P1, 0.2)),
                  glow: trip(P2), text: trip(light ? B : T), accent: trip(P1), warm: trip(P3), ink: trip(mixRgb(water, black, 0.3)),
                  base: trip(mixRgb(water, black, 0.6)) });
  drum.setTheme({ ...game.th, accent2: trip(P4) });
  renderTabs();
  $("theme").value = i;
  if (!$("setup").hidden) { renderParts(); renderPartSounds(); drawRoll(); }
}
function setupThemes(list) {
  palettes = list;
  themeIndex = -1;
  $("theme").length = 0;
  list.forEach((p, i) => $("theme").add(new Option(p.name, i)));
  $("theme").disabled = false;
  $("theme").onchange = () => send({ type: "palette", index: Number($("theme").value) });   // (the frames bring it back)
}

/* =================================================================== welcome, then power on */
// the welcome card on the notes points at MIDI in; its OK switches the device on (a click: audio may start)
function drawPointer() {
  const svg = $("pointer");
  if ($("welcome").hidden) { svg.toggleAttribute("hidden", true); return; }   // (an SVG element: the attribute)
  const from = $("welcome").querySelector("h2").getBoundingClientRect(), to = $("midiin").getBoundingClientRect();
  if (!from.width || !to.width) { svg.toggleAttribute("hidden", true); return; }
  svg.toggleAttribute("hidden", false);
  const x0 = from.left + from.width / 2, y0 = from.top - 18, x1 = to.left + to.width / 2, y1 = to.bottom + 44;
  // (y1: under the callout bubble)
  $("pointer-path").setAttribute("d", `M ${x0} ${y0} C ${x0} ${(y0 + y1) / 2}, ${x1} ${(y0 + y1) / 2 + 40}, ${x1} ${y1}`);
}
function showWelcome(on) {
  $("welcome").hidden = !on;
  $("callout").hidden = !on || $("midiin").disabled;
  $("midi-pick").classList.toggle("glow", on && !$("midiin").disabled);
  drawPointer();
}
addEventListener("resize", drawPointer);
if (!navigator.requestMIDIAccess)
  $("welcome-text").innerHTML = "This browser has no Web MIDI (use Chrome or Edge for a MIDI keyboard). " +
    "You can still play with the computer keys or by clicking the piano.";
showWelcome(true);
requestAnimationFrame(drawPointer);

async function powerOn() {
  $("power").disabled = true;
  ui.status("Starting…");
  midiAccess();                                        // (the permission prompt, if it has not been answered)
  try {
    const r = await fetch("melodee.wasm");
    if (!r.ok) throw new Error("melodee.wasm missing; run scripts/build-emu.sh");
    const wasm = await r.arrayBuffer();
    ac = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
    await ac.audioWorklet.addModule("worklet.js");
    node = new AudioWorkletNode(ac, "melodee-game", { numberOfInputs: 0, outputChannelCount: [2] });
    node.connect(ac.destination);
    node.port.onmessage = onWorklet;
    node.port.postMessage({ type: "load", wasm, master }, [wasm]);
    await ac.resume();
    showWelcome(false);
  } catch (err) {
    ui.status("Could not start: " + err.message, true);
    $("power").disabled = false;
  }
}
$("power").addEventListener("click", powerOn);

/* full screen (the whole page: the notes get the monitor's height) */
$("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").title = document.fullscreenElement ? "Exit full screen" : "Full screen";
  $("fullscreen").setAttribute("aria-label", $("fullscreen").title);
  drawPointer();
});
if (!document.documentElement.requestFullscreen) $("fullscreen").hidden = true;

fetch("version.json").then((r) => r.json()).then((v) => { $("mver").textContent = v.melodee; }).catch(() => {});

function onWorklet(e) {
  const m = e.data;
  if (m.type === "frame") {
    if (m.fb) draw(m.fb);
    keys.forEach((el, i) => el.classList.toggle("lit", !!(m.keys & (1 << i))));
    buttons.forEach((el, i) => el.classList.toggle("lit", !!(m.buttons & (1 << i))));
    if (m.tracks) {
      const changed = JSON.stringify(m.tracks) !== JSON.stringify(trackSounds);
      syncPartSounds(m.tracks);
      if (sounds.length) showCurrent(m.tracks[sndTarget][0], m.tracks[sndTarget][1]);
      if (changed) renderTabs();
    }
    if (m.act) showActivity(m.act);
    if (m.palette !== undefined && palettes.length) applyTheme(m.palette);
    if (m.tracks && m.palette !== undefined) saveFromFrame(m);
  } else if (m.type === "notes") {
    for (const p of m.off) game.noteOff(p);
    for (const p of m.on) game.noteOn(p, m.t);
  } else if (m.type === "ready") {
    setupThemes(m.palettes);
    setupSounds(m.engines, m.categories);
    restoreSettings(m);
    if (!$("setup").hidden) renderPartSounds();
    sentBpm = 0;
    pushBpm(chartNow().bpm);
    $("play").disabled = false;
    const using = midi ? [...midi.inputs.values()].filter((p) => roles.get(p.id) !== "off").map((p) => p.name) : [];
    ui.status(using.length ? `Ready · MIDI in: ${using.join(" + ")}` : "Ready.");
  } else if (m.type === "mix") syncMixer(m.mix);
  else if (m.type === "crash") ui.status("The engine stopped: " + m.message, true);
}

/* =================================================================== MIDI in: devices and what they play */
// Each MIDI input has a role: "keys" (the piano: part 1, channel 1), "drums" (the drum lanes: part 2), "split" (one device
// sending both: channel 10 the drums, the rest the keys) or "off". The top selector is for one device: it gets the role the
// instrument asks for (Keyboard: keys, Drums: drums, Both: split). Routing lists every device, its last signal and its
// role (kept per device name).
let midi = null, midiAsking = null;
const roles = new Map();                               // input id -> role
const ROLE_LABEL = { keys: "Keyboard", drums: "Drums", split: "Split: ch 10 drums, rest keyboard", off: "Off" };
const roleForInstrument = () => (inst === "drums" ? "drums" : inst === "both" ? "split" : "keys");
const savedRoles = () => { try { return JSON.parse(store.get("routes")) || {}; } catch { return {}; } };
function saveRole(input, role) {
  const r = savedRoles();
  r[input.name] = role;
  store.set("routes", JSON.stringify(r));
}
function useInput(id) {                                // the top selector: this device, as the instrument asks; the rest off
  if (!midi) return;
  for (const input of midi.inputs.values()) roles.set(input.id, input.id === id ? roleForInstrument() : "off");
  $("midiin").value = id || "";
  const input = id && midi.inputs.get(id);
  if (input) ui.status(`MIDI in: ${input.name} · ${ROLE_LABEL[roles.get(id)]}`);
  renderRouting();
}
function fillInputs() {
  const ins = [...midi.inputs.values()], saved = savedRoles();
  $("midiin").length = 1;
  for (const p of ins) { $("midiin").add(new Option(p.name, p.id)); p.onmidimessage = (e) => onMidi(p, e.data); }
  for (const id of [...roles.keys()]) if (!midi.inputs.has(id)) roles.delete(id);
  for (const p of ins) if (!roles.has(p.id) && saved[p.name]) roles.set(p.id, saved[p.name]);   // (as last time)
  if (![...roles.values()].some((r) => r !== "off") && ins.length) useInput(ins[ins.length - 1].id);   // one plugged in: use it
  for (const p of ins) if (!roles.has(p.id)) roles.set(p.id, "off");
  const active = ins.filter((p) => roles.get(p.id) !== "off");
  $("midiin").value = active.length ? active[0].id : "";
  $("midiin").options[0].text = ins.length ? "none" : "no MIDI device found";
  renderRouting();
}
function midiAccess() {
  if (midi || !navigator.requestMIDIAccess) return Promise.resolve(midi);
  return (midiAsking ||= navigator.requestMIDIAccess().then((m) => {
    midi = m;
    midi.onstatechange = fillInputs;
    fillInputs();
    return midi;
  }, () => { midiAsking = null; ui.status("MIDI access was refused (allow it in the site settings).", true); return null; }));
}
$("midiin").addEventListener("pointerdown", () => midiAccess());
$("midiin").addEventListener("focus", () => midiAccess());
$("midiin").addEventListener("change", () => useInput($("midiin").value));
if (!navigator.requestMIDIAccess) { $("midiin").disabled = true; $("midiin").options[0].text = "Web MIDI not supported"; }
else navigator.permissions?.query({ name: "midi" }).then((p) => p.state === "granted" && midiAccess()).catch(() => {});

// a message from a device: its signal shown (Routing), then to the keys or the drums as its role says
function onMidi(input, d) {
  const st = d[0];
  if (st >= 0xf0) return;
  showSignal(input, d);
  const role = roles.get(input.id) || "off";
  if (role === "off") return;
  if (role === "drums" || (role === "split" && (st & 15) === 9)) onDrumMidi(d);
  else onKeysMidi(d);
}
/* the keys: to part 1 (channel 1, whatever the device sends on), moved with the piano's octave (◀ ▶) so its keys hit what
 * the screen shows. A key's release goes to the note its press sent (no stuck notes when the octave changes while held);
 * notes pushed past 0..127 are dropped; only notes (and their per-key pressure) move, not CC / bend / pedal. */
const sentNote = new Map();                         // "channel:key" -> the note sent for it
const midiTranspose = () => ($("transpose").checked ? keyShift * 12 : 0);
function onKeysMidi(d) {
  const st = (d[0] & 0xf0), kind = st >> 4;          // (channel 1)
  if (kind !== 0x8 && kind !== 0x9 && kind !== 0xa) { send({ type: "midi", data: [st, d[1] || 0, d[2] || 0] }); return; }
  const id = `${d[0] & 15}:${d[1]}`;
  const on = kind === 0x9 && d[2] > 0;
  let note;
  if (on) {
    if (sentNote.has(id)) send({ type: "midi", data: [0x80, sentNote.get(id), 0] });   // (a repeat: release the old)
    note = d[1] + midiTranspose();
    if (note < 0 || note > 127) { sentNote.delete(id); return; }
    sentNote.set(id, note);
  } else {
    note = sentNote.get(id);
    if (note === undefined) return;
    if (kind !== 0xa) sentNote.delete(id);
  }
  send({ type: "midi", data: [st, note, d[2]] });
}
// the drums: a hit to part 2 (the device's drum track) as itself, and to the drum lanes
const DRUM_CH = 1;                                     // (part 2: channel 2)
function onDrumMidi(d) {
  const kind = d[0] >> 4;
  if (kind === 0x9 && d[2] > 0) {
    send({ type: "midi", data: [0x90 | DRUM_CH, d[1], d[2]] });
    drum.hit(laneOf(d[1]), audioNow());
  } else if (kind === 0x8 || kind === 0x9) send({ type: "midi", data: [0x80 | DRUM_CH, d[1], 0] });
}
function drumPad(lane) {                               // a pad clicked, or its computer key
  const n = LANES[lane].play;
  send({ type: "midi", data: [0x90 | DRUM_CH, n, 110] });
  setTimeout(() => send({ type: "midi", data: [0x80 | DRUM_CH, n, 0] }), 120);
  drum.hit(lane, audioNow());
}

// Routing: every device, its last signal (what it sent, lit as it arrives) and its role
function describe(d) {
  const kind = d[0] >> 4, ch = (d[0] & 15) + 1;
  if (kind === 0x9 && d[2] > 0) {
    const lane = ch === 10 ? laneOf(d[1]) : -1;
    return `ch ${ch} · ${lane >= 0 ? LANES[lane].name : noteName(d[1])} (${d[1]}) · vel ${d[2]}`;
  }
  if (kind === 0x8 || kind === 0x9) return `ch ${ch} · release ${noteName(d[1])}`;
  if (kind === 0xb) return `ch ${ch} · control ${d[1]} = ${d[2]}`;
  if (kind === 0xe) return `ch ${ch} · pitch bend`;
  if (kind === 0xc) return `ch ${ch} · program ${d[1] + 1}`;
  return `ch ${ch}`;
}
const lastSignal = new Map();                          // input id -> text
function showSignal(input, d) {
  if ((d[0] >> 4) === 0x8 || ((d[0] >> 4) === 0x9 && !d[2])) return;   // (presses, not releases: easier to read)
  lastSignal.set(input.id, describe(d));
  const el = document.querySelector(`.sig[data-id="${CSS.escape(input.id)}"]`);
  if (!el) return;
  el.querySelector("span").textContent = lastSignal.get(input.id);
  el.classList.add("live");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("live"), 180);
}
function renderRouting() {
  const box = $("rt-rows");
  box.textContent = "";
  const ins = midi ? [...midi.inputs.values()] : [];
  for (const input of ins) {
    const tr = document.createElement("tr"), role = roles.get(input.id) || "off";
    tr.innerHTML = `<td class="dev"></td><td><span class="sig"><i></i><span></span></span></td><td><select></select></td>`;
    tr.querySelector(".dev").textContent = input.name;
    const sig = tr.querySelector(".sig");
    sig.dataset.id = input.id;
    sig.querySelector("span").textContent = lastSignal.get(input.id) || "waiting for a key or a pad…";
    const sel = tr.querySelector("select");
    for (const k of ["keys", "drums", "split", "off"]) sel.add(new Option(ROLE_LABEL[k], k));
    sel.value = role;
    sel.onchange = () => {
      roles.set(input.id, sel.value);
      saveRole(input, sel.value);
      const active = ins.filter((p) => roles.get(p.id) !== "off");
      $("midiin").value = active.length === 1 ? active[0].id : active.length ? active[0].id : "";
    };
    box.append(tr);
  }
  if (!ins.length) box.innerHTML = `<tr><td colspan="3" class="dim">${midi ? "No MIDI device found. Connect one by USB; it shows up here." :
    navigator.requestMIDIAccess ? "Allow MIDI access first (open MIDI in at the top)." : "This browser has no Web MIDI (use Chrome or Edge)."}</td></tr>`;
  const using = ins.filter((p) => roles.get(p.id) !== "off").map((p) => `${p.name}: ${ROLE_LABEL[roles.get(p.id)]}`);
  $("rt-note").textContent = using.length ? `In use: ${using.join(" · ")}.` : "No device is in use.";
}
$("routing-btn").onclick = () => { midiAccess(); renderRouting(); $("routing").hidden = false; };
$("rt-done").onclick = () => { $("routing").hidden = true; };
$("routing").addEventListener("pointerdown", (e) => { if (e.target === $("routing")) $("routing").hidden = true; });

/* =================================================================== the game */
let ctLast = -1, perfLast = 0;
function audioNow() {                                // ac.currentTime moves in render quanta: smooth it
  if (!ac) return 0;
  const ct = ac.currentTime, p = performance.now();
  if (ct !== ctLast) { ctLast = ct; perfLast = p; }
  return ct + Math.min((p - perfLast) / 1000, 0.05);
}

/* what you play: the keys, the drums, or both (two highways, one song); kept */
let inst = store.get("instrument");
if (!["keys", "drums", "both"].includes(inst)) inst = "keys";
const keysOn = () => inst !== "drums", drumsOn = () => inst !== "keys";

let hudReady = false;                                  // (the games report their HUD from their constructors)
const game = new Game($("highway"), {
  now: audioNow,
  onHud: () => updateHud(),
  onEnd: () => gameEnded("keys"),
  onPianoKey: (p, down) => send({ type: "midi", data: down ? [0x90, p, 100] : [0x80, p, 0] }),
});
const drum = new DrumGame($("drumway"), { now: audioNow, onHud: () => updateHud(), onEnd: () => gameEnded("drums"), onPad: drumPad });
hudReady = true;
const lead = () => (keysOn() ? game : drum);            // (the song's clock: the same t0 for both)
const playing = () => game.playing || drum.playing;

// the HUD: what is being played, summed (Both: the two combos)
function updateHud() {
  if (!hudReady) return;
  const gs = [keysOn() && game, drumsOn() && drum].filter(Boolean);
  const sum = (f) => gs.reduce((n, g) => n + f(g), 0);
  const counts = { PERFECT: sum((g) => g.counts.PERFECT), GREAT: sum((g) => g.counts.GREAT), GOOD: sum((g) => g.counts.GOOD), MISS: sum((g) => g.counts.MISS) };
  const done = sum((g) => g.judged) + counts.MISS, acc = done ? (100 * sum((g) => g.weight)) / done : 100;
  $("score").textContent = sum((g) => g.score).toLocaleString();
  $("combo").textContent = gs.map((g) => g.combo).join(" · ");
  $("maxcombo").textContent = gs.map((g) => g.maxCombo).join(" · ");
  $("acc").textContent = acc.toFixed(1) + "%";
  $("gauge").style.width = `${Math.max(0, Math.min(100, acc))}%`;
  $("gauge").classList.toggle("low", acc < 60);
  $("c-pf").textContent = counts.PERFECT; $("c-gr").textContent = counts.GREAT;
  $("c-gd").textContent = counts.GOOD; $("c-ms").textContent = counts.MISS;
}
// the end: when every instrument being played has finished, the results of them together
let ended = {}, active = { keys: false, drums: false };
function gameEnded(which) {
  ended[which] = true;
  if ((active.keys && !ended.keys) || (active.drums && !ended.drums)) return;
  endSchedulers();
  $("play").textContent = "Play";
  pushBpm(chartNow().bpm);
  const parts = [active.keys && { label: "keys", r: game.results() }, active.drums && { label: "drums", r: drum.results() }].filter(Boolean);
  const sum = (f) => parts.reduce((n, p) => n + f(p.r), 0);
  const total = sum((r) => r.total), counts = {};
  for (const k of ["PERFECT", "GREAT", "GOOD", "MISS"]) counts[k] = sum((r) => r.counts[k]);
  const accuracy = total ? (100 * sum((r) => r.weight)) / total : 0;
  showResults({
    score: sum((r) => r.score), total, counts, accuracy,
    grade: accuracy >= 95 ? "S" : accuracy >= 88 ? "A" : accuracy >= 75 ? "B" : accuracy >= 60 ? "C" : "D",
    fullCombo: total > 0 && counts.MISS === 0 && sum((r) => r.judged) === total,
    combos: parts.map((p) => ({ label: parts.length > 1 ? `Max combo · ${p.label}` : "Max combo", value: p.r.maxCombo, total: p.r.total })),
  });
}

/* the results: the grade, then a row per rating (its notes, its label, its share of the song), then the totals */
function showResults(r) {
  const c = chartNow();
  $("r-grade").textContent = r.grade;
  $("r-badge").hidden = !r.fullCombo;
  $("r-title").textContent = c.title;
  $("r-sub").textContent = `${r.total} ${inst === "drums" ? "hits" : inst === "both" ? "notes and hits" : "notes"}` + (cpuPlayed ? " · played by CPU" : "");
  const rows = [["PERFECT", "Perfect", "pf"], ["GREAT", "Great", "gr"], ["GOOD", "Good", "gd"], ["MISS", "Miss", "ms"]];
  $("r-rows").innerHTML = rows.map(([k, label, cls], i) => {
    const n = r.counts[k], pct = r.total ? (100 * n) / r.total : 0;
    return `<tr style="--i:${i}"><td class="num">${n}</td><td><span class="pill ${cls}">${label}</span></td>` +
           `<td class="share"><i class="${cls}" style="width:${pct.toFixed(1)}%"></i></td></tr>`;
  }).join("");
  $("r-totals").innerHTML =
    r.combos.map((c, i) => `<tr style="--i:${4 + i}"><td class="num">${c.value}<small>/${c.total}</small></td><td><span class="pill plain">${c.label}</span></td><td></td></tr>`).join("") +
    `<tr style="--i:6"><td class="num">${r.accuracy.toFixed(1)}<small>%</small></td><td><span class="pill plain">Accuracy</span></td><td></td></tr>` +
    `<tr style="--i:7" class="score"><td class="num">${r.score.toLocaleString()}</td><td><span class="pill score">Score</span></td><td></td></tr>`;
  $("results").hidden = false;
}

const charts = [...SONGS];
// your piano part's notes outside the keys on screen: "auto" the device plays them, not scored (shown faintly at the
// edge); "fold" moved by octaves onto the keys (scored; a note folded onto another's key at that moment: one press,
// both); "score" as they are (unreachable ones are misses). Kept; Auto-play by default
let outMode = store.get("outside");
if (!["auto", "fold", "score"].includes(outMode)) outMode = "auto";
/* a song's setup, kept on the song: its parts' assignment (who plays what), its section (start / end, in beats) and
 * transpose (songShift). chartNow() builds what is played from them */
const songShift = new Map();                           // chart -> semitones
const PART_COLORS = { you: "#8ea4ce", drums: "#92b88e", 3: "#d6b668", 4: "#da8c80", 5: "#b2ad9b", 6: "#b6a287", off: "rgba(142,166,196,0.35)" };   // (applyTheme: the device's track colours)
applyTheme(0);                                         // (LO-FI until the device says otherwise)
function autoAssign(c) {                               // piano (else the busiest): your keys; the drum kit: your drums; bass 2; another 3
  const a = c.parts.map(() => "off");
  if (c.parts.length === 1) { a[0] = "you"; return a; }
  const mel = c.parts.filter((p) => !p.drum);             // (parts: the busiest first)
  const you = mel.find((p) => p.program <= 7) || mel[0];
  if (you) a[you.id] = "you";
  const kit = c.parts.find((p) => p.drum);
  if (kit) a[kit.id] = "drums";
  const bass = mel.find((p) => p !== you && p.program >= 32 && p.program <= 39);
  if (bass) a[bass.id] = 3;
  for (const part of [4, 5, 6]) {                       // the busiest of the rest on parts 4..6 (3 too, without a bass)
    const other = mel.find((p) => p !== you && a[p.id] === "off");
    if (other) a[other.id] = part;
  }
  if (!bass) { const other = mel.find((p) => p !== you && a[p.id] === "off"); if (other) a[other.id] = 3; }
  return a;
}
function setupOf(c) {
  c.assign ||= autoAssign(c);
  c.range ||= { start: 0, end: c.beats.length - 1 };
  return c;
}
function chartNow() {
  const c = setupOf(charts[$("song").value]), shift = songShift.get(c) || 0;
  const t0 = beatAt(c, c.range.start), t1 = beatAt(c, c.range.end);
  const inside = (n) => n.t >= t0 - 1e-6 && n.t < t1 - 1e-6;
  const move = (n, drum) => ({ ...n, t: n.t - t0, d: Math.max(0.04, Math.min(n.d, t1 - n.t)), p: drum ? n.p : n.p + shift });
  const ok = (n) => n.p >= 0 && n.p <= 127;
  // who plays: "you" the keys part, "drums" the drum part (yours as the instrument says, else the device's: part 1 / 4),
  // 2..4 a device part, "off" left out. A generated beat (the built-in songs') plays only when you play the drums
  const notes = [], drums = [], accomp = [];
  c.parts.forEach((p, i) => {
    const who = c.assign[i];
    if (who === "off" || (p.generated && !drumsOn())) return;
    for (const n of p.notes) if (inside(n)) {
      const m = move(n, p.drum);
      if (!ok(m)) continue;
      if (who === "you") (keysOn() ? notes : accomp).push(keysOn() ? m : { ...m, ch: 1 });   // (part 1)
      else if (who === "drums") (drumsOn() ? drums : accomp).push(drumsOn() ? m : { ...m, ch: 2 });   // (part 2)
      else accomp.push({ ...m, ch: who });
    }
  });
  notes.sort((a, b) => a.t - b.t || a.p - b.p);
  // the keys on screen: what lies outside them, as Outside says
  const lo = game.lo, hi = game.hi, ghosts = [];
  let outside = 0;
  for (let i = notes.length; i--;) {
    const n = notes[i];
    if (n.p >= lo && n.p <= hi) continue;
    outside++;
    if (outMode === "auto") { notes.splice(i, 1); ghosts.push(n); accomp.push({ ...n, ch: 1 }); }   // (part 1 plays it)
    else if (outMode === "fold") { let p = n.p; while (p < lo) p += 12; while (p > hi) p -= 12; n.p = p; }
  }
  if (outMode === "fold") notes.sort((a, b) => a.t - b.t || a.p - b.p);
  if (outMode === "auto") accomp.sort((a, b) => a.t - b.t);
  // the same key twice: the first let go 20 ms before the next (or the device hears one press: the second never sounds,
  // never judged); notes 30 ms apart or closer are one press (Game.noteOn)
  const lastOn = new Map();
  for (const n of notes) {
    const prev = lastOn.get(n.p);
    if (prev && n.t - prev.t > 0.03 && prev.t + prev.d > n.t - 0.02) prev.d = Math.max(0.03, n.t - prev.t - 0.02);
    lastOn.set(n.p, n);
  }
  drums.sort((a, b) => a.t - b.t || a.p - b.p);
  accomp.sort((a, b) => a.t - b.t);
  const beats = c.beats.slice(c.range.start, c.range.end + 1).map((b) => b - t0);
  const spb = beats.length > 1 ? beats[1] - beats[0] : 60 / c.bpm;
  const ends = [...notes, ...drums, ...accomp].map((n) => n.t + n.d);
  return { title: c.title, bpm: Math.round(60 / spb), beatsPerBar: c.beatsPerBar, beats, notes, drums, accomp, ghosts, outside,
           length: Math.min(t1 - t0, ends.length ? Math.max(...ends) : t1 - t0),
           section: c.range.start > 0 || c.range.end < c.beats.length - 1 ? [t0, t1] : null };
}
function showShift() {
  const t = songShift.get(charts[$("song").value]) || 0;
  $("st-v").textContent = t > 0 ? `+${t}` : String(t);
  $("st-v").classList.toggle("moved", t !== 0);
  $("st-v").title = t ? `${Math.abs(t)} semitone${Math.abs(t) > 1 ? "s" : ""} ${t > 0 ? "up" : "down"}` : "as written";
}
function reloadSong() {                                // after any change to the song's setup
  stopSong();
  loadSong(chartNow());
  showShift();
  showSongInfo();
  applyKeyboard();                                      // (the out-of-range warning)
}
function transposeSong(d) {
  const c = charts[$("song").value];
  songShift.set(c, Math.max(-24, Math.min(24, (songShift.get(c) || 0) + d)));
  reloadSong();
}
$("st-down").onclick = () => transposeSong(-1);
$("st-up").onclick = () => transposeSong(1);
$("st-oct-down").onclick = () => transposeSong(-12);
$("st-oct-up").onclick = () => transposeSong(12);

let sentBpm = 0;                                       // the BPM last sent to the device (pushBpm)
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60) % 60).padStart(2, "0")}`;
/* the song panel: title, BPM, notes, length and a level from the notes' density */
function showSongInfo() {
  const c = chartNow(), mine = (keysOn() ? c.notes.length : 0) + (drumsOn() ? c.drums.length : 0), nps = mine / Math.max(1, c.length);
  const level = Math.max(1, Math.min(10, Math.round(nps * 2)));
  const shift = songShift.get(charts[$("song").value]) || 0;
  $("h-title").textContent = c.title;
  pushBpm(c.bpm);
  renderTabs();                                        // (the parts' names: the song's instruments)
  $("h-bpm").textContent = c.bpm;
  const count = inst === "keys" ? `${c.notes.length} notes` : inst === "drums" ? `${c.drums.length} hits` : `${c.notes.length} notes + ${c.drums.length} hits`;
  $("h-notes").textContent = `${count} · ${clock(c.length)}` + (c.section ? ` · section ${clock(c.section[0])}–${clock(c.section[1])}` : "") +
    (c.accomp.length ? ` · +${new Set(c.accomp.map((n) => n.ch)).size} part${new Set(c.accomp.map((n) => n.ch)).size > 1 ? "s" : ""}` : "") +
    (shift ? ` · ${shift > 0 ? "+" : ""}${shift}` : "");
  $("h-level").innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < level ? "on" : ""}${i >= 7 ? " hot" : ""}"></i>`).join("");
  $("h-level").setAttribute("aria-label", `Level ${level} of 10`);
}

function fillSongs(sel = 0) {
  $("song").length = 0;
  const real = (c) => c.parts.filter((p) => !p.generated).length;   // (not the built-in songs' generated beat)
  charts.forEach((c, i) => $("song").add(new Option(`${c.title} · ${c.bpm} bpm` + (real(c) > 1 ? ` · ${real(c)} instruments` : ""), i)));
  $("song").value = sel;
  loadSong(chartNow());
  showShift();
  showSongInfo();
}
fillSongs();
$("song").onchange = () => { reloadSong(); if (!$("setup").hidden) openSetup(); };
// a song's title from its file's name: no extension, underscores as spaces, spaces tidied ("my_song-v2.mid": "my song-v2")
const songTitle = (file) => file.replace(/\.(mid|midi|smf|kar)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
$("midfile").onchange = async () => {
  const f = $("midfile").files[0];
  if (!f) return;
  try {
    const chart = parseMidiFile(await f.arrayBuffer(), songTitle(f.name));
    charts.push(chart);
    stopSong();
    fillSongs(charts.length - 1);
    applyKeyboard();
    const notes = chart.parts.reduce((n, p) => n + p.notes.length, 0);
    ui.status(`Loaded ${chart.title}: ${chart.parts.length} instrument${chart.parts.length > 1 ? "s" : ""}, ${notes} notes` +
      (chart.trimmed > 0.05 ? `, ${chart.trimmed.toFixed(1)} s of silence trimmed.` : "."));
    openSetup();
  } catch (err) { ui.status("Could not read that MIDI file: " + err.message, true); }
  $("midfile").value = "";
};
/* ---- song setup: the section (a roll of the whole song, two handles) and who plays what */
const PART_LABEL = { you: "You · keys", drums: "You · drums", 3: "Instrument 1", 4: "Instrument 2", 5: "Instrument 3", 6: "Instrument 4", off: "Leave out" };
let preview = null;                                    // { part, timer }: an instrument heard alone
const setupChart = () => setupOf(charts[$("song").value]);

function openSetup() {
  const c = setupChart();
  $("su-title").textContent = c.title;
  $("su-adv").open = c.parts.filter((p) => !p.generated).length > 1;
  $("results").hidden = true;
  $("setup").hidden = false;
  renderParts();
  renderPartSounds();
  drawRoll();
}
function closeSetup() {
  stopPreview();
  $("setup").hidden = true;
}
$("setup-btn").onclick = () => ($("setup").hidden ? (stopSong(), openSetup()) : closeSetup());
$("su-done").onclick = closeSetup;
$("su-whole").onclick = () => { const c = setupChart(); c.range = { start: 0, end: c.beats.length - 1 }; afterSetup(); };
function afterSetup() { reloadSong(); drawRoll(); renderParts(); }

// the roll: time across (the whole song), pitch up; each instrument in its part's colour; the section between two handles
function drawRoll() {
  const cv = $("su-roll"), c = setupChart(), dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect();
  if (!r.width) return;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, total = beatAt(c, c.beats.length - 1);
  const all = c.parts.flatMap((p) => p.notes.map((n) => n.p));
  const lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
  const x = (t) => (t / total) * W, y = (p) => H - ((p - lo) / (hi - lo)) * (H - 8 * dpr) - 4 * dpr;
  ctx.fillStyle = `rgb(${game.th.mid})`; ctx.fillRect(0, 0, W, H);   // (the highway's water: the theme's)
  const bar = c.beatsPerBar || 4;
  for (let b = 0; b < c.beats.length; b += bar) {        // bar lines (every 4th one brighter)
    ctx.fillStyle = (b / bar) % 4 === 0 ? `rgba(${game.th.text},0.14)` : `rgba(${game.th.text},0.05)`;
    ctx.fillRect(Math.round(x(beatAt(c, b))), 0, Math.max(1, dpr), H);
  }
  const order = c.parts.map((p, i) => i).sort((a, b) => (c.assign[a] === "off") - (c.assign[b] === "off")).reverse();
  for (const i of order) {                               // (the left-out ones under the rest)
    ctx.fillStyle = PART_COLORS[c.assign[i]];
    const h = Math.max(1.5 * dpr, (H / (hi - lo)) * 0.8);
    for (const n of c.parts[i].notes) ctx.fillRect(x(n.t), y(n.p) - h / 2, Math.max(dpr, x(n.d)), h);
  }
  const sx = x(beatAt(c, c.range.start)), ex = x(beatAt(c, c.range.end));
  ctx.fillStyle = `rgba(${game.th.base},0.72)`;          // outside the section: dimmed
  ctx.fillRect(0, 0, sx, H); ctx.fillRect(ex, 0, W - ex, H);
  for (const hx of [sx, ex]) {                            // the handles
    ctx.fillStyle = `rgb(${game.th.accent})`;
    ctx.fillRect(hx - dpr, 0, 2 * dpr, H);
    ctx.beginPath(); ctx.roundRect(hx - 6 * dpr, H / 2 - 16 * dpr, 12 * dpr, 32 * dpr, 4 * dpr); ctx.fill();
    ctx.fillStyle = "rgba(42,10,14,0.8)";
    for (const dy of [-6, 0, 6]) ctx.fillRect(hx - 3 * dpr, H / 2 + (dy - 0.5) * dpr, 6 * dpr, dpr);
  }
  const t0 = beatAt(c, c.range.start), t1 = beatAt(c, c.range.end);
  $("su-range").textContent = `${clock(t0)} → ${clock(t1)} · ${clock(t1 - t0)} · bars ${Math.floor(c.range.start / bar) + 1}–${Math.ceil(c.range.end / bar)}`;
}
addEventListener("resize", () => { if (!$("setup").hidden) drawRoll(); });
(() => {                                                 // dragging the handles (or clicking near one), snapped to beats
  const cv = $("su-roll");
  let which = null;
  const beatOf = (e) => {
    const c = setupChart(), r = cv.getBoundingClientRect(), total = beatAt(c, c.beats.length - 1);
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
    let b = 0;
    while (b + 1 < c.beats.length && Math.abs(beatAt(c, b + 1) - t) < Math.abs(beatAt(c, b) - t)) b++;
    return b;
  };
  const apply = (e) => {
    const c = setupChart(), b = beatOf(e);
    if (which === "start") c.range.start = Math.min(b, c.range.end - 1);
    else c.range.end = Math.max(b, c.range.start + 1);
    drawRoll();
  };
  cv.addEventListener("pointerdown", (e) => {
    const c = setupChart(), b = beatOf(e);
    which = Math.abs(b - c.range.start) <= Math.abs(b - c.range.end) ? "start" : "end";
    cv.setPointerCapture(e.pointerId);
    apply(e);
  });
  cv.addEventListener("pointermove", (e) => { if (which) apply(e); });
  const up = () => { if (which) { which = null; reloadSong(); renderParts(); } };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
})();

// who plays what: a row per instrument (▶ alone, its notes and range, its part)
function renderParts() {
  const c = setupChart(), t0 = beatAt(c, c.range.start), t1 = beatAt(c, c.range.end);
  $("su-parts").innerHTML = "";
  c.parts.forEach((p, i) => {
    const inSec = p.notes.filter((n) => n.t >= t0 && n.t < t1);
    const ps = p.notes.map((n) => n.p), who = c.assign[i];
    const tr = document.createElement("tr");
    tr.className = who === "off" ? "off" : "";
    tr.style.setProperty("--c", who === "off" ? "transparent" : PART_COLORS[who]);
    tr.innerHTML = `<td><button class="prev" title="Hear it alone">▶</button></td>
      <td class="nm"></td><td class="num">${p.ch}</td><td class="num">${inSec.length}</td>
      <td>${p.drum ? "drums" : `${noteName(Math.min(...ps))}–${noteName(Math.max(...ps))}`}</td><td><select></select></td>`;
    tr.querySelector(".nm").textContent = p.name;
    if (p.track && p.track !== p.name) { const sm = document.createElement("small"); sm.textContent = p.track; tr.querySelector(".nm").append(sm); }
    const sel = tr.querySelector("select");
    for (const k of ["you", "drums", 3, 4, 5, 6, "off"]) sel.add(new Option(PART_LABEL[k], k));
    sel.value = who;
    sel.style.setProperty("--c", who === "off" ? "" : PART_COLORS[who]);
    sel.onchange = () => { c.assign[i] = ["you", "drums", "off"].includes(sel.value) ? sel.value : Number(sel.value); afterSetup(); };
    const pb = tr.querySelector(".prev");
    pb.classList.toggle("on", preview && preview.part === i);
    pb.onclick = () => togglePreview(i);
    $("su-parts").append(tr);
  });
  const missing = [keysOn() && !c.assign.includes("you") && "keys", drumsOn() && !c.assign.includes("drums") && "drums"].filter(Boolean);
  if (missing.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td colspan="5" class="warn-text">No instrument is set to You · ${missing.join(" or You · ")}: nothing for you to play there.</td>`;
    $("su-parts").append(tr);
  }
}
function stopPreview() {
  if (!preview) return;
  clearTimeout(preview.timer);
  send({ type: "clearTimed" });
  preview = null;
  if (!$("setup").hidden) renderParts();
}
// an instrument alone, on its part: 8 s from its first note in the section (its first note at all, if the section
// has none), so an instrument that comes in late is heard at once
function togglePreview(i) {
  const was = preview && preview.part === i;
  stopPreview();
  if (was || !ac || playing()) return;
  const c = setupChart(), p = c.parts[i], who = c.assign[i], ch = typeof who === "number" ? who : who === "drums" || p.drum ? 2 : 1;
  const s0 = beatAt(c, c.range.start), s1 = beatAt(c, c.range.end);
  const first = p.notes.find((n) => n.t >= s0 - 1e-6 && n.t < s1) || p.notes[0];
  if (!first) return;
  const t0 = first.t, shift = p.drum ? 0 : songShift.get(c) || 0, at0 = ac.currentTime + 0.1;
  ui.status(`▶ ${p.name} from ${clock(t0)}` + (first.t < s0 || first.t >= s1 ? " (no notes in the section)" : ""));
  for (const n of p.notes) {
    if (n.t < t0 || n.t >= t0 + 8) continue;
    const at = at0 + n.t - t0, pitch = n.p + shift;
    if (pitch < 0 || pitch > 127) continue;
    send({ type: "midiAt", at, data: [0x90 | (ch - 1), pitch, n.v || 96] });
    send({ type: "midiAt", at: at + Math.max(0.04, n.d - 0.02), data: [0x80 | (ch - 1), pitch, 0] });
  }
  preview = { part: i, timer: setTimeout(stopPreview, 8300) };
  renderParts();
}

// the device's parts 2..4: their sounds (any factory preset), as the device has them
function renderPartSounds() {
  const box = $("su-sounds");
  box.textContent = "";
  if (!sounds.length) { box.innerHTML = `<p class="dim small">Switch on to choose the parts' sounds.</p>`; return; }
  for (const t of [2, 3, 4, 5]) {                      // (parts 3..6: the keys and the drums are the Sound tabs')
    const lab = document.createElement("label"), sel = document.createElement("select");
    lab.style.setProperty("--c", PART_COLORS[t + 1]);
    lab.innerHTML = `<b></b>`;
    lab.firstChild.textContent = partName(t);
    const groups = new Map();
    for (const snd of sounds) {
      if (!groups.has(snd.engineName)) { const g = document.createElement("optgroup"); g.label = snd.engineName; groups.set(snd.engineName, g); sel.append(g); }
      groups.get(snd.engineName).append(new Option(snd.name, `${snd.engine}:${snd.preset}`));
    }
    sel.dataset.track = t;
    const cur = trackSounds[t];
    if (cur) sel.value = `${cur[0]}:${cur[1]}`;
    sel.onchange = () => { const [e, k] = sel.value.split(":").map(Number); send({ type: "trackPreset", track: t, engine: e, preset: k }); };
    lab.append(sel);
    box.append(lab);
  }
}
function syncPartSounds(tracks) {                      // (a frame: the device's own changes show here too)
  trackSounds = tracks;
  for (const sel of $("su-sounds").querySelectorAll("select")) {
    const cur = tracks[Number(sel.dataset.track)];
    if (cur && document.activeElement !== sel) sel.value = `${cur[0]}:${cur[1]}`;
  }
}

/* ---- the piano's size and octave (remembered) */
const KEYS_DEFAULT = 49;                               // (a 49-key keyboard: C2..C6)
let keySize = Number(store.get("keysize")) || KEYS_DEFAULT, keyShift = Number(store.get("keyshift")) || 0;
if (!KEYBOARDS[keySize]) keySize = KEYS_DEFAULT;
function applyKeyboard() {
  const [lo, hi] = KEYBOARDS[keySize];
  keyShift = Math.max(Math.ceil((12 - lo) / 12), Math.min(Math.floor((115 - hi) / 12), keyShift));   // stays inside MIDI
  game.setKeyboard(keySize, keyShift);
  $("keysize").value = keySize;
  $("range").textContent = `${noteName(game.lo)}–${noteName(game.hi)}`;
  if (!playing()) loadSong(chartNow());                // (what is outside the keys: sorted again for these keys)
  const n = chartNow().outside, notes = `${n} note${n > 1 ? "s" : ""}`;
  $("range-warn").hidden = !n;
  $("range-ok").hidden = !!n;
  $("range-warn").textContent = !n ? "" : outMode === "auto" ? `${notes} outside these keys: the device plays them (not scored)` :
    outMode === "fold" ? `${notes} outside these keys: folded onto them by octaves` : `${notes} outside these keys: out of reach (misses)`;
  $("range-warn").classList.toggle("warn-text", outMode === "score");
  $("range-warn").classList.toggle("dim", outMode !== "score");
  store.set("keysize", keySize);
  store.set("keyshift", keyShift);
  const t = midiTranspose();
  $("transpose-v").textContent = t ? `MIDI keyboard ${t > 0 ? "+" : ""}${t}` : "";
}
$("transpose").onchange = () => { store.set("transpose", $("transpose").checked ? "1" : "0"); applyKeyboard(); };
$("transpose").checked = store.get("transpose") !== "0";
$("keysize").onchange = () => { keySize = Number($("keysize").value); keyShift = 0; applyKeyboard(); };
$("outside").value = outMode;
$("outside").onchange = () => { outMode = $("outside").value; store.set("outside", outMode); stopSong(); applyKeyboard(); showSongInfo(); };
$("oct-down").onclick = () => { keyShift--; applyKeyboard(); };
$("oct-up").onclick = () => { keyShift++; applyKeyboard(); };
applyKeyboard();

// the speed: a multiplier, x0.5 to x16 (x1: 150 px a second on a 600 px highway, 4 s top to hit line; the highways scale it to
// their height); finer at the slow end. Kept as the multiplier ("speedx")
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const SPEED_X1 = 150, SPEED_DEFAULT = 4;
function setSpeed(x, save = true) {
  let i = 0;                                            // (the nearest step)
  SPEEDS.forEach((v, k) => { if (Math.abs(v - x) < Math.abs(SPEEDS[i] - x)) i = k; });
  $("speed").value = i;
  $("speed-v").textContent = `x${SPEEDS[i]}`;
  game.speed = SPEED_X1 * SPEEDS[i];
  if (save) store.set("speedx", SPEEDS[i]);
}
$("speed").oninput = () => setSpeed(SPEEDS[Number($("speed").value)]);
$("offset").oninput = () => { game.offset = Number($("offset").value) / 1000; $("offset-v").textContent = `${$("offset").value} ms`; store.set("offset", $("offset").value); };
$("letters").onchange = () => { game.showLetters = $("letters").checked; store.set("letters", $("letters").checked ? "1" : "0"); };
$("metro").onchange = () => store.set("metro", $("metro").checked ? "1" : "0");
// the drum screen's width (Drums only), kept
const DRUM_W_DEFAULT = 55;
function setDrumWidth(pct, save = true) {
  pct = Math.max(30, Math.min(100, Math.round(pct / 5) * 5));
  $("drum-w").value = pct;
  $("drum-w-v").textContent = `${pct}%`;
  $("highway").parentElement.style.setProperty("--drum-w", `${pct}%`);
  if (save) store.set("drumw", pct);
}
$("drum-w").oninput = () => setDrumWidth(Number($("drum-w").value));
setDrumWidth(Number(store.get("drumw")) || DRUM_W_DEFAULT, false);
// (kept from last time)
if (store.get("speedx") !== null) setSpeed(Number(store.get("speedx")), false);
else if (store.get("speed") !== null) { setSpeed(Number(store.get("speed")) / SPEED_X1); store.del("speed"); }   // (was px a second)
else setSpeed(SPEED_DEFAULT, false);
if (store.get("offset") !== null) { $("offset").value = store.get("offset"); game.offset = Number($("offset").value) / 1000; $("offset-v").textContent = `${$("offset").value} ms`; }
if (store.get("letters") !== null) { $("letters").checked = store.get("letters") === "1"; game.showLetters = $("letters").checked; }
if (store.get("metro") !== null) $("metro").checked = store.get("metro") === "1";

/* ---- settings kept in this browser: the theme and the four parts' sounds (saved as they change, on the page or on the
 * device), the piano's size / octave, MIDI keyboard transpose, speed, offset, metronome, key letters. Defaults: all back */
const SAVED = STORE_KEYS;
let bootTracks = null, saveAfter = Infinity;
function defaultSounds() {                             // the parts' power-on sounds, part 1 (yours) a piano
  const piano = sounds.find((x) => x.engineName === "CZ-1" && x.name === "PIANO 1");
  return bootTracks.map((t, i) => (i === 0 && piano ? [piano.engine, piano.preset] : t));
}
function loadSounds(list) { list.forEach(([e, k], t) => send({ type: "trackPreset", track: t, engine: e, preset: k })); }
function restoreSettings(m) {                          // at power-on: the saved theme and sounds (or the defaults)
  bootTracks = m.tracks;
  const i = palettes.findIndex((p) => p.name === store.get("theme"));
  if (i >= 0) send({ type: "palette", index: i });
  let list = null;
  try { list = JSON.parse(store.get("sounds")); } catch {}
  const valid = Array.isArray(list) && list.length === PART_TABS.length &&
    list.every((x) => Array.isArray(x) && sounds.some((snd) => snd.engine === x[0] && snd.preset === x[1]));
  loadSounds(valid ? list : defaultSounds());
  bootMix = m.mix;
  mixState = JSON.parse(JSON.stringify(m.mix));
  let saved = null;
  try { saved = JSON.parse(store.get("mix")); } catch {}
  const shape = (x) => x && Array.isArray(x.tracks) && x.tracks.length === PART_TABS.length && x.tracks.every((r) => r.length === 7) &&
    Array.isArray(x.rack) && x.rack.length === 4 && x.rack.every((r) => r.length === 5);
  if (shape(saved)) applyMix(saved);
  saveAfter = performance.now() + 1500;                // (the device has them by then; from there, what it shows is kept)
}
function saveFromFrame(m) {
  if (performance.now() < saveAfter) return;
  const name = palettes[m.palette] && palettes[m.palette].name, json = JSON.stringify(m.tracks);
  if (name && name !== store.get("theme")) store.set("theme", name);
  if (json !== store.get("sounds")) store.set("sounds", json);
}
function resetAll() {
  stopSong();
  for (const k of SAVED) store.del(k);
  keySize = KEYS_DEFAULT; keyShift = 0;               // the page
  outMode = "auto"; $("outside").value = "auto";
  $("transpose").checked = true;
  applyKeyboard();
  setSpeed(SPEED_DEFAULT, false);
  $("offset").value = 0; game.offset = 0; $("offset-v").textContent = "0 ms";
  $("metro").checked = false;                          // (off by default)
  setDrumWidth(DRUM_W_DEFAULT, false);
  $("letters").checked = true; game.showLetters = true;
  setMode(true);
  if (midi) for (const id of roles.keys()) roles.delete(id);   // the devices: the top selector's one, as Keyboard
  setInstrument("keys");
  if (midi) fillInputs();
  songShift.clear();                                   // the songs' setups: transpose, section, who plays what
  for (const c of charts) { delete c.assign; delete c.range; }
  reloadSong();
  if (!$("setup").hidden) openSetup();
  if (node && bootTracks) {                            // the device: LO-FI, the parts' first sounds
    const lofi = palettes.findIndex((p) => p.name === "LO-FI");
    if (lofi >= 0) send({ type: "palette", index: lofi });
    loadSounds(defaultSounds());
    if (bootMix) applyMix({ ...bootMix, master: 700 });
    store.del("mix");
    saveAfter = performance.now() + 1500;
  }
  ui.status("Every setting is back to its default.");
}
let resetArmed = null;                                 // two clicks: Defaults, then Reset all? (3 s to confirm)
$("defaults").onclick = () => {
  if (resetArmed) { clearTimeout(resetArmed); resetArmed = null; $("defaults").textContent = "Defaults"; $("defaults").classList.remove("armed"); resetAll(); return; }
  $("defaults").textContent = "Reset all?";
  $("defaults").classList.add("armed");
  resetArmed = setTimeout(() => { resetArmed = null; $("defaults").textContent = "Defaults"; $("defaults").classList.remove("armed"); }, 3000);
};

/* ---- schedulers: metronome clicks, the CPU's notes and the band, a little ahead of the audio clock */
let timer = null, nextBeat = 0, nextNote = 0, nextDrum = 0, nextAcc = 0, demoRun = true, cpuPlayed = false;
let cpuHits = [];                                      // the CPU's drum hits waiting to be judged (timeouts)

/* who plays: CPU (the default: the song plays itself) or User. Switchable mid-song: User takes over from here,
 * CPU picks up from the notes still to come */
function setMode(cpu) {
  demoRun = cpu;
  $("mode-cpu").setAttribute("aria-checked", cpu);
  $("mode-user").setAttribute("aria-checked", !cpu);
  if (!playing()) return;
  if (cpu) {
    cpuPlayed = true;
    const now = ac.currentTime - lead().t0 - game.offset;
    const next = (g) => { const i = g.chart.notes.findIndex((n) => n.t > now + 0.03 && !n.j); return i < 0 ? g.chart.notes.length : i; };
    if (active.keys) nextNote = next(game);
    if (active.drums) nextDrum = next(drum);
    schedule();
  } else {                                             // (your parts' queued notes: released, not played; the band plays on)
    if (active.keys) send({ type: "clearTimed", ch: 0 });
    if (active.drums) { send({ type: "clearTimed", ch: DRUM_CH }); cpuHits.forEach(clearTimeout); cpuHits = []; }
  }
}
$("mode-cpu").onclick = () => setMode(true);
$("mode-user").onclick = () => setMode(false);

/* the song's tempo to the device (its screen's BPM); the device takes 40..240 */
function pushBpm(bpm) {
  const v = Math.round(bpm);
  if (!v || v === sentBpm) return;
  sentBpm = v;
  send({ type: "bpm", bpm: v });
}
function click(at, accent) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.14, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  o.connect(g).connect(ac.destination);
  o.start(at); o.stop(at + 0.06);
}
function schedule() {
  if (!playing()) return;
  const chart = songChart, bar = chart.beatsPerBar || 4, ahead = ac.currentTime + 0.25, t0 = lead().t0 + game.offset;
  const at = (b) => t0 + beatAt(chart, b);             // (the tempo map: beats move with it)
  for (; at(nextBeat) < ahead && beatAt(chart, nextBeat) <= chart.length; nextBeat++) {
    if ($("metro").checked) click(at(nextBeat), ((nextBeat % bar) + bar) % bar === 0);
    if (nextBeat >= 0) pushBpm(60 / (beatAt(chart, nextBeat + 1) - beatAt(chart, nextBeat)));   // (a tempo map: follows it)
  }
  const play = (n, ch) => {                            // a note on a part (MIDI channel ch: part ch, ROUT CH1-4)
    const when = t0 + n.t, c = (ch - 1) & 15;
    send({ type: "midiAt", at: when, data: [0x90 | c, n.p, n.v || 96] });
    send({ type: "midiAt", at: when + Math.max(0.04, n.d - 0.02), data: [0x80 | c, n.p, 0] });
    return when;
  };
  if (demoRun && active.keys)                          // CPU: your keys, on part 1 (the engine reports them: judged)
    for (; nextNote < game.chart.notes.length && t0 + game.chart.notes[nextNote].t < ahead; nextNote++) play(game.chart.notes[nextNote], 1);
  if (demoRun && active.drums)                         // CPU: your drums, on part 2, each judged at its time
    for (; nextDrum < drum.chart.notes.length && t0 + drum.chart.notes[nextDrum].t < ahead; nextDrum++) {
      const n = drum.chart.notes[nextDrum], when = play(n, 2);
      cpuHits.push(setTimeout(() => drum.hit(n.lane, when), Math.max(0, (when - ac.currentTime) * 1000)));
    }
  for (; nextAcc < chart.accomp.length && t0 + chart.accomp[nextAcc].t < ahead; nextAcc++)   // the band
    play(chart.accomp[nextAcc], chart.accomp[nextAcc].ch);
}
function endSchedulers() {
  clearInterval(timer);
  timer = null;
  cpuHits.forEach(clearTimeout);
  cpuHits = [];
  send({ type: "clearTimed" });
}
let songChart = null;                                  // (what is playing: chartNow() at Play)
function loadSong(chart) { game.load(chart); drum.load(chart); }
function startSong() {
  if (!ac) return;
  $("results").hidden = true;
  const chart = (songChart = chartNow()), spb = beatAt(chart, 1) - beatAt(chart, 0), bar = chart.beatsPerBar || 4;
  const countIn = Math.ceil(Math.max(3, bar * spb) / spb);          // whole beats at the opening tempo: 3 s or a bar
  cpuPlayed = demoRun;
  sentBpm = 0;
  pushBpm(chart.bpm);
  send({ type: "view" });                              // the screen: the chord view, what is being played
  loadSong(chart);
  const t0 = ac.currentTime + 0.1 + countIn * spb;
  active = { keys: keysOn(), drums: drumsOn() };
  ended = {};
  if (active.keys) game.start(t0);
  if (active.drums) drum.start(t0);
  nextBeat = -countIn;
  nextNote = nextDrum = nextAcc = 0;
  closeSetup();
  timer = setInterval(schedule, 40);
  schedule();
  updateHud();
  $("play").textContent = "Stop";
}
function stopSong() {
  if (!playing()) return;
  endSchedulers();
  game.stop();
  drum.stop();
  $("play").textContent = "Play";
  pushBpm(chartNow().bpm);                             // (back to the song's opening tempo)
}
$("chordview").onclick = () => send({ type: "view" });
$("play").onclick = () => (playing() ? stopSong() : startSong());
$("again").onclick = () => startSong();
$("freeplay").onclick = () => { $("results").hidden = true; };   // (no song running: free play)

/* ---- the mixer & effects: the device's own mix (level, pan, sends, mute; solo here) and its shared FX rack (4 slots,
 * CHAIN or SPLIT, a return). Read from the device (refreshed while open: its own knobs show here), set as you move a
 * control, kept in this browser; Reset mix / Defaults: the device's power-on mix */
const FX_TYPES = [["", [[0, "Off"]]], ["Space", [[7, "Room"], [8, "Reverb"], [2, "Width"]]],
  ["Motion", [[1, "Phaser"], [9, "Chorus"], [17, "Flanger"], [18, "Pedal phaser"], [19, "Pedal chorus"]]],
  ["Dirt", [[12, "Drive · soft"], [13, "Drive · hard"], [14, "Drive · fold"], [15, "Drive · fuzz"], [16, "Crush"]]],
  ["Colour", [[3, "Formant"], [4, "Tape"], [5, "Spit"]]]];
let mixState = null, bootMix = null, mixPoll = null, solo = new Set(), preSolo = null;
const SENDS = [3, 4, 5, 6];                            // a part's fields: its send to each of the rack's four slots (SPLIT)
const pct = (v) => `${Math.round((v * 100) / 127)}%`;
const panText = (v) => (v === 0 ? "C" : v < 0 ? `L${-v}` : `R${v}`);
const toneText = (v) => (v === 0 ? "full" : v < 0 ? `hi ${-v}` : `lo ${v}`);
function saveMix() { if (mixState) store.set("mix", JSON.stringify({ ...mixState, master })); }
function setTrack(t, k, v) { mixState.tracks[t][k] = v; send({ type: "tparam", track: t, k, v }); saveMix(); }
function setRack(sl, f, v) {
  if (f === 5) mixState.ret = v; else if (f === 6) mixState.mode = v; else mixState.rack[sl][f] = v;
  if (f === 0 && v === 8) mixState.rack.forEach((r, k) => { if (k !== sl && r[0] === 8) r[0] = 0; });   // (one reverb, as the device keeps it)
  send({ type: "rack", slot: sl, f, v });
  saveMix();
}
function ctl(label, min, max, value, fmt, oninput) {      // a labelled slider with its value
  const el = document.createElement("label");
  el.className = "mx-ctl";
  el.innerHTML = `<span></span><input type="range" min="${min}" max="${max}"><output></output>`;
  el.firstChild.textContent = label;
  const input = el.querySelector("input"), out = el.querySelector("output");
  input.value = value;
  out.textContent = fmt(value);
  input.oninput = () => { out.textContent = fmt(Number(input.value)); oninput(Number(input.value)); };
  el.sync = (v) => { if (document.activeElement !== input) { input.value = v; out.textContent = fmt(v); } };
  return el;
}
function renderMixer() {
  if (!mixState) return;
  const strips = $("mx-strips");
  strips.textContent = "";
  PART_TABS.forEach((tab, t) => {
    const row = mixState.tracks[t], cur = trackSounds[t], snd = cur && sounds.find((x) => x.engine === cur[0] && x.preset === cur[1]);
    const el = document.createElement("div");
    el.className = "mx-strip" + (row[2] ? " muted" : "");
    el.style.setProperty("--c", PART_COLORS[tab.part]);
    el.innerHTML = `<div class="nm"><b></b><small></small></div>`;
    el.querySelector("b").textContent = `${partName(t)}${(t === 0 && keysOn()) || (t === 1 && drumsOn()) ? " · you" : ""}`;
    el.querySelector("small").textContent = snd ? `${snd.name} · ${snd.engineName}` : `part ${t + 1}`;
    el.append(ctl("Level", 0, 127, row[0], pct, (v) => setTrack(t, 0, v)));
    el.append(ctl("Pan", -64, 63, row[1], panText, (v) => setTrack(t, 1, v)));
    const sends = document.createElement("div");
    sends.className = "mx-sends";
    (mixState.mode ? SENDS : [3]).forEach((k, i) =>
      sends.append(ctl(mixState.mode ? `FX ${i + 1}` : "FX send", 0, 127, row[k], pct, (v) => setTrack(t, k, v))));
    el.append(sends);
    const btns = document.createElement("div");
    btns.className = "mx-btns";
    btns.innerHTML = `<button class="m" title="Mute">M</button><button class="s" title="Solo: only the soloed parts sound">S</button>`;
    const [mb, sb] = btns.children;
    mb.classList.toggle("on", !!row[2]);
    sb.classList.toggle("on", solo.has(t));
    mb.onclick = () => { setTrack(t, 2, row[2] ? 0 : 1); renderMixer(); };
    sb.onclick = () => toggleSolo(t);
    el.append(btns);
    strips.append(el);
  });
  const m = document.createElement("div");                // the master: the FM-1's MASTER knob
  m.className = "mx-strip master";
  m.innerHTML = `<div class="nm"><b>Master</b><small>the device's output</small></div>`;
  m.append(ctl("Volume", 0, 1023, master, (v) => `${Math.round((v * 100) / 1023)}%`, (v) => setMaster(v)));
  strips.append(m);
  // the rack
  for (const b of $("mx-mode").children) b.setAttribute("aria-checked", Number(b.dataset.mode) === mixState.mode);
  $("mx-return").value = mixState.ret;
  $("mx-return-v").textContent = pct(mixState.ret);
  const rack = $("mx-rack");
  rack.textContent = "";
  mixState.rack.forEach((r, sl) => {
    const card = document.createElement("div");
    card.className = "mx-slot" + (r[0] ? " live" : "");
    card.innerHTML = `<div class="slot-h"><b>Slot ${sl + 1}</b><select aria-label="Slot ${sl + 1} effect"></select></div>`;
    const sel = card.querySelector("select");
    for (const [fam, list] of FX_TYPES) {
      const parent = fam ? Object.assign(document.createElement("optgroup"), { label: fam }) : sel;
      for (const [id, name] of list) parent.append(new Option(name, id));
      if (fam) sel.append(parent);
    }
    sel.value = r[0];
    sel.onchange = () => { setRack(sl, 0, Number(sel.value)); renderMixer(); };
    card.append(ctl("Mix", 0, 127, r[1], pct, (v) => setRack(sl, 1, v)));
    card.append(ctl("Rate", 0, 127, r[2], String, (v) => setRack(sl, 2, v)));
    card.append(ctl("Character", 0, 127, r[3], String, (v) => setRack(sl, 3, v)));
    const tone = ctl("Tone", -63, 63, r[4], toneText, (v) => setRack(sl, 4, v));
    tone.hidden = r[0] !== 7 && r[0] !== 8;                // (ROOM and REVERB have a TONE)
    card.append(tone);
    for (const c of card.querySelectorAll(".mx-ctl")) c.style.opacity = r[0] ? "" : ".4";
    rack.append(card);
  });
}
function syncMixer(mix) {                              // the device's values into the open panel (what you are dragging stays)
  const before = JSON.stringify([mixState && mixState.mode, mixState && mixState.rack.map((r) => r[0]), mixState && mixState.tracks.map((r) => r[2])]);
  mixState = mix;
  const after = JSON.stringify([mix.mode, mix.rack.map((r) => r[0]), mix.tracks.map((r) => r[2])]);
  if ($("mixer").hidden) return;
  if (before !== after) return renderMixer();
  const strips = [...$("mx-strips").children];
  mix.tracks.forEach((row, t) => {
    const c = strips[t] && strips[t].querySelectorAll(".mx-ctl");
    if (!c) return;
    c[0].sync(row[0]); c[1].sync(row[1]);
    (mix.mode ? SENDS : [3]).forEach((k, i) => c[2 + i] && c[2 + i].sync(row[k]));
  });
  [...$("mx-rack").children].forEach((card, sl) => { const c = card.querySelectorAll(".mx-ctl"); [1, 2, 3, 4].forEach((f, i) => c[i].sync(mix.rack[sl][f])); });
  if (document.activeElement !== $("mx-return")) { $("mx-return").value = mix.ret; $("mx-return-v").textContent = pct(mix.ret); }
}
function toggleSolo(t) {
  if (!solo.size) preSolo = mixState.tracks.map((r) => r[2]);   // (the mutes to come back to)
  if (solo.has(t)) solo.delete(t); else solo.add(t);
  mixState.tracks.forEach((r, k) => setTrack(k, 2, solo.size ? (solo.has(k) ? 0 : 1) : preSolo[k]));
  renderMixer();
}
function setMaster(v) {
  master = v;
  send({ type: "master", value: v });
  const k = knobs.find((x) => x.id === "master");      // (the Advanced panel's MASTER knob follows)
  if (k) { k.angle = -135 + (270 * v) / 1023; k.el.style.setProperty("--angle", `${k.angle}deg`); }
  saveMix();
}
function applyMix(mix) {                               // a whole mix to the device (restored, reset)
  solo.clear();
  mixState = JSON.parse(JSON.stringify(mix));
  send({ type: "setMix", mix: mixState });
  if (typeof mix.master === "number") setMaster(mix.master);
  renderMixer();
}
$("mixer-btn").onclick = () => {
  if (!node) { ui.status("Switch the device on first.", true); return; }
  $("mixer").hidden = false;
  send({ type: "getMix" });
  renderMixer();
  clearInterval(mixPoll);
  mixPoll = setInterval(() => send({ type: "getMix" }), 600);
};
const closeMixer = () => { $("mixer").hidden = true; clearInterval(mixPoll); };
$("mx-done").onclick = closeMixer;
$("mixer").addEventListener("pointerdown", (e) => { if (e.target === $("mixer")) closeMixer(); });
$("mx-reset").onclick = () => { if (bootMix) { applyMix({ ...bootMix, master: 700 }); store.del("mix"); } };
for (const b of $("mx-mode").children) b.onclick = () => { setRack(0, 6, Number(b.dataset.mode)); renderMixer(); };
$("mx-return").oninput = () => { $("mx-return-v").textContent = pct(Number($("mx-return").value)); setRack(0, 5, Number($("mx-return").value)); };

/* ---- what you play: Keyboard, Drums or Both (the top bar, the welcome card); kept */
function setInstrument(v) {
  if (!["keys", "drums", "both"].includes(v)) return;
  stopSong();
  inst = v;
  store.set("instrument", v);
  for (const b of document.querySelectorAll("[data-inst]")) b.setAttribute("aria-checked", b.dataset.inst === v);
  $("highway").hidden = !keysOn();
  $("drumway").hidden = !drumsOn();
  $("highway").parentElement.classList.toggle("drums-only", v === "drums");
  $("keys-row").hidden = !keysOn();
  $("drums-box").hidden = v !== "drums";               // (Drums only: its screen's width)
  $("welcome-two").hidden = v !== "both";
  if (midi) {                                          // the top selector's device: as this instrument asks
    const id = $("midiin").value, active = [...roles.values()].filter((r) => r !== "off").length;
    if (id && active <= 1) { roles.set(id, roleForInstrument()); renderRouting(); }
  }
  game.clearHeld();
  if (v === "drums") setSoundTab(1); else if (v === "keys" && sndTarget === 1) setSoundTab(0); else renderTabs();
  reloadSong();
  updateHud();
  if (!$("setup").hidden) openSetup();
}
for (const b of document.querySelectorAll("[data-inst]")) b.addEventListener("click", () => setInstrument(b.dataset.inst));

(function loop() {
  drum.speed = game.speed;
  drum.offset = game.offset;
  game.frame();
  drum.frame();
  requestAnimationFrame(loop);
})();
setInstrument(inst);

// development: the game's state for local tests (localhost only)
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") window.muse = { game, drum, charts, chartNow };
