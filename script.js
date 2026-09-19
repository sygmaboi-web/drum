'use strict';

/* ======================================================================
   AIR DRUMS — Virtual drum set berbasis gestur tangan
   ----------------------------------------------------------------------
   Daftar isi
     0. Utilitas
     1. Konfigurasi (instrumen, tata letak, MIDI, keyboard)
     2. Pustaka suara (URL sampel + preset sintesis fallback)
     3. Pengaturan tersimpan (localStorage)
     4. Audio engine (Web Audio API)
     5. Sintesis drum (fallback tanpa file audio)
     6. Metronom
     7. Perekam (MediaRecorder) dan ekspor
     8. Pad drum: tata letak dan umpan balik visual
     9. Input gestur (MediaPipe Hands)
    10. Input MIDI (Web MIDI API)
    11. Input keyboard dan pointer
    12. UI: drawer pengaturan dan kontrol
    13. Bootstrap

   Jalankan lewat server lokal (mis. Live Server VS Code), bukan dengan
   klik ganda file, supaya kamera, MIDI, dan fetch file audio diizinkan.
   ====================================================================== */

/* ----------------------------------------------------------------------
   0. UTILITAS
   ---------------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const pct   = v => `${Math.round(v * 100)}%`;

/** Pembuat elemen DOM ringkas: h('div', { class: 'x', onclick: fn }, anak1, anak2) */
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val === false || val == null) continue;
    if (key === 'class') node.className = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), val);
    else node.setAttribute(key, val === true ? '' : val);
  }
  node.append(...kids.flat());
  return node;
}

let toastTimer;
function toast(message, ms = 3400) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), ms);
}

function setChip(name, state, text) {
  const chip = $(`[data-chip="${name}"]`);
  chip.dataset.state = state;                // off | on | warn | err
  $('b', chip).textContent = text;
}

/* ----------------------------------------------------------------------
   1. KONFIGURASI
   ---------------------------------------------------------------------- */

/**
 * Tata letak drum dari sudut pandang pemain (drummer duduk menghadap kit).
 * Koordinat berada di "ruang kit" virtual 100 x 56.25 satuan (16:9); ruang ini
 * otomatis diskalakan dan ditengahkan di stage, jadi susunan drum tetap sama
 * di ukuran layar berapa pun.
 *   x, y : titik pusat pad   d : diameter   pan : posisi stereo bawaan (-1..1)
 *   keys : KeyboardEvent.code   midi : nomor nada MIDI (General MIDI drum map)
 *   synth: jenis sintesis fallback
 */
const KIT_W = 100;
const KIT_H = 56.25;

