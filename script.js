
'use strict';
/* =====================================================================
   AIRDRUM — drum virtual berbasis gestur tangan
   Daftar isi:
     1. Konfigurasi instrumen, file audio, dan bank suara sintesis
     2. State & penyimpanan (localStorage)
     3. Audio engine (Web Audio API): rantai mixer, sintesis, sampel
     4. Trigger & umpan balik visual
     5. Zona drum (DOM) + fitur memindahkan posisi
     6. Deteksi gestur (MediaPipe Hands)
     7. Metronom
     8. Web MIDI
     9. Keyboard
    10. Rekam & ekspor
    11. UI (panel pengaturan, mixer, tab, toast)
    12. Inisialisasi
   ===================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* =====================================================================
   1. KONFIGURASI
   ===================================================================== */

/* Setiap instrumen: posisi awal (x,y dalam % panggung), ukuran (s, satuan vmin),
   hue warna, tombol keyboard default (event.code), dan nomor note MIDI default
   (mengikuti General MIDI drum map). Urutan array = urutan di daftar pengaturan.
   Tata letak default meniru drum akustik dari sudut pandang pemain. */
const PIECES = [
  { id: 'kick',  name: 'Kick',          type: 'kick',   hue: 210, x: 52, y: 79, s: 24, key: 'Space', note: 36 },
  { id: 'snare', name: 'Snare',         type: 'drum',   hue: 175, x: 28, y: 67, s: 15, key: 'KeyJ',  note: 38 },
  { id: 'hhc',   name: 'Hi-Hat Closed', type: 'cymbal', hue: 54,  x: 11, y: 58, s: 12, key: 'KeyF',  note: 42 },
  { id: 'hho',   name: 'Hi-Hat Open',   type: 'cymbal', hue: 50,  x: 9,  y: 35, s: 11, key: 'KeyG',  note: 46 },
  { id: 'tom1',  name: 'High Tom',      type: 'drum',   hue: 285, x: 41, y: 38, s: 13, key: 'KeyU',  note: 50 },
  { id: 'tom2',  name: 'Mid Tom',       type: 'drum',   hue: 262, x: 58, y: 38, s: 13, key: 'KeyI',  note: 47 },
  { id: 'floor', name: 'Floor Tom',     type: 'drum',   hue: 240, x: 78, y: 64, s: 16, key: 'KeyO',  note: 43 },
  { id: 'crash', name: 'Crash',         type: 'cymbal', hue: 44,  x: 22, y: 19, s: 15, key: 'KeyR',  note: 49 },
  { id: 'ride',  name: 'Ride',          type: 'cymbal', hue: 38,  x: 80, y: 24, s: 16, key: 'KeyP',  note: 51 },
];
const PIECE = Object.fromEntries(PIECES.map(p => [p.id, p]));

const PAN_DEFAULT = { kick: 0, snare: -0.1, hhc: -0.5, hho: -0.5, tom1: -0.2, tom2: 0.15, floor: 0.4, crash: -0.35, ride: 0.5 };

/* Hi-hat closed & open berbagi satu "stand": memukul salah satunya
   memotong (choke) suara hi-hat yang sedang berbunyi. */
const CHOKE_GROUP = { hhc: 'hat', hho: 'hat' };

/* Alias note General MIDI tambahan supaya modul drum standar langsung bekerja. */
const MIDI_ALIASES = {
  35: 'kick', 37: 'snare', 39: 'snare', 40: 'snare', 44: 'hhc',
  48: 'tom1', 45: 'tom2', 41: 'floor', 57: 'crash', 55: 'crash', 52: 'crash', 53: 'ride', 59: 'ride',
};

/* ---------------------------------------------------------------------
   DAFTAR FILE AUDIO — 5 variasi per instrumen.
   Letakkan file di folder audio/. Ganti ekstensi ke .flac (atau .mp3/.ogg)
   sesuai file milikmu; browser modern bisa men-decode keduanya.
   Jika file tidak ditemukan, suara sintesis (SOUND_BANK) dipakai sebagai cadangan.
   --------------------------------------------------------------------- */
const AUDIO_FILES = {
  kick:  ['audio/kick-1.wav', 'audio/kick-2.wav', 'audio/kick-3.wav', 'audio/kick-4.wav', 'audio/kick-5.wav'],
  snare: ['audio/snare-1.wav', 'audio/snare-2.wav', 'audio/snare-3.wav', 'audio/snare-4.wav', 'audio/snare-5.wav'],
  hhc:   ['audio/hihat-closed-1.wav', 'audio/hihat-closed-2.wav', 'audio/hihat-closed-3.wav', 'audio/hihat-closed-4.wav', 'audio/hihat-closed-5.wav'],
  hho:   ['audio/hihat-open-1.wav', 'audio/hihat-open-2.wav', 'audio/hihat-open-3.wav', 'audio/hihat-open-4.wav', 'audio/hihat-open-5.wav'],
  tom1:  ['audio/tom-high-1.wav', 'audio/tom-high-2.wav', 'audio/tom-high-3.wav', 'audio/tom-high-4.wav', 'audio/tom-high-5.wav'],
  tom2:  ['audio/tom-mid-1.wav', 'audio/tom-mid-2.wav', 'audio/tom-mid-3.wav', 'audio/tom-mid-4.wav', 'audio/tom-mid-5.wav'],
  floor: ['audio/tom-floor-1.wav', 'audio/tom-floor-2.wav', 'audio/tom-floor-3.wav', 'audio/tom-floor-4.wav', 'audio/tom-floor-5.wav'],
  crash: ['audio/crash-1.wav', 'audio/crash-2.wav', 'audio/crash-3.wav', 'audio/crash-4.wav', 'audio/crash-5.wav'],
  ride:  ['audio/ride-1.wav', 'audio/ride-2.wav', 'audio/ride-3.wav', 'audio/ride-4.wav', 'audio/ride-5.wav'],
};

/* ---------------------------------------------------------------------
   BANK SUARA SINTESIS — 5 variasi per instrumen (kind = jenis synth,
   p = parameter). Fungsi synth-nya ada di objek SYNTH (bagian 3).
   --------------------------------------------------------------------- */