const INSTRUMENTS = [
  { id: 'kick',        label: 'Kick',          type: 'kick',   synth: 'kick',   color: '#ff6b7a', x: 52, y: 44, d: 20, pan:  0,    keys: ['Space', 'KeyB'], midi: [36, 35] },
  { id: 'snare',       label: 'Snare',         type: 'drum',   synth: 'snare',  color: '#ffd166', x: 32, y: 38, d: 16, pan: -0.05, keys: ['KeyF', 'KeyJ'], midi: [38, 40, 37] },
  { id: 'hihatClosed', label: 'Hi-Hat Closed', type: 'cymbal', synth: 'hat',    color: '#5eead4', x: 12, y: 38, d: 15, pan: -0.5,  keys: ['KeyD'],          midi: [42, 44] },
  { id: 'hihatOpen',   label: 'Hi-Hat Open',   type: 'cymbal', synth: 'hat',    color: '#86efac', x: 10, y: 22, d: 12, pan: -0.5,  keys: ['KeyS'],          midi: [46] },
  { id: 'tomHigh',     label: 'High Tom',      type: 'drum',   synth: 'tom',    color: '#60a5fa', x: 38, y: 17, d: 15, pan: -0.2,  keys: ['KeyR'],          midi: [50, 48] },
  { id: 'tomMid',      label: 'Mid Tom',       type: 'drum',   synth: 'tom',    color: '#a78bfa', x: 58, y: 17, d: 15, pan:  0.15, keys: ['KeyT'],          midi: [47, 45] },
  { id: 'tomFloor',    label: 'Floor Tom',     type: 'drum',   synth: 'tom',    color: '#f472b6', x: 72, y: 36, d: 17, pan:  0.4,  keys: ['KeyY'],          midi: [43, 41] },
  { id: 'crash',       label: 'Crash',         type: 'cymbal', synth: 'cymbal', color: '#fbbf24', x: 22, y: 11, d: 16, pan: -0.35, keys: ['KeyQ'],          midi: [49, 57] },
  { id: 'ride',        label: 'Ride',          type: 'cymbal', synth: 'cymbal', color: '#22d3ee', x: 82, y: 14, d: 17, pan:  0.5,  keys: ['KeyE'],          midi: [51, 59, 53] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => `${n} (${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1})`;
const keyLabel = code => (code === 'Space' ? 'Spasi' : code.replace('Key', ''));

/** Peta nada MIDI -> id instrumen bawaan (dibangun dari INSTRUMENTS[].midi). */
function defaultMidiMap() {
  const map = {};
  INSTRUMENTS.forEach(inst => inst.midi.forEach(note => { map[note] = inst.id; }));
  return map;
}

/** Peta KeyboardEvent.code -> id instrumen. `code` tidak bergantung pada tata letak keyboard. */
const KEY_MAP = new Map();
INSTRUMENTS.forEach(inst => inst.keys.forEach(code => KEY_MAP.set(code, inst.id)));

/* ----------------------------------------------------------------------
   2. PUSTAKA SUARA
   ---------------------------------------------------------------------- */
const VARIATIONS = 5;

/**
 * URL file audio: 5 variasi per instrumen. Letakkan file-nya di folder audio/.
 * Ekstensi bebas (.wav, .flac, .mp3, .ogg) dan boleh dicampur; cukup ubah string-nya.
 * File yang tidak ditemukan otomatis diganti suara sintesis (bagian 5).
 */
const SAMPLE_URLS = {
  kick: [
    'audio/kick-1.wav', 'audio/kick-2.wav', 'audio/kick-3.wav', 'audio/kick-4.wav', 'audio/kick-5.wav',
  ],
  snare: [
    'audio/snare-1.wav', 'audio/snare-2.wav', 'audio/snare-3.wav', 'audio/snare-4.wav', 'audio/snare-5.wav',
  ],
  hihatClosed: [
    'audio/hihat-closed-1.wav', 'audio/hihat-closed-2.wav', 'audio/hihat-closed-3.wav', 'audio/hihat-closed-4.wav', 'audio/hihat-closed-5.wav',
  ],
  hihatOpen: [
    'audio/hihat-open-1.wav', 'audio/hihat-open-2.wav', 'audio/hihat-open-3.wav', 'audio/hihat-open-4.wav', 'audio/hihat-open-5.wav',
  ],
  tomHigh: [
    'audio/tom-high-1.wav', 'audio/tom-high-2.wav', 'audio/tom-high-3.wav', 'audio/tom-high-4.wav', 'audio/tom-high-5.wav',
  ],
  tomMid: [
    'audio/tom-mid-1.wav', 'audio/tom-mid-2.wav', 'audio/tom-mid-3.wav', 'audio/tom-mid-4.wav', 'audio/tom-mid-5.wav',
  ],
  tomFloor: [
    'audio/tom-floor-1.wav', 'audio/tom-floor-2.wav', 'audio/tom-floor-3.wav', 'audio/tom-floor-4.wav', 'audio/tom-floor-5.wav',
  ],
  crash: [
    'audio/crash-1.wav', 'audio/crash-2.wav', 'audio/crash-3.wav', 'audio/crash-4.wav', 'audio/crash-5.wav',
  ],
  ride: [
    'audio/ride-1.wav', 'audio/ride-2.wav', 'audio/ride-3.wav', 'audio/ride-4.wav', 'audio/ride-5.wav',
  ],
};

/** Tiga tom memakai kerangka preset yang sama, hanya beda nada dasar. */
const tomSet = base => [
  { name: 'Rock',    f0: base * 1.55, f1: base,        pitchDecay: 0.08, decay: 0.45, click: 0.30, wave: 'sine' },
  { name: 'Deep',    f0: base * 1.30, f1: base * 0.80, pitchDecay: 0.10, decay: 0.70, click: 0.20, wave: 'sine' },
  { name: 'Punchy',  f0: base * 1.80, f1: base * 1.05, pitchDecay: 0.05, decay: 0.28, click: 0.50, wave: 'triangle' },
  { name: 'Electro', f0: base * 2.10, f1: base * 0.90, pitchDecay: 0.12, decay: 0.50, click: 0.10, wave: 'sine' },
  { name: 'Jazz',    f0: base * 1.20, f1: base * 1.05, pitchDecay: 0.04, decay: 0.35, click: 0.15, wave: 'triangle' },
];

/**
 * Preset sintesis fallback (5 per instrumen). Nama preset juga menjadi label di dropdown.
 * Parameter dibaca oleh fungsi synthXxx di bagian 5.
 */
const SYNTH_PRESETS = {
  kick: [
    { name: 'Acoustic Punch', f0: 160, f1: 52, pitchDecay: 0.06, decay: 0.38, click: 0.55, wave: 'sine' },
    { name: '808 Sub',        f0: 110, f1: 42, pitchDecay: 0.10, decay: 0.95, click: 0.10, wave: 'sine' },
    { name: 'Tight Rock',     f0: 190, f1: 58, pitchDecay: 0.04, decay: 0.26, click: 0.85, wave: 'sine' },
    { name: 'Deep Boom',      f0: 95,  f1: 36, pitchDecay: 0.14, decay: 0.75, click: 0.25, wave: 'sine' },
    { name: 'Electro Thump',  f0: 230, f1: 60, pitchDecay: 0.05, decay: 0.32, click: 0.50, wave: 'triangle' },
  ],
  snare: [
    { name: 'Classic',     tone1: 185, tone2: 330, toneDecay: 0.12, toneGain: 0.6, noiseHP: 1800, noiseDecay: 0.20, noiseGain: 0.8, wave: 'triangle' },
    { name: 'Tight Crack', tone1: 220, tone2: 400, toneDecay: 0.07, toneGain: 0.5, noiseHP: 2500, noiseDecay: 0.13, noiseGain: 0.9, wave: 'triangle' },
    { name: 'Fat Rock',    tone1: 160, tone2: 280, toneDecay: 0.16, toneGain: 0.8, noiseHP: 1200, noiseDecay: 0.28, noiseGain: 0.75, wave: 'sine' },
    { name: 'Rimshot',     tone1: 300, tone2: 520, toneDecay: 0.05, toneGain: 0.7, noiseHP: 3000, noiseDecay: 0.09, noiseGain: 0.7, wave: 'square' },
    { name: 'Electro 808', tone1: 180, tone2: 330, toneDecay: 0.18, toneGain: 0.9, noiseHP: 4000, noiseDecay: 0.22, noiseGain: 0.5, wave: 'sine' },
  ],
  hihatClosed: [
    { name: 'Tight',        hp: 7000, decay: 0.045, metal: 0.5, noise: 0.7 },
    { name: 'Crisp',        hp: 8000, decay: 0.06,  metal: 0.3, noise: 0.9 },
    { name: 'Metallic 808', hp: 6000, decay: 0.07,  metal: 0.9, noise: 0.3 },
    { name: 'Dusty',        hp: 5000, decay: 0.09,  metal: 0.2, noise: 1.0 },
    { name: 'Sizzle',       hp: 9000, decay: 0.05,  metal: 0.6, noise: 0.8 },
  ],
  hihatOpen: [
    { name: 'Classic Open', hp: 6500, decay: 0.45, metal: 0.5, noise: 0.8 },
    { name: 'Washy',        hp: 5500, decay: 0.80, metal: 0.3, noise: 1.0 },
    { name: 'Metallic 808', hp: 6000, decay: 0.55, metal: 0.9, noise: 0.3 },
    { name: 'Short Open',   hp: 7000, decay: 0.28, metal: 0.5, noise: 0.8 },
    { name: 'Sizzle',       hp: 8500, decay: 0.65, metal: 0.6, noise: 0.8 },
  ],
  tomHigh:  tomSet(200),
  tomMid:   tomSet(150),
  tomFloor: tomSet(100),
  crash: [
    { name: 'Bright Crash', hp: 4500, decay: 1.6, metal: 0.6, noise: 0.8, ping: 0 },
    { name: 'Dark Crash',   hp: 3000, decay: 2.0, metal: 0.5, noise: 0.9, ping: 0 },
    { name: 'Trash',        hp: 5500, decay: 0.9, metal: 0.8, noise: 0.7, ping: 0 },
    { name: 'Splash',       hp: 6500, decay: 0.7, metal: 0.6, noise: 0.8, ping: 0 },
    { name: 'Long Wash',    hp: 3500, decay: 2.6, metal: 0.3, noise: 1.0, ping: 0 },
  ],
  ride: [
    { name: 'Classic Ride', hp: 6000, decay: 1.4, metal: 0.7, noise: 0.5, ping: 0.25, pingFreq: 3200 },
    { name: 'Dark Ride',    hp: 4500, decay: 1.6, metal: 0.6, noise: 0.6, ping: 0.20, pingFreq: 2600 },
    { name: 'Bell',         hp: 5500, decay: 1.8, metal: 0.5, noise: 0.2, ping: 0.80, pingFreq: 3600 },
    { name: 'Dry Ride',     hp: 6500, decay: 0.8, metal: 0.8, noise: 0.4, ping: 0.30, pingFreq: 3000 },
    { name: 'Sizzle Ride',  hp: 7000, decay: 1.2, metal: 0.6, noise: 0.9, ping: 0.20, pingFreq: 3400 },
  ],
};

/* ----------------------------------------------------------------------
   3. PENGATURAN TERSIMPAN
   ---------------------------------------------------------------------- */
const STORAGE_KEY = 'airdrums.settings.v1';

const DEFAULTS = {
  master: 0.85, reverbOn: false, reverbMix: 0.3, compOn: true,
  metroVol: 0.6, metroBeats: 4, metroInRec: false, bpm: 100,
  sensitivity: 6, striker: 'index', model: 0, videoOpacity: 0.3, showSkeleton: true,
  recFormat: 'original', midiMap: null,
};

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { /* storage tidak tersedia */ }
  const s = { ...DEFAULTS, ...saved, variation: {}, volume: {}, pan: {} };
  INSTRUMENTS.forEach(({ id, pan }) => {
    s.variation[id] = clamp(Math.round(saved.variation?.[id] ?? 0), 0, VARIATIONS - 1);
    s.volume[id]    = clamp(saved.volume?.[id] ?? 0.8);
    s.pan[id]       = clamp(saved.pan?.[id] ?? pan, -1, 1);
  });
  return s;
}

const settings = loadSettings();

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* abaikan */ }
  }, 250);
}

/* ----------------------------------------------------------------------
   4. AUDIO ENGINE (Web Audio API)
   ----------------------------------------------------------------------
   Graf sinyal:

     [voice] -> channel.input (volume) -> channel.pan -+--------------------> bus
                                                       |                       |
                                                       +-> reverbSend -> convolver -+
                                                                                    v
     bus -> compressor -> masterGain -+-> ctx.destination (speaker)
                                      +-> recordDest      (MediaRecorder)

     metronom -> metroBus -> ctx.destination   (opsional juga ke recordDest)
   ---------------------------------------------------------------------- */
const audio = {
  ctx: null, bus: null, comp: null, masterGain: null,
  recordDest: null, reverbSend: null, convolver: null, metroBus: null,
  noise: null,
  channels: {},   // id -> { input, pan }
  samples: {},    // id -> [AudioBuffer | null, ...] (null = tidak ada file, pakai sintesis)
  voices: {},     // id -> GainNode suara terakhir (untuk choke hi-hat)
};

function ensureAudio() { initAudio(); return audio.ctx; }

function initAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });   // latensi serendah mungkin untuk bermain drum
  audio.ctx = ctx;

  // Rantai master
  audio.bus        = ctx.createGain();
  audio.comp       = ctx.createDynamicsCompressor();
  audio.masterGain = ctx.createGain();
  audio.recordDest = ctx.createMediaStreamDestination();   // stream ini yang direkam MediaRecorder
  audio.bus.connect(audio.comp).connect(audio.masterGain);
  audio.masterGain.connect(ctx.destination);
  audio.masterGain.connect(audio.recordDest);

  // Reverb: ConvolverNode dengan impulse response buatan (noise meluruh)
  audio.convolver  = ctx.createConvolver();
  audio.convolver.buffer = makeImpulse(ctx, 2.2, 2.6);
  audio.reverbSend = ctx.createGain();
  audio.reverbSend.connect(audio.convolver).connect(audio.bus);

  // Metronom punya jalur sendiri agar tidak ikut dikompres/di-reverb
  audio.metroBus = ctx.createGain();
  audio.metroBus.connect(ctx.destination);

  // Buffer noise (dipakai snare, hi-hat, simbal)
  audio.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = audio.noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // Satu channel strip per instrumen: volume -> pan -> bus (+ send reverb)
  INSTRUMENTS.forEach(({ id }) => {
    const input = ctx.createGain();
    const pan = ctx.createStereoPanner();
    input.connect(pan);
    pan.connect(audio.bus);
    pan.connect(audio.reverbSend);
    audio.channels[id] = { input, pan };
    applyChannel(id);
  });

  applyMaster();
  applyFx();
  applyMetroRouting();

  // Muat sampel untuk variasi yang sedang terpilih (variasi lain dimuat saat dipilih)
  INSTRUMENTS.forEach(({ id }) => loadSample(id, settings.variation[id]));

  setChip('audio', 'on', 'aktif');
}

/** Impulse response reverb sederhana: noise stereo yang meluruh secara eksponensial. */
function makeImpulse(ctx, seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

function applyChannel(id) {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  const ch = audio.channels[id];
  ch.input.gain.setTargetAtTime(settings.volume[id], now, 0.015);
  ch.pan.pan.setTargetAtTime(settings.pan[id], now, 0.015);
}

function applyMaster() {
  if (!audio.ctx) return;
  audio.masterGain.gain.setTargetAtTime(settings.master, audio.ctx.currentTime, 0.02);
}

function applyFx() {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  // Reverb: saklar + jumlah = level send. 0 berarti reverb mati total.
  audio.reverbSend.gain.setTargetAtTime(settings.reverbOn ? settings.reverbMix : 0, now, 0.03);
  // Kompresor: "mati" = rasio 1:1 dengan threshold 0 dB (praktis transparan).
  const c = audio.comp;
  if (settings.compOn) {
    c.threshold.value = -20; c.knee.value = 12; c.ratio.value = 4;
    c.attack.value = 0.003;  c.release.value = 0.15;
  } else {
    c.threshold.value = 0; c.knee.value = 0; c.ratio.value = 1;
  }
}

function applyMetroRouting() {
  if (!audio.ctx) return;
  audio.metroBus.gain.setTargetAtTime(settings.metroVol, audio.ctx.currentTime, 0.02);
  try { audio.metroBus.disconnect(audio.recordDest); } catch { /* belum terhubung */ }
  if (settings.metroInRec) audio.metroBus.connect(audio.recordDest);
}

/**
 * Muat satu file sampel. Bila gagal (file belum ada / dibuka lewat file://),
 * slot ditandai null sehingga playInstrument() memakai sintesis.
 */
async function loadSample(id, index) {
  if (!audio.ctx) return;
  audio.samples[id] ??= [];
  if (audio.samples[id][index] !== undefined) return;   // sudah pernah dicoba
  audio.samples[id][index] = null;
  try {
    const res = await fetch(SAMPLE_URLS[id][index]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    audio.samples[id][index] = await audio.ctx.decodeAudioData(await res.arrayBuffer());
  } catch { /* tetap null -> sintesis */ }
  updateSourceTag(id);
  updateSampleChip();
}

function reloadSamples() {
  audio.samples = {};
  INSTRUMENTS.forEach(({ id }) => {
    updateSourceTag(id);
    loadSample(id, settings.variation[id]);
  });
  toast('Memuat ulang sampel dari folder audio/…');
}

function updateSourceTag(id) {
  const tag = $(`[data-tag-for="${id}"]`);
  if (!tag) return;
  const isSample = Boolean(audio.samples[id]?.[settings.variation[id]]);
  tag.textContent = isSample ? 'Sampel' : 'Sintesis';
  tag.dataset.src = isSample ? 'sample' : 'synth';
}

function updateSampleChip() {
  const loaded = Object.values(audio.samples).flat().filter(Boolean).length;
  setChip('samples', loaded ? 'on' : 'off', loaded ? `${loaded} dimuat` : 'memakai sintesis');
}

/** Membunyikan satu pukulan. Dipanggil oleh semua sumber input lewat trigger(). */
function playInstrument(id, velocity) {
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const index = settings.variation[id];
  const level = 0.25 + 0.75 * clamp(velocity);   // kurva velocity: pukulan pelan tetap terdengar

  // Choke: hi-hat tertutup memotong hi-hat terbuka, seperti pedal hi-hat asli.
  if (id === 'hihatClosed' || id === 'hihatOpen') chokeVoice('hihatOpen', t);

  const out = ctx.createGain();      // satu GainNode per pukulan = velocity + bisa di-choke
  out.gain.value = level;
  out.connect(audio.channels[id].input);
  audio.voices[id] = out;

  const buffer = audio.samples[id]?.[index];
  if (buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start(t);
  } else {
    const inst = INSTRUMENTS.find(i => i.id === id);
    SYNTH[inst.synth](ctx, out, t, SYNTH_PRESETS[id][index]);
  }
}

function chokeVoice(id, t) {
  const voice = audio.voices[id];
  if (!voice) return;
  voice.gain.cancelScheduledValues(t);
  voice.gain.setTargetAtTime(0, t, 0.015);
  audio.voices[id] = null;
}

/**
 * Pintu tunggal untuk semua pukulan (gestur, MIDI, keyboard, klik/sentuh).
 * velocity: 0..1
 */
function trigger(id, velocity = 0.8, source = 'ui') {
  if (!audio.ctx) return;              // audio belum diaktifkan lewat tombol Mulai
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  playInstrument(id, velocity);
  flashPad(id, velocity, source);
}

/* ----------------------------------------------------------------------
   5. SINTESIS DRUM (FALLBACK)
   ----------------------------------------------------------------------
   Semua suara dibuat dari OscillatorNode (nada dan logam) ditambah noise
   dari buffer acak (snare, hi-hat, simbal butuh noise agar terdengar nyata).
   Semua fungsi menerima: (ctx, out, t, preset) — out = GainNode tujuan,
   t = waktu mulai (detik AudioContext).
   ---------------------------------------------------------------------- */

/** Nada dengan envelope meluruh dan (opsional) pitch yang turun cepat — inti kick dan tom. */
function toneBurst(ctx, dest, t, { wave = 'sine', f0, f1 = f0, pitchDecay = 0.05, decay = 0.2, gain = 1 }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + pitchDecay);
  env.gain.setValueAtTime(Math.max(gain, 0.0002), t);
  env.gain.exponentialRampToValueAtTime(0.001, t + decay);
  osc.connect(env).connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.03);
}