const TOMS = freq => [
  { name: 'Rock',    kind: 'tom', p: { freq, mult: 1,    decay: 0.45, bend: 1.5 } },
  { name: 'Deep',    kind: 'tom', p: { freq, mult: 0.8,  decay: 0.7,  bend: 1.6 } },
  { name: 'Tight',   kind: 'tom', p: { freq, mult: 1.15, decay: 0.25, bend: 1.4 } },
  { name: 'Jazz',    kind: 'tom', p: { freq, mult: 1.3,  decay: 0.5,  bend: 1.3, wave: 'triangle' } },
  { name: 'Electro', kind: 'tom', p: { freq, mult: 1,    decay: 0.4,  bend: 2.6 } },
];
const HAT_BASES = [
  ['Tight', 800, 7000], ['Studio', 900, 6500], ['Bright', 1100, 8000], ['Dark', 600, 5000], ['Electro', 800, 7500],
];
const SOUND_BANK = {
  kick: [
    { name: '808 Deep',     kind: 'kick', p: { f0: 160, f1: 42, sweep: 0.12, decay: 0.9,  click: 0.15, clickHz: 2500 } },
    { name: 'Punchy Rock',  kind: 'kick', p: { f0: 200, f1: 55, sweep: 0.05, decay: 0.32, click: 0.5,  clickHz: 3500 } },
    { name: 'Tight Studio', kind: 'kick', p: { f0: 180, f1: 65, sweep: 0.04, decay: 0.2,  click: 0.4,  clickHz: 3000 } },
    { name: 'Sub Boom',     kind: 'kick', p: { f0: 120, f1: 32, sweep: 0.2,  decay: 1.3,  click: 0.05, clickHz: 2000 } },
    { name: 'Vintage Jazz', kind: 'kick', p: { f0: 130, f1: 60, sweep: 0.06, decay: 0.45, click: 0.2,  clickHz: 2500, wave: 'triangle' } },
  ],
  snare: [
    { name: 'Crisp',        kind: 'snare', p: { tone: 190, toneDecay: 0.08, noise: 0.8, noiseHz: 1800, noiseDecay: 0.18 } },
    { name: 'Fat Backbeat', kind: 'snare', p: { tone: 160, toneDecay: 0.14, noise: 0.7, noiseHz: 1200, noiseDecay: 0.28 } },
    { name: 'Rimshot',      kind: 'snare', p: { tone: 320, toneDecay: 0.05, noise: 0.6, noiseHz: 2500, noiseDecay: 0.1 } },
    { name: 'Piccolo',      kind: 'snare', p: { tone: 260, toneDecay: 0.06, noise: 0.9, noiseHz: 3000, noiseDecay: 0.14 } },
    { name: 'Electro',      kind: 'snare', p: { tone: 220, toneDecay: 0.1,  noise: 0.5, noiseHz: 2000, noiseDecay: 0.22, wave: 'square' } },
  ],
  hhc: HAT_BASES.map(([name, base, hp], i) => ({ name, kind: 'hat', p: { base, hp, decay: [0.05, 0.08, 0.06, 0.09, 0.04][i] } })),
  hho: HAT_BASES.map(([name, base, hp], i) => ({ name, kind: 'hat', p: { base, hp, decay: [0.4, 0.55, 0.7, 0.5, 0.9][i] } })),
  tom1:  TOMS(190),
  tom2:  TOMS(145),
  floor: TOMS(100),
  crash: [
    { name: 'Bright',    kind: 'cymbal', p: { hp: 5000, decay: 1.6, noise: 0.5,  metal: 0.5, base: 300 } },
    { name: 'Dark',      kind: 'cymbal', p: { hp: 3000, decay: 2.2, noise: 0.5,  metal: 0.4, base: 240 } },
    { name: 'Splash',    kind: 'cymbal', p: { hp: 6000, decay: 0.8, noise: 0.5,  metal: 0.5, base: 380 } },
    { name: 'China',     kind: 'cymbal', p: { hp: 2500, decay: 1.2, noise: 0.55, metal: 0.6, base: 200 } },
    { name: 'Long Wash', kind: 'cymbal', p: { hp: 4000, decay: 3.0, noise: 0.45, metal: 0.4, base: 280 } },
  ],
  ride: [
    { name: 'Jazz Ping', kind: 'cymbal', p: { hp: 7000, decay: 1.2, noise: 0.2,  metal: 0.35, base: 420, bellHz: 2800, bellDecay: 0.5,  bellLevel: 0.3 } },
    { name: 'Dry',       kind: 'cymbal', p: { hp: 7500, decay: 0.6, noise: 0.2,  metal: 0.3,  base: 450, bellHz: 3200, bellDecay: 0.3,  bellLevel: 0.25 } },
    { name: 'Bell',      kind: 'cymbal', p: { hp: 6000, decay: 1.0, noise: 0.1,  metal: 0.25, base: 400, bellHz: 2400, bellDecay: 0.9,  bellLevel: 0.5 } },
    { name: 'Washy',     kind: 'cymbal', p: { hp: 5000, decay: 2.0, noise: 0.35, metal: 0.4,  base: 350, bellHz: 2600, bellDecay: 0.4,  bellLevel: 0.2 } },
    { name: 'Dark Ride', kind: 'cymbal', p: { hp: 4500, decay: 1.4, noise: 0.3,  metal: 0.35, base: 300, bellHz: 1900, bellDecay: 0.6,  bellLevel: 0.3 } },
  ],
};

/* =====================================================================
   2. STATE & PENYIMPANAN
   ===================================================================== */
const STORE_KEY = 'airdrum.v1';

const defaultState = () => ({
  layout: Object.fromEntries(PIECES.map(p => [p.id, { x: p.x, y: p.y, s: p.s }])),
  sound:  Object.fromEntries(PIECES.map(p => [p.id, 0])),
  vol:    Object.fromEntries(PIECES.map(p => [p.id, 0.8])),
  pan:    Object.fromEntries(PIECES.map(p => [p.id, PAN_DEFAULT[p.id] ?? 0])),
  notes:  Object.fromEntries(PIECES.map(p => [p.id, p.note])),
  keys:   Object.fromEntries(PIECES.map(p => [p.id, p.key])),
  master: 0.85, reverbOn: false, reverbMix: 0.3, metroVol: 0.6, beats: 4, bpm: 100,
  sens: 7, videoOpacity: 0.35, zoneScale: 1, showHands: true, preferSamples: true,
});

function loadState() {
  const d = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      for (const k in d) {
        if (saved[k] === undefined) continue;
        d[k] = (d[k] && typeof d[k] === 'object') ? { ...d[k], ...saved[k] } : saved[k];
      }
    }
  } catch (e) { /* storage tidak tersedia: pakai default */ }
  return d;
}
const state = loadState();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* abaikan */ }
  }, 200);
}

/* =====================================================================
   3. AUDIO ENGINE (Web Audio API)

   Rantai sinyal:
     voice(gain velocity) → channel.input(volume) → channel.pan
        → drumBus ─┬─ dry ─────────────┐
                   └─ convolver → wet ─┴→ compressor → master ─┬→ speaker
                                                               └→ recDest (rekaman)
     Metronom: metroGain → speaker (sengaja tidak masuk rekaman)
   ===================================================================== */