/** Semburan noise yang difilter — badan snare, desis hi-hat, klik kick. */
function noiseBurst(ctx, dest, t, { type = 'highpass', freq = 1000, q = 0.7, decay = 0.1, gain = 1 }) {
  const src = ctx.createBufferSource();
  src.buffer = audio.noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(gain, 0.0002), t);
  env.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(filter).connect(env).connect(dest);
  src.start(t, Math.random());        // titik awal acak: tiap pukulan sedikit berbeda
  src.stop(t + decay + 0.03);
}

/** Enam osilator kotak dengan rasio frekuensi tak harmonik = karakter logam ala 808. */
const METAL_FREQS = [263, 400, 421, 474, 587, 845];
function metalBurst(ctx, dest, t, { hp = 7000, decay = 0.1, gain = 0.5 }) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(gain * 0.25, 0.0002), t);
  env.gain.exponentialRampToValueAtTime(0.001, t + decay);
  METAL_FREQS.forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + decay + 0.03);
  });
  filter.connect(env).connect(dest);
}

function synthKick(ctx, out, t, p) {
  toneBurst(ctx, out, t, { wave: p.wave, f0: p.f0, f1: p.f1, pitchDecay: p.pitchDecay, decay: p.decay, gain: 1 });
  if (p.click) noiseBurst(ctx, out, t, { type: 'lowpass', freq: 4000, decay: 0.012, gain: p.click });
}

function synthSnare(ctx, out, t, p) {
  toneBurst(ctx, out, t, { wave: p.wave, f0: p.tone1 * 1.15, f1: p.tone1, pitchDecay: 0.03, decay: p.toneDecay, gain: p.toneGain * 0.6 });
  toneBurst(ctx, out, t, { wave: p.wave, f0: p.tone2 * 1.10, f1: p.tone2, pitchDecay: 0.03, decay: p.toneDecay * 0.8, gain: p.toneGain * 0.36 });
  noiseBurst(ctx, out, t, { type: 'highpass', freq: p.noiseHP, decay: p.noiseDecay, gain: p.noiseGain * 0.75 });
}

function synthHat(ctx, out, t, p) {
  metalBurst(ctx, out, t, { hp: p.hp, decay: p.decay, gain: p.metal * 0.6 });
  noiseBurst(ctx, out, t, { type: 'highpass', freq: p.hp, decay: p.decay, gain: p.noise * 0.5 });
}

function synthTom(ctx, out, t, p) {
  toneBurst(ctx, out, t, { wave: p.wave, f0: p.f0, f1: p.f1, pitchDecay: p.pitchDecay, decay: p.decay, gain: 0.9 });
  noiseBurst(ctx, out, t, { type: 'bandpass', freq: p.f1 * 4, q: 1, decay: 0.02, gain: p.click });
}

function synthCymbal(ctx, out, t, p) {
  noiseBurst(ctx, out, t, { type: 'highpass', freq: p.hp, decay: 0.03, gain: 0.5 });                      // transien stik
  noiseBurst(ctx, out, t, { type: 'highpass', freq: p.hp, decay: p.decay, gain: p.noise * 0.45 });        // desis
  metalBurst(ctx, out, t, { hp: p.hp, decay: p.decay, gain: p.metal * 0.6 });                            // logam
  if (p.ping) toneBurst(ctx, out, t, { wave: 'triangle', f0: p.pingFreq, decay: p.decay * 0.45, gain: p.ping * 0.25 }); // "ping" ride
}

const SYNTH = { kick: synthKick, snare: synthSnare, hat: synthHat, tom: synthTom, cymbal: synthCymbal };

/* ----------------------------------------------------------------------
   6. METRONOM
   ----------------------------------------------------------------------
   Memakai pola "lookahead scheduler": setInterval berjalan tiap 25 ms dan
   menjadwalkan klik beberapa milidetik ke depan memakai jam AudioContext,
   sehingga tempo stabil walau main thread sedang sibuk.
   ---------------------------------------------------------------------- */
const metro = { running: false, beat: 0, next: 0, timer: null };

function toggleMetronome(force) {
  ensureAudio();
  const on = force ?? !metro.running;
  if (on === metro.running) return;
  metro.running = on;
  $('#btnMetro').setAttribute('aria-pressed', String(on));
  $('#btnMetro').setAttribute('aria-label', on ? 'Hentikan metronom' : 'Putar metronom');
  if (on) {
    metro.beat = 0;
    metro.next = audio.ctx.currentTime + 0.06;
    metro.timer = setInterval(metroScheduler, 25);
    metroScheduler();
  } else {
    clearInterval(metro.timer);
    $$('#beatDots i').forEach(dot => dot.classList.remove('on', 'accent'));
  }
}

function metroScheduler() {
  const ctx = audio.ctx;
  while (metro.next < ctx.currentTime + 0.12) {
    const beatInBar = metro.beat % settings.metroBeats;
    scheduleClick(metro.next, beatInBar === 0);
    const delay = Math.max(0, (metro.next - ctx.currentTime) * 1000);
    setTimeout(() => flashBeat(beatInBar), delay);   // indikator visual disinkronkan dengan bunyi
    metro.next += 60 / settings.bpm;
    metro.beat++;
  }
}

function scheduleClick(t, accent) {
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = accent ? 1760 : 1175;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(env).connect(audio.metroBus);
  osc.start(t);
  osc.stop(t + 0.06);
}

function buildBeatDots() {
  const box = $('#beatDots');
  box.replaceChildren(...Array.from({ length: settings.metroBeats }, () => h('i')));
}

function flashBeat(index) {
  if (!metro.running) return;
  $$('#beatDots i').forEach((dot, i) => {
    dot.classList.toggle('on', i === index);
    dot.classList.toggle('accent', i === index && index === 0);
  });
}

/* ----------------------------------------------------------------------
   7. PEREKAM (MediaRecorder) DAN EKSPOR
   ---------------------------------------------------------------------- */
const rec = { recorder: null, chunks: [], blob: null, ext: 'webm', startedAt: 0, timer: null };

function pickRecorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function toggleRecording() {
  if (rec.recorder?.state === 'recording') stopRecording();
  else startRecording();
}

function startRecording() {
  ensureAudio();
  if (!window.MediaRecorder) { toast('Browser ini belum mendukung MediaRecorder.'); return; }
  const mime = pickRecorderMime();
  rec.chunks = [];
  // Yang direkam adalah hasil mixdown (bus master), bukan mikrofon.
  rec.recorder = new MediaRecorder(audio.recordDest.stream, mime ? { mimeType: mime } : undefined);
  rec.ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  rec.recorder.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  rec.recorder.onstop = () => {
    rec.blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || mime });
    $('#btnDownload').disabled = false;
    toast('Rekaman siap. Klik Unduh untuk menyimpan.');
  };
  rec.recorder.start();

  rec.startedAt = performance.now();
  rec.timer = setInterval(() => {
    const s = Math.floor((performance.now() - rec.startedAt) / 1000);
    $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  $('#btnRec').setAttribute('aria-pressed', 'true');
  $('#btnRec .btn-text').textContent = 'Berhenti';
}

function stopRecording() {
  rec.recorder?.stop();
  clearInterval(rec.timer);
  $('#btnRec').setAttribute('aria-pressed', 'false');
  $('#btnRec .btn-text').textContent = 'Rekam';
}

async function downloadTake() {
  if (!rec.blob) return;
  let blob = rec.blob;
  let ext = rec.ext;
  if (settings.recFormat === 'wav') {
    try {
      const decoded = await audio.ctx.decodeAudioData(await rec.blob.arrayBuffer());
      blob = audioBufferToWav(decoded);
      ext = 'wav';
    } catch {
      toast('Konversi ke WAV gagal, mengunduh format asli.');
    }
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const link = h('a', { href: URL.createObjectURL(blob), download: `air-drums-${stamp}.${ext}` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Enkode AudioBuffer menjadi file WAV 16-bit PCM. */
function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const dataSize = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };

  writeText(0, 'RIFF');  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);            // ukuran chunk fmt
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data'); view.setUint32(40, dataSize, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = clamp(data[c][i], -1, 1);
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* ----------------------------------------------------------------------
   8. PAD DRUM: TATA LETAK DAN UMPAN BALIK VISUAL
   ---------------------------------------------------------------------- */
const stage   = $('#stage');
const padsBox = $('#pads');
const video   = $('#video');
const overlay = $('#overlay');
const octx    = overlay.getContext('2d');

const zones = {};                 // id -> { inst, el, cx, cy, r, lastHit } (pusat dan radius dalam piksel stage)
const geo = { W: 0, H: 0 };

function buildPads() {
  INSTRUMENTS.forEach(inst => {
    const el = h('div',
      { class: 'pad', role: 'button', 'aria-label': inst.label, dataset: { id: inst.id, type: inst.type } },
      h('span', { class: 'pad-name' }, inst.label),
      h('kbd', { class: 'pad-key' }, keyLabel(inst.keys[0])),
    );
    el.style.setProperty('--c', inst.color);
    // Klik/sentuh juga memainkan drum (berguna untuk uji coba tanpa kamera)
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!audio.ctx) return;
      trigger(inst.id, 0.85, 'pointer');
    });
    padsBox.append(el);
    zones[inst.id] = { inst, el, cx: 0, cy: 0, r: 0, lastHit: 0 };
  });
}

/** Hitung ulang posisi pad (piksel) dan ukuran canvas. Dipanggil saat ukuran stage berubah. */
function layout() {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  geo.W = W; geo.H = H;

  const scale = Math.min(W / KIT_W, H / KIT_H);            // kit 16:9 dimuat ke stage (letterbox)
  const offX = (W - KIT_W * scale) / 2;
  const offY = (H - KIT_H * scale) / 2;

  for (const z of Object.values(zones)) {
    z.cx = offX + z.inst.x * scale;
    z.cy = offY + z.inst.y * scale;
    z.r  = (z.inst.d / 2) * scale;
    Object.assign(z.el.style, {
      left: `${z.cx - z.r}px`, top: `${z.cy - z.r}px`,
      width: `${z.r * 2}px`,   height: `${z.r * 2}px`,
    });
    z.el.style.setProperty('--fs', `${clamp(z.r * 0.24, 11, 26)}px`);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.round(W * dpr);
  overlay.height = Math.round(H * dpr);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Animasi menyala/bergetar pada pad. Sumber pemicu: gesture | midi | keyboard | pointer | preview. */
function flashPad(id, velocity, source) {
  const z = zones[id];
  if (!z) return;
  z.el.style.setProperty('--i', (0.4 + 0.6 * clamp(velocity)).toFixed(2));
  z.el.classList.remove('hit');
  void z.el.offsetWidth;                 // paksa reflow agar animasi bisa diulang bila pukulan beruntun
  z.el.classList.add('hit');

  const ring = h('span', { class: 'ripple' });
  z.el.append(ring);
  ring.addEventListener('animationend', () => ring.remove(), { once: true });

  const sources = { gesture: 'gestur', midi: 'MIDI', keyboard: 'keyboard', pointer: 'sentuh', preview: 'uji suara' };
  $('#lastHit').textContent = `${z.inst.label} (${sources[source] ?? source}), kekuatan ${pct(velocity)}`;
}

/* ----------------------------------------------------------------------
   9. INPUT GESTUR (MediaPipe Hands)
   ----------------------------------------------------------------------
   Alur:
     webcam -> <video> -> hands.send() -> onHandResults() -> landmark 21 titik
       -> strikerPoint(): ambil satu titik pemukul per tangan (ujung telunjuk)
       -> updateTracks(): cocokkan titik dengan "track" frame sebelumnya
       -> stepTrack(): haluskan posisi, hitung kecepatan
       -> detectHits(): entri zona + kecepatan turun = pukulan -> trigger()

   Kecepatan dinyatakan dalam "tinggi stage per detik" sehingga tidak
   bergantung resolusi kamera atau ukuran jendela.
   ---------------------------------------------------------------------- */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const GESTURE = {
  POS_SMOOTH: 0.75,    // 1 = tanpa penghalusan; makin kecil makin halus tetapi makin lambat
  VEL_SMOOTH: 0.55,    // penghalusan kecepatan (EMA)
  MATCH_DIST: 0.45,    // jarak maks. mencocokkan titik ke track (x tinggi stage)
  HIT_PADDING: 1.06,   // hitbox sedikit lebih besar dari lingkaran yang terlihat
  COOLDOWN_MS: 80,     // jeda minimum antar pukulan pada zona yang sama
  STALE_MS: 300,       // track dibuang jika tangan hilang selama ini
};

const cam = { active: false, stream: null, hands: null, busy: false, ready: false, lastSeen: 0 };
const tracks = [];     // titik pemukul yang sedang dilacak (satu per tangan)

/** Ambang kecepatan "cukup cepat untuk memukul". Sensitivitas 1..10 -> 2.0 .. 0.45 tinggi-stage/detik. */
function hitThreshold() {
  return lerp(2.0, 0.45, (settings.sensitivity - 1) / 9);
}

/**
 * Landmark MediaPipe berkoordinat 0..1 relatif frame kamera asli (tidak mirror).
 * Video ditampilkan dengan object-fit: cover dan di-mirror, jadi:
 *   1. hitung skala/offset cover, 2. balik sumbu X (1 - x), 3. konversi ke piksel stage.
 */
function toStage(lm) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const s = Math.max(geo.W / vw, geo.H / vh);
  const dw = vw * s, dh = vh * s;
  return {
    x: (geo.W - dw) / 2 + (1 - lm.x) * dw,
    y: (geo.H - dh) / 2 + lm.y * dh,
  };
}

/** Titik pemukul satu tangan: ujung telunjuk (landmark 8) atau pusat telapak. */
function strikerPoint(landmarks) {
  if (settings.striker === 'palm') {
    const pts = [0, 5, 9, 13, 17].map(i => toStage(landmarks[i]));
    return {
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
    };
  }
  return toStage(landmarks[8]);
}

async function initHands() {
  if (cam.hands) return;
  if (typeof Hands === 'undefined') throw new Error('Library MediaPipe Hands belum termuat. Periksa koneksi internet.');
  const hands = new Hands({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: settings.model,      // 0 = ringan/cepat, 1 = lebih akurat
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
    selfieMode: false,                    // mirror ditangani sendiri di toStage()
  });
  hands.onResults(onHandResults);
  await hands.initialize();               // mengunduh model (sekali, lalu di-cache browser)
  cam.hands = hands;
}

async function startCamera() {
  if (cam.active) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Browser tidak mendukung kamera, atau halaman tidak dibuka lewat localhost/HTTPS.');
    return false;
  }
  setChip('cam', 'warn', 'meminta izin…');
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
  } catch (err) {
    setChip('cam', 'err', 'ditolak');
    toast(`Kamera tidak dapat diakses: ${err.message}`);
    return false;
  }
  video.srcObject = cam.stream;
  await video.play();
  cam.active = true;
  cam.ready = false;
  cam.lastSeen = performance.now();
  stage.classList.add('cam-on');
  $('#btnCamera').setAttribute('aria-pressed', 'true');

  setChip('cam', 'warn', 'memuat model…');
  showHint('Memuat model pelacak tangan…');
  try {
    await initHands();
  } catch (err) {
    toast(`Model tangan gagal dimuat: ${err.message}`);
    stopCamera();
    setChip('cam', 'err', 'gagal');
    return false;
  }
  processFrame();
  return true;
}