let ctx, master, comp, dry, wet, convolver, drumBus, recDest, metroGain, noiseBuf;
const channels = {};
const activeVoices = new Set();

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

    // Buffer noise putih 2 detik, dipakai ulang oleh semua synth
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    drumBus = ctx.createGain();
    dry = ctx.createGain();
    wet = ctx.createGain();
    convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.2, 3);

    comp = ctx.createDynamicsCompressor();       // pengaman agar tidak clipping
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    master = ctx.createGain();
    drumBus.connect(dry).connect(comp);
    drumBus.connect(convolver).connect(wet).connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    recDest = ctx.createMediaStreamDestination();  // sumber stream untuk MediaRecorder
    master.connect(recDest);

    metroGain = ctx.createGain();
    metroGain.connect(ctx.destination);

    // Satu channel strip per instrumen: volume → pan → bus
    PIECES.forEach(p => {
      const input = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) input.connect(pan).connect(drumBus); else input.connect(drumBus);
      channels[p.id] = { input, pan };
      applyChannel(p.id);
    });
    applyMaster();

    // Muat sampel untuk variasi yang sedang dipilih
    PIECES.forEach(p => loadSample(p.id, state.sound[p.id]));
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function applyChannel(id) {
  const ch = channels[id]; if (!ch) return;
  ch.input.gain.value = state.vol[id];
  if (ch.pan) ch.pan.pan.value = state.pan[id];
}
function applyMaster() {
  if (!ctx) return;
  master.gain.value = state.master;
  dry.gain.value = 1;
  wet.gain.value = state.reverbOn ? state.reverbMix : 0;
  metroGain.gain.value = state.metroVol;
}

/* Impuls reverb buatan: noise stereo yang meluruh secara eksponensial */
function makeImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/* ---------- Sampel audio (file) ---------- */
const sampleCache = new Map(); // url -> { state: 'loading'|'ok'|'fail', buffer, promise }

function loadSample(id, idx) {
  const url = AUDIO_FILES[id] && AUDIO_FILES[id][idx];
  if (!url) return Promise.resolve();
  if (sampleCache.has(url)) return sampleCache.get(url).promise;
  const entry = { state: 'loading', buffer: null };
  entry.promise = fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { entry.buffer = buf; entry.state = 'ok'; })
    .catch(() => { entry.state = 'fail'; })   // file tidak ada → pakai sintesis
    .finally(() => updateSourceTag(id));
  sampleCache.set(url, entry);
  return entry.promise;
}
function getSample(id, idx) {
  const url = AUDIO_FILES[id] && AUDIO_FILES[id][idx];
  const e = url && sampleCache.get(url);
  if (e) return e.state === 'ok' ? e.buffer : null;
  if (url) loadSample(id, idx);
  return null;
}

/* ---------- Helper sintesis ---------- */
function noiseBurst(out, t, dur, type, freq, level, q = 0.8) {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf; n.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(f).connect(g).connect(out);
  n.start(t, Math.random()); n.stop(t + dur + 0.02);
}
function tone(out, t, { type = 'sine', f0, f1, sweep = 0.01, decay, level = 1 }) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + sweep);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + decay + 0.05);
}

/* ---------- Fungsi synth (kembalikan durasi suara dalam detik) ---------- */
const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];       // rasio metalik ala drum machine klasik
const CYM_RATIOS = [1, 1.4471, 1.617, 1.9265, 2.5028, 2.6637];

const SYNTH = {
  // Kick: sinus dengan pitch sweep turun + klik noise singkat di awal
  kick(out, t, p) {
    tone(out, t, { type: p.wave || 'sine', f0: p.f0, f1: p.f1, sweep: p.sweep, decay: p.decay });
    if (p.click) noiseBurst(out, t, 0.025, 'highpass', p.clickHz, p.click);
    return p.decay + 0.1;
  },
  // Snare: badan nada (osilator) + desis noise
  snare(out, t, p) {
    tone(out, t, { type: p.wave || 'triangle', f0: p.tone * 1.4, f1: p.tone, sweep: 0.03, decay: p.toneDecay, level: 0.7 });
    noiseBurst(out, t, p.noiseDecay, 'highpass', p.noiseHz, p.noise);
    return Math.max(p.toneDecay, p.noiseDecay) + 0.1;
  },
  // Hi-hat: enam osilator kotak metalik → bandpass → highpass → envelope
  hat(out, t, p) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
    bp.connect(hp).connect(g).connect(out);
    HAT_RATIOS.forEach(r => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = p.base * r;
      const og = ctx.createGain(); og.gain.value = 0.12;
      o.connect(og).connect(bp); o.start(t); o.stop(t + p.decay + 0.05);
    });
    return p.decay + 0.1;
  },
  // Tom: sinus dengan sweep pitch + sedikit "thump" noise
  tom(out, t, p) {
    const f = p.freq * p.mult;
    tone(out, t, { type: p.wave || 'sine', f0: f * p.bend, f1: f, sweep: 0.06, decay: p.decay });
    noiseBurst(out, t, 0.04, 'bandpass', 1800, 0.25);
    return p.decay + 0.1;
  },
  // Cymbal (crash/ride): noise highpass + partial logam + "bell" opsional
  cymbal(out, t, p) {
    noiseBurst(out, t, p.decay, 'highpass', p.hp, p.noise, 0.5);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.metal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + p.decay * 0.8);
    hp.connect(g).connect(out);
    CYM_RATIOS.forEach(r => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = p.base * r;
      const og = ctx.createGain(); og.gain.value = 0.1;
      o.connect(og).connect(hp); o.start(t); o.stop(t + p.decay + 0.05);
    });
    if (p.bellHz) tone(out, t, { f0: p.bellHz, f1: p.bellHz, decay: p.bellDecay, level: p.bellLevel });
    return p.decay + 0.2;
  },
};