function stopCamera() {
  cam.active = false;
  cam.stream?.getTracks().forEach(track => track.stop());
  cam.stream = null;
  video.srcObject = null;
  tracks.length = 0;
  stage.classList.remove('cam-on');
  $('#btnCamera').setAttribute('aria-pressed', 'false');
  octx.clearRect(0, 0, geo.W, geo.H);
  hideHint();
  setChip('cam', 'off', 'mati');
}

/** Loop pemrosesan: satu frame video baru -> satu panggilan hands.send() (frame menumpuk dilewati). */
async function processFrame() {
  if (!cam.active) return;
  if (!cam.busy && video.readyState >= 2) {
    cam.busy = true;
    try { await cam.hands.send({ image: video }); }
    catch { /* frame gagal, lanjut ke frame berikutnya */ }
    cam.busy = false;
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(processFrame);
  else requestAnimationFrame(processFrame);
}

function onHandResults(results) {
  const now = performance.now();
  const hands = results.multiHandLandmarks || [];

  if (!cam.ready) {
    cam.ready = true;
    setChip('cam', 'on', 'aktif');
    hideHint();
  }
  if (hands.length) cam.lastSeen = now;

  updateTracks(hands.map(strikerPoint), now);
  drawOverlay(hands);
}

/**
 * Mencocokkan titik pemukul frame ini dengan track sebelumnya (tetangga terdekat).
 * Ini mencegah lonjakan kecepatan palsu saat urutan tangan dari MediaPipe tertukar.
 */
function updateTracks(points, now) {
  const used = new Set();
  const maxDist = GESTURE.MATCH_DIST * geo.H;

  for (const p of points) {
    let best = null, bestDist = Infinity;
    for (const tr of tracks) {
      if (used.has(tr)) continue;
      const d = Math.hypot(tr.x - p.x, tr.y - p.y);
      if (d < bestDist) { best = tr; bestDist = d; }
    }
    if (best && bestDist < maxDist) {
      used.add(best);
      stepTrack(best, p, now);
    } else {
      const tr = { x: p.x, y: p.y, vx: 0, vy: 0, prevVy: 0, t: now, zoneId: zoneAt(p.x, p.y)?.inst.id ?? null, locked: new Set() };
      tracks.push(tr);
      used.add(tr);
    }
  }
  // Buang track yang tangannya sudah lama tidak terlihat
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (now - tracks[i].t > GESTURE.STALE_MS) tracks.splice(i, 1);
  }
}

/** Perbarui satu track: haluskan posisi, hitung kecepatan (tinggi-stage/detik), lalu cek pukulan. */
function stepTrack(tr, p, now) {
  const dt = clamp((now - tr.t) / 1000, 0.008, 0.1);
  const sx = lerp(tr.x, p.x, GESTURE.POS_SMOOTH);
  const sy = lerp(tr.y, p.y, GESTURE.POS_SMOOTH);

  const rawVx = (sx - tr.x) / dt / geo.H;
  const rawVy = (sy - tr.y) / dt / geo.H;      // positif = bergerak ke BAWAH layar
  tr.prevVy = tr.vy;
  tr.vx = lerp(tr.vx, rawVx, GESTURE.VEL_SMOOTH);
  tr.vy = lerp(tr.vy, rawVy, GESTURE.VEL_SMOOTH);
  tr.x = sx; tr.y = sy; tr.t = now;

  detectHits(tr, now);
}

/** Zona (pad) yang mengandung titik (x, y) piksel stage; jika ada beberapa, yang paling dekat ke pusat. */
function zoneAt(x, y) {
  let best = null, bestD = Infinity;
  for (const z of Object.values(zones)) {
    const d = Math.hypot(x - z.cx, y - z.cy) / z.r;      // 1.0 = tepat di tepi lingkaran
    if (d <= GESTURE.HIT_PADDING && d < bestD) { best = z; bestD = d; }
  }
  return best;
}

/**
 * INTI DETEKSI PUKULAN. Sebuah pukulan terjadi bila titik pemukul berada di
 * dalam zona DAN salah satu terpenuhi:
 *
 *   A. Masuk zona (frame lalu di luar zona) dengan gerak ke bawah cukup cepat
 *      (atau gerak sangat cepat ke arah mana pun, kecuali jelas ke atas).
 *   B. Sudah di dalam zona, lalu terjadi AKSELERASI tajam ke bawah:
 *      kecepatan turun melewati ambang padahal frame sebelumnya masih pelan.
 *
 * Supaya satu ayunan tidak berbunyi berkali-kali, zona "dikunci" untuk track
 * itu setelah berbunyi. Kunci dilepas ketika tangan keluar zona atau
 * bergerak naik (mengangkat "stik"). Cooldown per zona menahan bunyi ganda.
 */
function detectHits(tr, now) {
  const thr = hitThreshold();
  const speed = Math.hypot(tr.vx, tr.vy);
  const zone = zoneAt(tr.x, tr.y);
  const zoneId = zone ? zone.inst.id : null;

  // Lepas kunci: keluar dari zona, atau bergerak naik
  for (const id of tr.locked) {
    if (id !== zoneId || tr.vy < -thr * 0.3) tr.locked.delete(id);
  }

  if (zone && !tr.locked.has(zoneId) && now - zone.lastHit > GESTURE.COOLDOWN_MS) {
    const entered = tr.zoneId !== zoneId;
    const notRising = tr.vy > -thr * 0.3;
    const hitOnEntry  = entered && notRising && (tr.vy >= thr || speed >= thr * 1.6);
    const hitInside   = !entered && tr.vy >= thr && tr.prevVy < thr * 0.6;

    if (hitOnEntry || hitInside) {
      // Velocity 0.3..1.0 dari seberapa jauh kecepatan melampaui ambang
      const power = Math.max(tr.vy, speed * 0.7);
      const velocity = 0.3 + 0.7 * clamp((power - thr) / (thr * 2.5));
      zone.lastHit = now;
      tr.locked.add(zoneId);
      trigger(zoneId, velocity, 'gesture');
    }
  }
  tr.zoneId = zoneId;
}

/** Gambar kerangka tangan (opsional) dan kursor pemukul. Kursor menguning saat ayunan cukup cepat. */
function drawOverlay(hands) {
  octx.clearRect(0, 0, geo.W, geo.H);

  if (settings.showSkeleton) {
    octx.lineWidth = 2;
    octx.strokeStyle = 'rgba(234, 242, 243, .35)';
    octx.fillStyle = 'rgba(234, 242, 243, .6)';
    for (const hand of hands) {
      const pts = hand.map(toStage);
      octx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        octx.moveTo(pts[a].x, pts[a].y);
        octx.lineTo(pts[b].x, pts[b].y);
      }
      octx.stroke();
      for (const p of pts) {
        octx.beginPath();
        octx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        octx.fill();
      }
    }
  }

  const thr = hitThreshold();
  const now = performance.now();
  for (const tr of tracks) {
    if (now - tr.t > 120) continue;
    const hot = tr.vy >= thr * 0.8;
    octx.beginPath();
    octx.arc(tr.x, tr.y, hot ? 17 : 12, 0, Math.PI * 2);
    octx.fillStyle = hot ? 'rgba(232, 180, 76, .55)' : 'rgba(255, 255, 255, .2)';
    octx.fill();
    octx.lineWidth = 3;
    octx.strokeStyle = hot ? '#e8b44c' : 'rgba(255, 255, 255, .85)';
    octx.stroke();
  }
}