/* ---------- Memainkan satu pukulan ---------- */
function playPiece(id, vel = 0.8) {
  ensureAudio();
  const t = ctx.currentTime;

  // Choke: hi-hat baru memotong hi-hat lama
  const group = CHOKE_GROUP[id];
  if (group) {
    for (const v of activeVoices) {
      if (v.group === group) {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.012);
      }
    }
  }

  // Gain per-suara = kekuatan pukulan (velocity 0–1)
  const gain = ctx.createGain();
  gain.gain.value = 0.2 + 0.8 * vel;
  gain.connect(channels[id].input);
  const voice = { gain, group };
  activeVoices.add(voice);
  const cleanup = () => { activeVoices.delete(voice); try { gain.disconnect(); } catch (e) { /* sudah lepas */ } };

  const idx = state.sound[id];
  const buffer = state.preferSamples ? getSample(id, idx) : null;

  if (buffer) {                                   // file audio tersedia
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    src.start(t);
    src.onended = cleanup;
  } else {                                        // cadangan: suara sintesis
    const spec = SOUND_BANK[id][idx];
    const dur = SYNTH[spec.kind](gain, t, spec.p);
    setTimeout(cleanup, (dur + 0.2) * 1000);
  }
}

/* =====================================================================
   4. TRIGGER & UMPAN BALIK VISUAL
   Semua sumber input (gestur, MIDI, keyboard, ketukan mouse/touch)
   lewat fungsi trigger() ini.
   ===================================================================== */
const pieceEls = {};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let warnedSuspended = false;

function trigger(id, vel = 0.8) {
  vel = clamp(vel, 0.1, 1);
  playPiece(id, vel);
  flashPiece(id, vel);
  if (ctx && ctx.state === 'suspended' && !warnedSuspended) {
    warnedSuspended = true;
    toast('Audio belum aktif. Klik di halaman sekali agar suara keluar.', true);
  }
}

/* Animasi: cymbal bergoyang, drum "menekan", ditambah glow dan cincin gelombang */
function flashPiece(id, vel) {
  const el = pieceEls[id]; if (!el) return;
  const disc = $('.disc', el), glow = $('.glow', el);
  const isCymbal = el.dataset.type === 'cymbal';
  const dir = Math.random() < 0.5 ? -1 : 1;

  glow.animate([{ opacity: 0.3 + 0.7 * vel }, { opacity: 0 }], { duration: isCymbal ? 600 : 320, easing: 'ease-out' });
  if (reduceMotion) return;

  disc.animate(
    isCymbal
      ? [
          { transform: 'rotate(0) scale(1)', filter: 'brightness(1.6)' },
          { transform: `rotate(${dir * 5 * vel}deg) scale(${1 - 0.03 * vel})`, filter: 'brightness(1.25)', offset: 0.2 },
          { transform: `rotate(${-dir * 3 * vel}deg)`, offset: 0.45 },
          { transform: `rotate(${dir * 1.2 * vel}deg)`, offset: 0.7 },
          { transform: 'rotate(0) scale(1)', filter: 'brightness(1)' },
        ]
      : [
          { transform: 'scale(1)', filter: 'brightness(1.7)' },
          { transform: `scale(${1 - 0.08 * vel})`, filter: 'brightness(1.25)', offset: 0.25 },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
    { duration: isCymbal ? 520 : 240, easing: 'ease-out' }
  );

  const ring = document.createElement('span');
  ring.className = 'ring';
  el.appendChild(ring);
  ring.animate([{ transform: 'scale(1)', opacity: 0.8 }, { transform: `scale(${1.35 + 0.25 * vel})`, opacity: 0 }],
    { duration: 420, easing: 'ease-out' }).onfinish = () => ring.remove();
}

/* =====================================================================
   5. ZONA DRUM (DOM) + MEMINDAHKAN POSISI
   ===================================================================== */
const stage = $('#stage');
const piecesLayer = $('#pieces');
let editMode = false;
let zoneRects = [];   // hitbox elips tiap zona dalam piksel relatif panggung

function buildPieces() {
  PIECES.forEach(p => {
    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.id = p.id;
    el.dataset.type = p.type;
    el.style.setProperty('--hue', p.hue);
    el.innerHTML = `<span class="glow"></span><span class="disc"></span><span class="label">${p.name}</span><kbd class="keycap"></kbd>`;
    piecesLayer.appendChild(el);
    pieceEls[p.id] = el;
    applyLayout(p.id);

    // Ketuk/klik zona = memainkannya (berguna untuk tes & layar sentuh).
    // Di mode edit, pointer dipakai untuk menyeret.
    el.addEventListener('pointerdown', e => {
      ensureAudio();
      if (editMode) startDrag(e, p.id);
      else { e.preventDefault(); trigger(p.id, 0.8); }
    });
    // Scroll di atas zona (mode edit) = ubah ukuran
    el.addEventListener('wheel', e => {
      if (!editMode) return;
      e.preventDefault();
      const l = state.layout[p.id];
      l.s = clamp(l.s + (e.deltaY < 0 ? 0.8 : -0.8), 6, 34);
      applyLayout(p.id); updateZoneRects(); save();
    }, { passive: false });
  });
  refreshKeycaps();
  updateZoneRects();
}

function applyLayout(id) {
  const l = state.layout[id], el = pieceEls[id];
  el.style.setProperty('--x', l.x);
  el.style.setProperty('--y', l.y);
  el.style.setProperty('--s', l.s);
}

/* Seret zona: posisi disimpan dalam persen sehingga tetap benar saat layar diubah ukurannya */
function startDrag(e, id) {
  const el = pieceEls[id];
  const r0 = stage.getBoundingClientRect();
  const l = state.layout[id];
  const grabX = (e.clientX - r0.left) / r0.width * 100 - l.x;   // selisih titik pegang terhadap pusat zona
  const grabY = (e.clientY - r0.top) / r0.height * 100 - l.y;
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');

  const move = ev => {
    const r = stage.getBoundingClientRect();
    l.x = clamp((ev.clientX - r.left) / r.width * 100 - grabX, 2, 98);
    l.y = clamp((ev.clientY - r.top) / r.height * 100 - grabY, 2, 98);
    applyLayout(id);
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    updateZoneRects(); save();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function setEditMode(on) {
  editMode = on;
  stage.classList.toggle('editing', on);
  $('#btnEdit').setAttribute('aria-pressed', String(on));
  $('#editHint').hidden = !on;
}

function resetLayout() {
  PIECES.forEach(p => { state.layout[p.id] = { x: p.x, y: p.y, s: p.s }; applyLayout(p.id); });
  updateZoneRects(); save();
}

/* Hitung ulang hitbox (dipanggil saat layout / ukuran layar berubah) */
function updateZoneRects() {
  const sr = stage.getBoundingClientRect();
  zoneRects = PIECES.map(p => {
    const r = pieceEls[p.id].getBoundingClientRect();
    return { id: p.id, cx: r.left - sr.left + r.width / 2, cy: r.top - sr.top + r.height / 2, rx: r.width / 2, ry: r.height / 2 };
  });
}

/* Titik (x,y) berada di zona mana? Jika beberapa zona bertumpuk, pilih yang pusatnya terdekat. */
const HIT_TOLERANCE = 1.15;   // hitbox sedikit lebih luas dari gambar agar lebih mudah dikenai
function hitTest(x, y) {
  let best = null, bestD = HIT_TOLERANCE;
  for (const z of zoneRects) {
    const dx = (x - z.cx) / z.rx, dy = (y - z.cy) / z.ry;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = z; }
  }
  return best;
}

/* =====================================================================
   6. DETEKSI GESTUR (MediaPipe Hands)

   Alur:
     getUserMedia → <video> → hands.send(frame) → onHandResults(landmarks)
     Untuk setiap tangan diambil landmark #8 (ujung jari telunjuk) sebagai "stik".
     Posisi dikonversi ke koordinat panggung, dihaluskan, lalu dihitung
     kecepatan vertikalnya. Pukulan terjadi jika ujung telunjuk berada
     DI DALAM zona dan bergerak TURUN lebih cepat dari ambang (threshold),
     atau MEMASUKI zona dari luar dengan kecepatan tinggi.
     Setelah memukul, tangan "terkunci" pada zona itu sampai keluar zona atau
     bergerak naik, sehingga satu ayunan hanya menghasilkan satu bunyi.
   ===================================================================== */
const video = $('#video');
const overlay = $('#overlay');
const g2d = overlay.getContext('2d');

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
];
const FINGERTIP = 8;            // landmark ujung telunjuk
const SMOOTH = 0.7;             // 0..1, makin besar makin responsif (makin kecil makin halus)
const PIECE_COOLDOWN = 70;      // ms jeda minimum per instrumen agar tidak bunyi ganda

let hands = null, camStream = null, camOn = false, lastVideoTime = -1;
let stageW = 0, stageH = 0;
const handStates = new Map();   // key ('Left'/'Right') -> status pelacakan tangan
const lastHitAt = {};

/* Ambang kecepatan (tinggi layar per detik). sens 1..10 → 2.2 .. 0.4 */
const hitThreshold = () => 2.4 - state.sens * 0.2;

function resizeStage() {
  const r = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  stageW = r.width; stageH = r.height;
  overlay.width = r.width * dpr;
  overlay.height = r.height * dpr;
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateZoneRects();
}

/* Konversi koordinat ternormalisasi MediaPipe (0..1 pada frame video) ke piksel panggung.
   Memperhitungkan object-fit: cover (bagian video yang terpotong) dan mirror horizontal. */
function videoToStage(lx, ly) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const scale = Math.max(stageW / vw, stageH / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (stageW - dw) / 2, oy = (stageH - dh) / 2;
  return { x: ox + (1 - lx) * dw, y: oy + ly * dh };   // (1 - lx) = mirror
}

async function initHands() {
  if (hands) return;
  if (typeof Hands === 'undefined') throw new Error('MediaPipe gagal dimuat. Periksa koneksi internet.');
  hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,            // 0 = lebih ringan/cepat, 1 = lebih akurat
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  hands.onResults(onHandResults);
  await hands.initialize();
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCamStatus('error', 'Kamera tidak tersedia');
    toast('Kamera butuh localhost atau HTTPS. Jalankan lewat Live Server.', true);
    return;
  }
  ensureAudio();
  setCamStatus('loading', 'Memuat kamera dan model…');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: false,
    });
    video.srcObject = camStream;
    await video.play();
    await initHands();
  } catch (err) {
    console.error(err);
    stopCamera(true);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setCamStatus('error', denied ? 'Izin kamera ditolak' : 'Kamera gagal');
    toast(denied ? 'Izin kamera ditolak. Kamu tetap bisa main lewat keyboard, MIDI, atau ketukan.' : `Gagal memulai kamera: ${err.message || err}`, true);
    return;
  }
  camOn = true;
  stage.classList.add('cam-on');
  $('#btnCamera').textContent = 'Matikan kamera';
  $('#intro').hidden = true;
  setCamStatus('on', 'Kamera aktif');
  detectLoop();
}

function stopCamera(silent) {
  camOn = false;
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
  video.srcObject = null;
  stage.classList.remove('cam-on');
  $('#btnCamera').textContent = 'Nyalakan kamera';
  handStates.clear();
  g2d.clearRect(0, 0, stageW, stageH);
  PIECES.forEach(p => pieceEls[p.id].classList.remove('hover'));
  if (!silent) setCamStatus('off', 'Kamera mati');
}

/* Kirim frame video ke MediaPipe hanya jika ada frame baru */
async function detectLoop() {
  if (!camOn) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try { await hands.send({ image: video }); } catch (e) { console.error(e); }
  }
  requestAnimationFrame(detectLoop);
}

let lastHandCount = -1;
function onHandResults(results) {
  const now = performance.now();
  const list = results.multiHandLandmarks || [];
  const seen = new Set();
  const hoverIds = new Set();
  const thr = hitThreshold();

  list.forEach((lm, i) => {
    // Kunci tangan berdasarkan label 'Left'/'Right' agar pelacakan stabil antar frame
    let key = (results.multiHandedness && results.multiHandedness[i] && results.multiHandedness[i].label) || ('H' + i);
    if (seen.has(key)) key += i;
    seen.add(key);

    const pts = lm.map(l => videoToStage(l.x, l.y));
    const tip = pts[FINGERTIP];

    let h = handStates.get(key);
    if (!h) {
      h = { x: tip.x, y: tip.y, t: now, vy: 0, locked: false, lockId: null, zoneId: null, trail: [], flashUntil: 0 };
      handStates.set(key, h);
    }

    // Haluskan posisi (EMA) lalu hitung kecepatan dalam "tinggi layar per detik"
    const dt = Math.max((now - h.t) / 1000, 0.008);
    const nx = h.x + (tip.x - h.x) * SMOOTH;
    const ny = h.y + (tip.y - h.y) * SMOOTH;
    const vxN = (nx - h.x) / dt / stageH;
    const vyN = (ny - h.y) / dt / stageH;                  // positif = bergerak turun
    const speedN = Math.hypot(vxN, vyN);
    h.vy = 0.35 * h.vy + 0.65 * vyN;                       // sedikit smoothing kecepatan
    h.x = nx; h.y = ny; h.t = now; h.pts = pts;
    h.trail.push({ x: nx, y: ny }); if (h.trail.length > 8) h.trail.shift();

    const zone = hitTest(nx, ny);
    if (zone) hoverIds.add(zone.id);

    // Buka kunci jika jari keluar zona, pindah zona, atau bergerak naik
    if (h.locked && (!zone || zone.id !== h.lockId || h.vy < -thr * 0.4)) h.locked = false;

    if (zone && !h.locked) {
      const entering = zone.id !== h.zoneId;               // baru masuk zona dari luar
      const downStrike = h.vy > thr;                       // ayunan ke bawah di dalam zona
      const swipeIn = entering && speedN > thr * 1.5;      // sapuan cepat memasuki zona
      const cooled = now - (lastHitAt[zone.id] || 0) > PIECE_COOLDOWN;
      if ((downStrike || swipeIn) && cooled) {
        // Kekuatan pukulan dari kecepatan: threshold → 0.35, ~3.5×threshold → 1.0
        const speed = Math.max(h.vy, speedN);
        const vel = clamp(0.35 + (speed - thr) / (thr * 2.5) * 0.65, 0.35, 1);
        trigger(zone.id, vel);
        lastHitAt[zone.id] = now;
        h.locked = true; h.lockId = zone.id;
        h.flashUntil = now + 140;
      }
    }
    h.zoneId = zone ? zone.id : null;
  });

  // Hapus tangan yang hilang dari frame
  for (const k of [...handStates.keys()]) if (!seen.has(k)) handStates.delete(k);

  // Sorot zona yang sedang dihover jari
  PIECES.forEach(p => pieceEls[p.id].classList.toggle('hover', hoverIds.has(p.id)));

  if (list.length !== lastHandCount) {
    lastHandCount = list.length;
    setCamStatus('on', list.length ? `${list.length} tangan terdeteksi` : 'Kamera aktif · tunjukkan tanganmu');
  }
  drawOverlay();
}