/* Petunjuk di stage: muncul bila tidak ada tangan terlihat beberapa detik */
function showHint(text) { const el = $('#stageHint'); el.textContent = text; el.hidden = false; }
function hideHint()     { $('#stageHint').hidden = true; }
setInterval(() => {
  if (!cam.active || !cam.ready) return;
  if (performance.now() - cam.lastSeen > 2500) showHint('Angkat tangan ke depan kamera');
  else hideHint();
}, 500);

/* ----------------------------------------------------------------------
   10. INPUT MIDI (Web MIDI API)
   ----------------------------------------------------------------------
   Dirancang untuk modul drum elektronik kustom (Arduino/ESP32 dengan
   USB-MIDI atau BLE-MIDI). Pesan "Note On" dipetakan ke instrumen lewat
   midi.map; velocity 1..127 menjadi kekuatan pukulan.
   ---------------------------------------------------------------------- */
const midi = {
  access: null,
  map: null,       // { [nomorNada]: idInstrumen }
  learn: null,     // id instrumen yang sedang di-"learn"
};

function loadMidiMap() {
  const valid = new Set(INSTRUMENTS.map(i => i.id));
  const saved = settings.midiMap;
  const entries = saved ? Object.entries(saved).filter(([, id]) => valid.has(id)) : [];
  midi.map = entries.length ? Object.fromEntries(entries) : defaultMidiMap();
}

async function initMIDI() {
  if (midi.access) return;
  if (!navigator.requestMIDIAccess) {
    setChip('midi', 'err', 'tidak didukung');
    $('#midiStatus').textContent = 'Browser ini tidak mendukung Web MIDI. Gunakan Chrome atau Edge.';
    return;
  }
  try {
    midi.access = await navigator.requestMIDIAccess({ sysex: false });
    midi.access.onstatechange = refreshMidiInputs;    // colok/cabut perangkat saat aplikasi berjalan
    refreshMidiInputs();
  } catch (err) {
    setChip('midi', 'err', 'ditolak');
    $('#midiStatus').textContent = `Akses MIDI ditolak: ${err.message}`;
  }
}

function refreshMidiInputs() {
  const inputs = [...midi.access.inputs.values()];
  inputs.forEach(input => { input.onmidimessage = onMidiMessage; });   // pasang listener ke semua input

  const list = $('#midiDevices');
  list.replaceChildren(...inputs.map(input => h('li', {}, input.name || 'Perangkat MIDI')));
  if (inputs.length) {
    setChip('midi', 'on', `${inputs.length} perangkat`);
    $('#midiStatus').textContent = 'MIDI aktif. Pukul pad di hardware untuk memainkan drum.';
  } else {
    setChip('midi', 'warn', 'tidak ada perangkat');
    $('#midiStatus').textContent = 'MIDI aktif, tetapi belum ada perangkat input yang terdeteksi.';
  }
}

/**
 * Penangkap sinyal MIDI. e.data = [status, data1, data2].
 *   status & 0xF0 = jenis pesan (0x90 Note On, 0x80 Note Off); 4 bit bawah = channel.
 * Channel diabaikan, jadi hardware di channel mana pun tetap terbaca.
 */
function onMidiMessage(e) {
  const [status, note, value] = e.data;
  const command = status & 0xf0;
  if (command !== 0x90 || value === 0) return;    // Note On dengan velocity 0 = Note Off, abaikan

  if (midi.learn) { assignMidiNote(midi.learn, note); return; }

  const id = midi.map[note];
  const inst = INSTRUMENTS.find(i => i.id === id);
  $('#midiMonitor').textContent = `Nada ${noteName(note)}, velocity ${value}` + (inst ? ` memicu ${inst.label}` : ' (belum dipetakan)');
  if (id) trigger(id, value / 127, 'midi');
}

function toggleMidiLearn(id) {
  midi.learn = midi.learn === id ? null : id;
  buildMidiMapList();
}

function assignMidiNote(id, note) {
  for (const n of Object.keys(midi.map)) if (midi.map[n] === id) delete midi.map[n];   // ganti nada lama instrumen ini
  midi.map[note] = id;
  midi.learn = null;
  settings.midiMap = midi.map;
  saveSettings();
  buildMidiMapList();
  toast(`${INSTRUMENTS.find(i => i.id === id).label} sekarang memakai nada ${noteName(note)}`);
}

function resetMidiMap() {
  midi.map = defaultMidiMap();
  midi.learn = null;
  settings.midiMap = null;
  saveSettings();
  buildMidiMapList();
}

/* ----------------------------------------------------------------------
   11. INPUT KEYBOARD DAN POINTER
   ---------------------------------------------------------------------- */
function isTextField(target) {
  return target instanceof HTMLInputElement && ['number', 'text'].includes(target.type);
}

window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
  const id = KEY_MAP.get(e.code);
  if (!id) return;
  e.preventDefault();                          // cegah scroll oleh Spasi dan type-ahead pada <select>
  trigger(id, e.shiftKey ? 0.45 : 0.9, 'keyboard');
});

window.addEventListener('keyup', e => {
  if (!isTextField(e.target) && KEY_MAP.has(e.code)) e.preventDefault();   // cegah "klik" tombol yang fokus saat Spasi dilepas
});

/* ----------------------------------------------------------------------
   12. UI: DRAWER PENGATURAN DAN KONTROL
   ---------------------------------------------------------------------- */
const drawer = $('#drawer');

function openDrawer() {
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  $('#btnSettings').setAttribute('aria-expanded', 'true');
  $('#btnCloseDrawer').focus();
}

function closeDrawer() {
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
  $('#btnSettings').setAttribute('aria-expanded', 'false');
  $('#btnSettings').focus();
  midi.learn = null;
}

function showTab(name) {
  $$('.tab').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $$('.pane').forEach(pane => pane.classList.toggle('is-active', pane.dataset.pane === name));
}

/** Tab Suara: dropdown 5 variasi untuk MASING-MASING instrumen. */
function buildSoundPane() {
  $('#soundList').replaceChildren(...INSTRUMENTS.map(inst => {
    const id = inst.id;
    const select = h('select', { id: `sel-${id}`, 'aria-label': `Suara ${inst.label}` },
      SYNTH_PRESETS[id].map((preset, i) => h('option', { value: i }, `${i + 1}. ${preset.name}`)));
    select.value = settings.variation[id];
    select.addEventListener('change', () => {
      settings.variation[id] = Number(select.value);
      saveSettings();
      ensureAudio();
      updateSourceTag(id);
      // Muat sampel variasi ini (jika ada), lalu perdengarkan
      loadSample(id, settings.variation[id]).then(() => { updateSourceTag(id); trigger(id, 0.8, 'preview'); });
      select.blur();
    });
    return h('div', { class: 'row row-sound', style: `--c:${inst.color}` },
      h('span', { class: 'swatch' }),
      h('label', { class: 'row-name', for: `sel-${id}` }, inst.label),
      select,
      h('span', { class: 'tag', dataset: { tagFor: id } }, 'Sintesis'),
      h('button', {
        class: 'btn btn-square', type: 'button', 'aria-label': `Dengarkan ${inst.label}`,
        onclick: () => { ensureAudio(); trigger(id, 0.8, 'preview'); },
      }, '▶'),
    );
  }));
}