function drawOverlay() {
  g2d.clearRect(0, 0, stageW, stageH);
  if (!state.showHands) return;
  const now = performance.now();
  handStates.forEach(h => {
    if (!h.pts) return;
    // Kerangka tangan
    g2d.lineWidth = 2;
    g2d.strokeStyle = 'rgba(255,255,255,.35)';
    g2d.beginPath();
    HAND_CONNECTIONS.forEach(([a, b]) => { g2d.moveTo(h.pts[a].x, h.pts[a].y); g2d.lineTo(h.pts[b].x, h.pts[b].y); });
    g2d.stroke();
    g2d.fillStyle = 'rgba(255,255,255,.7)';
    h.pts.forEach(p => { g2d.beginPath(); g2d.arc(p.x, p.y, 2.5, 0, 6.283); g2d.fill(); });
    // Jejak gerakan ujung telunjuk
    h.trail.forEach((pt, i) => {
      const a = (i + 1) / h.trail.length;
      g2d.fillStyle = `rgba(142,240,220,${a * 0.45})`;
      g2d.beginPath(); g2d.arc(pt.x, pt.y, 3 + a * 6, 0, 6.283); g2d.fill();
    });
    // "Ujung stik": berubah warna & membesar saat memukul
    const hit = now < h.flashUntil;
    g2d.beginPath();
    g2d.arc(h.x, h.y, hit ? 22 : 14, 0, 6.283);
    g2d.fillStyle = hit ? 'rgba(226,171,63,.95)' : 'rgba(142,240,220,.85)';
    g2d.fill();
    g2d.lineWidth = 2; g2d.strokeStyle = '#fff'; g2d.stroke();
  });
}

function setCamStatus(stateName, text) {
  const s = $('#camStatus');
  s.dataset.state = stateName;
  s.textContent = text;
}

/* =====================================================================
   7. METRONOM
   Memakai penjadwalan "lookahead": timer JS (25 ms) menjadwalkan klik
   ke jam AudioContext beberapa milidetik ke depan, sehingga tempo akurat
   walau thread utama sibuk (mis. saat MediaPipe berjalan).
   ===================================================================== */
const metro = { running: false, next: 0, beat: 0, timer: null };

function metroClick(time, accent) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.5, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  o.connect(g).connect(metroGain);
  o.start(time); o.stop(time + 0.06);
}

function scheduleMetro() {
  while (metro.next < ctx.currentTime + 0.12) {
    const accent = metro.beat === 0;
    metroClick(metro.next, accent);
    const delay = Math.max(0, (metro.next - ctx.currentTime) * 1000);
    setTimeout(() => pulseBeat(accent), delay);          // indikator visual
    metro.beat = (metro.beat + 1) % state.beats;
    metro.next += 60 / state.bpm;
  }
}

function pulseBeat(accent) {
  const dot = $('#beatDot');
  dot.className = 'beat-dot ' + (accent ? 'accent' : 'on');
  setTimeout(() => { dot.className = 'beat-dot'; }, 90);
}

function toggleMetro() {
  ensureAudio();
  const btn = $('#metroToggle');
  if (metro.running) {
    clearInterval(metro.timer);
    metro.running = false;
    btn.textContent = '▶'; btn.classList.remove('on');
    btn.setAttribute('aria-label', 'Mulai metronom');
  } else {
    metro.running = true; metro.beat = 0; metro.next = ctx.currentTime + 0.06;
    metro.timer = setInterval(scheduleMetro, 25);
    scheduleMetro();
    btn.textContent = '■'; btn.classList.add('on');
    btn.setAttribute('aria-label', 'Hentikan metronom');
  }
}

/* =====================================================================
   8. WEB MIDI
   Perangkat (modul drum, Arduino/ESP32 dengan USB-MIDI) mengirim pesan
   3 byte: [status, note, velocity]. Status 0x90 (note-on, semua channel)
   dengan velocity > 0 = pukulan. Velocity 1–127 dipetakan ke 0–1.
   ===================================================================== */
let midiAccess = null;
let learn = null;   // { type: 'midi' | 'key', id } saat mode "learn" aktif

async function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    setMidiStatus('Browser ini tidak mendukung Web MIDI (pakai Chrome atau Edge).');
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = hookMidiInputs;    // perangkat dicolok / dicabut
    hookMidiInputs();
  } catch (e) {
    setMidiStatus('Akses MIDI ditolak.');
  }
}

function hookMidiInputs() {
  const names = [];
  midiAccess.inputs.forEach(input => {
    input.onmidimessage = onMIDIMessage;          // pasang listener di setiap input
    names.push(input.name || 'Perangkat MIDI');
  });
  setMidiStatus(names.length ? `${names.length} input tersambung` : 'MIDI aktif, belum ada perangkat');
  $('#midiInputs').textContent = names.join(', ');
}

function onMIDIMessage(ev) {
  const [status, note, velocity] = ev.data;
  const command = status & 0xf0;                  // buang nomor channel
  if (command !== 0x90 || velocity === 0) return; // hanya note-on (velocity 0 = note-off)

  if (learn && learn.type === 'midi') {           // mode Learn: tetapkan note ke instrumen
    state.notes[learn.id] = note;
    learn = null; save(); renderInputTables();
    return;
  }
  const id = noteToPiece(note);
  if (id) trigger(id, velocity / 127);
}

function noteToPiece(note) {
  for (const p of PIECES) if (state.notes[p.id] === note) return p.id;
  return MIDI_ALIASES[note] || null;
}

function setMidiStatus(text) { $('#midiStatus').textContent = text; }

/* =====================================================================
   9. KEYBOARD (cadangan saat webcam mati)
   ===================================================================== */
function keyToPiece(code) {
  for (const p of PIECES) if (state.keys[p.id] === code) return p.id;
  return null;
}

function keyLabel(code) {
  if (code === 'Space') return 'Spasi';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function refreshKeycaps() {
  PIECES.forEach(p => { $('.keycap', pieceEls[p.id]).textContent = keyLabel(state.keys[p.id]); });
}

function isTypingTarget(t) {
  return t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
    (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type));
}

window.addEventListener('keydown', e => {
  if (learn && learn.type === 'key') {            // mode Learn keyboard
    e.preventDefault();
    if (e.code !== 'Escape') {
      // Lepas tombol ini dari instrumen lain agar tidak bentrok
      PIECES.forEach(p => { if (state.keys[p.id] === e.code) state.keys[p.id] = ''; });
      state.keys[learn.id] = e.code;
    }
    learn = null; save(); refreshKeycaps(); renderInputTables();
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
  const id = keyToPiece(e.code);
  if (id) { e.preventDefault(); ensureAudio(); trigger(id, 0.85); }
});
// Cegah tombol Spasi "mengklik" tombol yang sedang fokus saat dilepas
window.addEventListener('keyup', e => {
  if (!isTypingTarget(e.target) && keyToPiece(e.code)) e.preventDefault();
});

/* =====================================================================
   10. REKAM & EKSPOR (MediaRecorder dari AudioContext destination)
   ===================================================================== */
let recorder = null, recChunks = [], recStart = 0, recTimer = null, takeUrl = null;

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return opts.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

function toggleRecord() {
  if (!window.MediaRecorder) { toast('Browser ini tidak mendukung MediaRecorder.', true); return; }
  ensureAudio();
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }

  const mime = pickMime();
  recChunks = [];
  recorder = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = finishRecording;
  recorder.start();

  recStart = Date.now();
  $('#btnRecord').classList.add('on');
  $('#take').hidden = true;
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('#recLabel').textContent = `Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  $('#recLabel').textContent = 'Stop 0:00';
}

function finishRecording() {
  clearInterval(recTimer);
  $('#btnRecord').classList.remove('on');
  $('#recLabel').textContent = 'Rekam';

  const type = recorder.mimeType || 'audio/webm';
  const blob = new Blob(recChunks, { type });
  if (!blob.size) { toast('Rekaman kosong.', true); return; }
  if (takeUrl) URL.revokeObjectURL(takeUrl);
  takeUrl = URL.createObjectURL(blob);

  const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const box = $('#take');
  box.innerHTML = `
    <audio controls src="${takeUrl}"></audio>
    <a class="btn small primary" href="${takeUrl}" download="airdrum-${stamp}.${ext}">Unduh .${ext}</a>
    <button class="btn small" type="button" id="btnWav">Unduh .wav</button>
    <button class="btn small" type="button" id="btnCloseTake" aria-label="Tutup">Tutup</button>`;
  box.hidden = false;
  $('#btnCloseTake').onclick = () => { box.hidden = true; };
  $('#btnWav').onclick = async () => {
    try {
      const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const wav = new Blob([encodeWav(audioBuf)], { type: 'audio/wav' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(wav);
      a.download = `airdrum-${stamp}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast('Gagal mengonversi ke WAV.', true); }
  };
}

/* Encoder WAV PCM 16-bit sederhana */
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + len * ch * 2);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = clamp(data[c][i], -1, 1);
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

/* =====================================================================
   11. UI: panel, mixer, tab, toast
   ===================================================================== */
function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3500);
}