/** Tab Mixer: slider volume dan panning per instrumen. */
function buildMixerPane() {
  const panText = v => (Math.abs(v) < 0.03 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`);
  $('#mixerList').replaceChildren(...INSTRUMENTS.map(inst => {
    const id = inst.id;
    const volOut = h('output', {}, pct(settings.volume[id]));
    const panOut = h('output', {}, panText(settings.pan[id]));
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': `Volume ${inst.label}` });
    const pan = h('input', { type: 'range', min: -1, max: 1, step: 0.05, 'aria-label': `Pan ${inst.label}` });
    vol.value = settings.volume[id];
    pan.value = settings.pan[id];
    vol.addEventListener('input', () => {
      settings.volume[id] = Number(vol.value);
      volOut.textContent = pct(settings.volume[id]);
      applyChannel(id); saveSettings();
    });
    pan.addEventListener('input', () => {
      settings.pan[id] = Number(pan.value);
      panOut.textContent = panText(settings.pan[id]);
      applyChannel(id); saveSettings();
    });
    pan.addEventListener('dblclick', () => {           // klik dua kali = kembali ke pan bawaan
      pan.value = inst.pan;
      pan.dispatchEvent(new Event('input'));
    });
    return h('div', { class: 'mix', style: `--c:${inst.color}` },
      h('div', { class: 'mix-head' }, h('span', { class: 'swatch' }), h('span', { class: 'row-name' }, inst.label)),
      h('div', { class: 'mix-ctrls' }, h('span', {}, 'Vol'), vol, volOut, h('span', {}, 'Pan'), pan, panOut),
    );
  }));
}

function buildKeysPane() {
  $('#keyList').replaceChildren(...INSTRUMENTS.map(inst =>
    h('div', { class: 'row row-keys', style: `--c:${inst.color}` },
      h('span', { class: 'swatch' }),
      h('span', { class: 'row-name' }, inst.label),
      h('span', { class: 'kbds' }, inst.keys.map(code => h('kbd', {}, keyLabel(code)))),
    )));
}

function buildMidiMapList() {
  $('#midiMapList').replaceChildren(...INSTRUMENTS.map(inst => {
    const notes = Object.keys(midi.map).filter(n => midi.map[n] === inst.id).map(Number).sort((a, b) => a - b);
    const learning = midi.learn === inst.id;
    return h('div', { class: 'row row-midi', style: `--c:${inst.color}` },
      h('span', { class: 'swatch' }),
      h('span', { class: 'row-name' }, inst.label),
      h('code', {}, notes.length ? notes.map(noteName).join(', ') : 'belum ada'),
      h('button', {
        class: `btn btn-sm${learning ? ' is-learning' : ''}`, type: 'button',
        onclick: () => toggleMidiLearn(inst.id),
      }, learning ? 'Pukul pad…' : 'Learn'),
    );
  }));
}

/**
 * Menghubungkan <input>/<select> statis dengan settings[key].
 * Opsi: parse (konversi nilai), apply (efek samping), out (elemen output), fmt (format tampilan).
 */
function bind(sel, key, { parse = Number, apply, out, fmt = v => v } = {}) {
  const input = $(sel);
  const isCheck = input.type === 'checkbox';
  const paint = () => {
    if (isCheck) input.checked = Boolean(settings[key]); else input.value = settings[key];
    if (out) $(out).textContent = fmt(settings[key]);
  };
  paint();
  input.addEventListener(isCheck || input.tagName === 'SELECT' ? 'change' : 'input', () => {
    settings[key] = isCheck ? input.checked : parse(input.value);
    if (out) $(out).textContent = fmt(settings[key]);
    apply?.();
    saveSettings();
    if (input.tagName === 'SELECT') input.blur();   // agar tombol drum tidak memicu type-ahead
  });
}

function applyVideoOpacity() { stage.style.setProperty('--cam-opacity', settings.videoOpacity); }

function bindControls() {
  // Master volume ada di dua tempat (bar atas dan tab Master); keduanya disinkronkan
  const syncMaster = () => {
    $('#masterVol').value = settings.master;
    $('#masterVol2').value = settings.master;
    $('#masterVal2').textContent = pct(settings.master);
    applyMaster();
  };
  bind('#masterVol',  'master', { apply: syncMaster });
  bind('#masterVol2', 'master', { apply: syncMaster });
  syncMaster();

  bind('#fxReverb',    'reverbOn',   { apply: applyFx });
  bind('#fxReverbMix', 'reverbMix',  { apply: applyFx, out: '#fxReverbVal', fmt: pct });
  bind('#fxComp',      'compOn',     { apply: applyFx });
  bind('#metroVol',    'metroVol',   { apply: applyMetroRouting, out: '#metroVolVal', fmt: pct });
  bind('#metroBeats',  'metroBeats', { apply: () => { buildBeatDots(); metro.beat = 0; } });
  bind('#metroInRec',  'metroInRec', { apply: applyMetroRouting });
  bind('#recFormat',   'recFormat',  { parse: String });

  bind('#strikePoint',     'striker',     { parse: String });
  bind('#sensitivity',     'sensitivity', { out: '#sensitivityVal' });
  bind('#modelComplexity', 'model',       { apply: () => cam.hands?.setOptions({ modelComplexity: settings.model }) });
  bind('#videoOpacity',    'videoOpacity', { apply: applyVideoOpacity, out: '#videoOpacityVal', fmt: pct });
  bind('#showSkeleton',    'showSkeleton');
  applyVideoOpacity();

  // BPM
  const bpm = $('#bpm');
  bpm.value = settings.bpm;
  bpm.addEventListener('input', () => {
    const v = Number(bpm.value);
    if (v >= 30 && v <= 260) { settings.bpm = v; saveSettings(); }
  });
  bpm.addEventListener('change', () => {
    settings.bpm = clamp(Math.round(Number(bpm.value)) || 100, 30, 260);
    bpm.value = settings.bpm;
    saveSettings();
  });
  bpm.addEventListener('keydown', e => { if (e.key === 'Enter') bpm.blur(); });
}

/* ----------------------------------------------------------------------
   13. BOOTSTRAP
   ---------------------------------------------------------------------- */
async function startApp(withCamera) {
  ensureAudio();
  $('#startOverlay').classList.add('is-hidden');
  initMIDI();
  if (withCamera) await startCamera();
}

function init() {
  loadMidiMap();
  buildPads();
  layout();
  new ResizeObserver(layout).observe(stage);

  buildSoundPane();
  buildMixerPane();
  buildKeysPane();
  buildMidiMapList();
  buildBeatDots();
  bindControls();

  // Layar mulai
  $('#btnStartCam').addEventListener('click', () => startApp(true));
  $('#btnStartNoCam').addEventListener('click', () => startApp(false));
  if (location.protocol === 'file:') {
    const warn = $('#startWarn');
    warn.textContent = 'Halaman dibuka lewat file://. Browser dapat memblokir kamera, MIDI, dan file audio lokal. Jalankan lewat Live Server atau "python -m http.server".';
    warn.hidden = false;
  }

  // Bar atas
  $('#btnCamera').addEventListener('click', async () => {
    if (!audio.ctx) { startApp(true); return; }
    if (cam.active) stopCamera(); else await startCamera();
  });
  $('#btnMetro').addEventListener('click', () => toggleMetronome());
  $('#btnRec').addEventListener('click', toggleRecording);
  $('#btnDownload').addEventListener('click', downloadTake);

  // Drawer
  $('#btnSettings').addEventListener('click', openDrawer);
  $('#btnCloseDrawer').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer(); });
  $$('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  $('#btnReloadSamples').addEventListener('click', () => { ensureAudio(); reloadSamples(); });
  $('#btnMidi').addEventListener('click', initMIDI);
  $('#btnMidiReset').addEventListener('click', resetMidiMap);

  window.addEventListener('pagehide', stopCamera);
}

init();