/* Tab Suara: dropdown terpisah untuk setiap instrumen */
function buildSoundRows() {
  const wrap = $('#soundList');
  PIECES.forEach(p => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <label for="snd-${p.id}">${p.name}<small id="src-${p.id}"></small></label>
      <select id="snd-${p.id}">${SOUND_BANK[p.id].map((s, i) => `<option value="${i}">${i + 1}. ${s.name}</option>`).join('')}</select>
      <button class="mini" type="button" aria-label="Tes suara ${p.name}">Tes</button>`;
    wrap.appendChild(row);

    const sel = $('select', row);
    sel.value = state.sound[p.id];
    sel.addEventListener('change', () => {
      state.sound[p.id] = +sel.value;
      save(); ensureAudio();
      loadSample(p.id, state.sound[p.id]);
      updateSourceTag(p.id);
      trigger(p.id, 0.8);                           // pratinjau langsung
    });
    $('.mini', row).addEventListener('click', () => { ensureAudio(); trigger(p.id, 0.8); });
    updateSourceTag(p.id);
  });
}

/* Penanda apakah variasi terpilih memakai file audio atau sintesis */
function updateSourceTag(id) {
  const tag = $('#src-' + id); if (!tag) return;
  const url = AUDIO_FILES[id][state.sound[id]];
  const e = sampleCache.get(url);
  let text = 'Sintesis', kind = 'synth';
  if (state.preferSamples && e && e.state === 'ok') { text = 'File audio'; kind = 'file'; }
  else if (state.preferSamples && e && e.state === 'loading') text = 'Memuat…';
  tag.textContent = text; tag.dataset.src = kind;
}

/* Tab Mixer: volume + pan per instrumen */
function buildMixer() {
  const wrap = $('#mixerList');
  const panText = v => v === 0 ? 'C' : (v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
  PIECES.forEach(p => {
    const row = document.createElement('div');
    row.className = 'mixrow';
    row.innerHTML = `
      <strong>${p.name}</strong>
      <label>Volume <output>${Math.round(state.vol[p.id] * 100)}%</output>
        <input type="range" min="0" max="1.2" step="0.01" value="${state.vol[p.id]}" aria-label="Volume ${p.name}"></label>
      <label>Pan <output>${panText(state.pan[p.id])}</output>
        <input type="range" min="-1" max="1" step="0.05" value="${state.pan[p.id]}" aria-label="Pan ${p.name}"></label>`;
    wrap.appendChild(row);

    const [volIn, panIn] = row.querySelectorAll('input');
    const [volOut, panOut] = row.querySelectorAll('output');
    volIn.addEventListener('input', () => {
      state.vol[p.id] = +volIn.value; volOut.textContent = Math.round(+volIn.value * 100) + '%';
      applyChannel(p.id); save();
    });
    panIn.addEventListener('input', () => {
      state.pan[p.id] = +panIn.value; panOut.textContent = panText(+panIn.value);
      applyChannel(p.id); save();
    });
    panIn.addEventListener('dblclick', () => { panIn.value = 0; panIn.dispatchEvent(new Event('input')); });
  });
}

/* Tab MIDI & Keyboard: tabel pemetaan + tombol Learn */
function renderInputTables() {
  const midi = $('#midiTable');
  midi.innerHTML = PIECES.map(p => `
    <div class="row3">
      <span>${p.name}</span>
      <input type="number" min="0" max="127" value="${state.notes[p.id]}" data-note="${p.id}" aria-label="Note MIDI ${p.name}">
      <button class="mini ${learn && learn.type === 'midi' && learn.id === p.id ? 'waiting' : ''}" type="button" data-learn-midi="${p.id}">
        ${learn && learn.type === 'midi' && learn.id === p.id ? 'Pukul pad…' : 'Learn'}</button>
    </div>`).join('');

  midi.querySelectorAll('[data-note]').forEach(inp => inp.addEventListener('change', () => {
    state.notes[inp.dataset.note] = clamp(parseInt(inp.value, 10) || 0, 0, 127);
    inp.value = state.notes[inp.dataset.note]; save();
  }));
  midi.querySelectorAll('[data-learn-midi]').forEach(b => b.addEventListener('click', () => {
    learn = { type: 'midi', id: b.dataset.learnMidi };
    if (!midiAccess) initMIDI();
    renderInputTables();
  }));

  const keys = $('#keyTable');
  keys.innerHTML = PIECES.map(p => `
    <div class="row2">
      <span>${p.name}</span>
      <button class="mini ${learn && learn.type === 'key' && learn.id === p.id ? 'waiting' : ''}" type="button" data-learn-key="${p.id}">
        ${learn && learn.type === 'key' && learn.id === p.id ? 'Tekan tombol…' : keyLabel(state.keys[p.id] || '—')}</button>
    </div>`).join('');
  keys.querySelectorAll('[data-learn-key]').forEach(b => b.addEventListener('click', () => {
    learn = { type: 'key', id: b.dataset.learnKey };
    renderInputTables();
    b.blur();
  }));
}

/* Helper pengikat slider/checkbox pengaturan ke state */
function bindRange(id, key, apply, fmt) {
  const el = $('#' + id), out = $('#' + id + 'Out');
  el.value = state[key];
  const show = () => { if (out) out.textContent = fmt ? fmt(+el.value) : el.value; };
  show();
  el.addEventListener('input', () => { state[key] = +el.value; show(); if (apply) apply(); save(); });
  if (apply) apply();
}
function bindCheck(id, key, apply) {
  const el = $('#' + id);
  el.checked = !!state[key];
  el.addEventListener('change', () => { state[key] = el.checked; if (apply) apply(); save(); });
  if (apply) apply();
}

function buildSettings() {
  const pct = v => Math.round(v * 100) + '%';
  bindRange('masterVol', 'master', applyMaster, pct);
  bindCheck('reverbOn', 'reverbOn', applyMaster);
  bindRange('reverbMix', 'reverbMix', applyMaster, pct);
  bindRange('metroVol', 'metroVol', applyMaster, pct);
  bindRange('sens', 'sens', null, v => `${v} / 10`);
  bindRange('videoOpacity', 'videoOpacity', () => stage.style.setProperty('--video-opacity', state.videoOpacity), pct);
  bindRange('zoneScale', 'zoneScale', () => { stage.style.setProperty('--zone-scale', state.zoneScale); updateZoneRects(); }, v => v.toFixed(2) + '×');
  bindCheck('showHands', 'showHands', () => { if (!state.showHands) g2d.clearRect(0, 0, stageW, stageH); });
  bindCheck('preferSamples', 'preferSamples', () => PIECES.forEach(p => updateSourceTag(p.id)));

  const beats = $('#beats');
  beats.value = state.beats;
  beats.addEventListener('change', () => { state.beats = +beats.value; metro.beat = 0; save(); });

  const bpm = $('#bpm');
  bpm.value = state.bpm;
  bpm.addEventListener('input', () => {
    const v = parseInt(bpm.value, 10);
    if (v >= 30 && v <= 300) { state.bpm = v; save(); }   // berlaku di ketukan berikutnya
  });
  bpm.addEventListener('change', () => { state.bpm = clamp(parseInt(bpm.value, 10) || 100, 30, 300); bpm.value = state.bpm; save(); });
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('.tabpanel').forEach(p => { p.hidden = p.id !== 'tab-' + tab.dataset.tab; });
  }));
}

function toggleDrawer(force) {
  const d = $('#drawer');
  const open = force !== undefined ? force : !d.classList.contains('open');
  d.classList.toggle('open', open);
  $('#btnSettings').setAttribute('aria-expanded', String(open));
  setTimeout(resizeStage, 0);
}

/* =====================================================================
   12. INISIALISASI
   ===================================================================== */
function init() {
  buildPieces();
  buildSoundRows();
  buildMixer();
  buildSettings();
  renderInputTables();
  setupTabs();
  resizeStage();

  // Tombol-tombol utama
  $('#btnCamera').addEventListener('click', () => camOn ? stopCamera() : startCamera());
  $('#introCamera').addEventListener('click', startCamera);
  $('#introSkip').addEventListener('click', () => { ensureAudio(); $('#intro').hidden = true; });
  $('#btnEdit').addEventListener('click', () => setEditMode(!editMode));
  $('#btnDoneEdit').addEventListener('click', () => setEditMode(false));
  $('#btnResetLayout').addEventListener('click', resetLayout);
  $('#btnSettings').addEventListener('click', () => toggleDrawer());
  $('#btnRecord').addEventListener('click', toggleRecord);
  $('#metroToggle').addEventListener('click', toggleMetro);
  $('#btnMidi').addEventListener('click', initMIDI);

  // Ubah ukuran layar → hitung ulang kanvas & hitbox
  new ResizeObserver(resizeStage).observe(stage);

  // Aktifkan audio pada interaksi pertama (kebijakan autoplay browser)
  window.addEventListener('pointerdown', () => ensureAudio(), { once: true });

  // Jika izin MIDI sudah pernah diberikan, sambungkan otomatis
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'midi' })
      .then(p => { if (p.state === 'granted') initMIDI(); })
      .catch(() => { /* browser tidak mendukung query izin MIDI */ });
  }
}

init();
