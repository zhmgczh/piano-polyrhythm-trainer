// Settings, progress persistence and share links.

const SETTINGS_KEY = 'ppt:settings:v1';
const PROGRESS_KEY = 'ppt:progress:v1';
const UI_KEY = 'ppt:ui:v1';
const PRESETS_KEY = 'ppt:presets:v1';

export const DEFAULTS = Object.freeze({
  ver: 3,
  left: 2,
  right: 3,
  bpm: 40,
  tempoRef: 'cycle',          // 'cycle' | 'L' | 'R'
  playMode: 'listen',         // 'listen' | 'left' | 'right' | 'both'
  strict: false,
  countIn: 1,
  limit: 'none',              // 'none' | 'c8' | 'c16' ... | 'm5' ...
  guideVol: 0,                // app's guide sound for the hand(s) you play (0 = only your own presses)
  accomp: false,              // in Left/Right mode, the app plays the other hand
  key: 0,
  scale: 'major',
  lhOctave: 3,
  rhOctave: 4,
  lhPattern: 'up',
  rhPattern: 'up',
  lhCustom: '5 3 1 3',
  rhCustom: '1 3 5 3',
  showFingers: true,
  instrument: 'piano',
  masterVol: 0.8,
  lhVol: 0.8,
  rhVol: 0.8,
  metroVol: 0.7,
  metro: {
    on: true,
    sound: 'mech',              // see METRO_SOUND_IDS in audio.js
    gapKeep: true,              // keep clicking during silent cycles
    layers: {
      down: { on: true, vol: 1 },     // beat 1 of every cycle
      L: { on: false, vol: 0.7 },     // left-hand pulse
      R: { on: false, vol: 0.7 },     // right-hand pulse
      grid: { on: false, vol: 0.45 }, // every common subdivision
      custom: { on: false, vol: 0.85 },
    },
    mode: 'coarse',             // 'coarse' = main beats only, 'sub' = add subdivisions
    sub: 2,                     // subdivided mode: clicks per main beat (2–9)
    subVol: 0.6,                // subdivision click volume (relative)
    swing: 0,                   // 0–100 % swing for even subdivisions
    randomMute: 0,              // % of clicks dropped at random (never beat 1)
    vibrate: false,             // vibrate on beat 1 (phones)
    beats: 4,                   // custom layer: beats per bar
    span: 1,                    // custom layer: bar length in cycles
    pattern: ['A', 'N', 'N', 'N'],  // per-beat level: A accent, N normal, S soft, M mute
  },
  reverb: 0.22,
  stereo: true,
  inputSound: true,
  speed: { on: false, start: 30, target: 60, step: 3, every: 4, threshold: 85 },
  gap: { on: false, play: 3, mute: 1 },
  cue: { on: false, sound: 'tap', vol: 0.6, who: 'all', pan: 1 },  // ear cues (off by default): left ear = left hand
  edgeFlash: true,
  view: 'pulse',
  lang: 'auto',
  theme: 'auto',
  noteNames: 'letters',
  latency: 0,
  fallZoom: 2,
  midiSplit: 0,               // 0 = auto, otherwise MIDI note number of the first right-hand key
  keyLabels: true,
  reduceMotion: false,
  wakeLock: true,
});

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Merge `src` into a copy of `base`, keeping only keys (and types) that exist in base. */
function mergeKnown(base, src) {
  const out = clone(base);
  if (!src || typeof src !== 'object') return out;
  for (const k of Object.keys(base)) {
    if (!(k in src)) continue;
    const b = base[k], v = src[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = mergeKnown(b, v);
    else if (typeof v === typeof b) out[k] = v;
  }
  return out;
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function loadSettings() {
  const raw = readJSON(SETTINGS_KEY);
  const s = mergeKnown(DEFAULTS, raw);
  if (raw && (raw.ver || 1) < DEFAULTS.ver) {
    const from = raw.ver || 1;
    // v2: practice is silent apart from your own playing unless you opt in.
    if (from < 2) { s.guideVol = 0; s.accomp = false; }
    // v3: louder metronome; time-signature presets no longer use soft beats.
    if (from < 3) {
      if (s.metroVol === 0.5) s.metroVol = 0.7;
      const OLD_SIGS = { ASNS: 'ANNN', ASSNS: 'ANNAN', ASSNSS: 'ANNANN', ASNSNSS: 'ANANANN', ASSNSSNSS: 'ANNANNANN', ASSNSSNSSNSS: 'ANNANNANNANN' };
      const pat = Array.isArray(s.metro.pattern) ? s.metro.pattern.join('') : '';
      if (OLD_SIGS[pat]) s.metro.pattern = [...OLD_SIGS[pat]];
    }
    s.ver = DEFAULTS.ver;
  }
  return sanitize(s);
}

let saveTimer = 0;
export function saveSettings(s) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON(SETTINGS_KEY, s), 250);
}

export function defaultSettings() {
  return clone(DEFAULTS);
}

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Clamp every numeric setting into a safe range. */
export function sanitize(s) {
  s.left = clampInt(s.left, 1, 12, 2);
  s.right = clampInt(s.right, 1, 12, 3);
  s.bpm = clampInt(s.bpm, 5, 300, 40);
  s.key = clampInt(s.key, 0, 11, 0);
  s.lhOctave = clampInt(s.lhOctave, 1, 5, 3);
  s.rhOctave = clampInt(s.rhOctave, 2, 6, 4);
  s.countIn = clampInt(s.countIn, 0, 4, 1);
  s.latency = clampInt(s.latency, -100, 300, 0);
  s.midiSplit = clampInt(s.midiSplit, 0, 108, 0);
  s.speed.start = clampInt(s.speed.start, 5, 300, 30);
  s.speed.target = clampInt(s.speed.target, 5, 300, 60);
  s.speed.step = clampInt(s.speed.step, 1, 40, 3);
  s.speed.every = clampInt(s.speed.every, 1, 64, 4);
  s.speed.threshold = clampInt(s.speed.threshold, 0, 100, 85);
  s.gap.play = clampInt(s.gap.play, 1, 16, 3);
  s.gap.mute = clampInt(s.gap.mute, 1, 16, 1);
  if (!['cycle', 'L', 'R'].includes(s.tempoRef)) s.tempoRef = 'cycle';
  if (!['listen', 'left', 'right', 'both'].includes(s.playMode)) s.playMode = 'listen';
  if (!['major', 'minor'].includes(s.scale)) s.scale = 'major';
  if (!['pulse', 'orbit', 'timeline', 'falling', 'score'].includes(s.view)) s.view = 'pulse';
  if (!/^(none|[cm]\d{1,3})$/.test(s.limit)) s.limit = 'none';
  for (const k of ['guideVol', 'masterVol', 'lhVol', 'rhVol', 'metroVol', 'reverb']) {
    s[k] = Math.min(1, Math.max(0, Number(s[k]) || 0));
  }
  s.fallZoom = Math.min(4, Math.max(1, Number(s.fallZoom) || 2));
  const m = s.metro;
  m.beats = clampInt(m.beats, 1, 16, 4);
  m.sub = clampInt(m.sub, 2, 9, 2);
  m.swing = clampInt(m.swing, 0, 100, 0);
  m.randomMute = clampInt(m.randomMute, 0, 80, 0);
  m.subVol = Math.min(1, Math.max(0, Number(m.subVol) || 0));
  if (!['coarse', 'sub'].includes(m.mode)) m.mode = 'coarse';
  m.span = clampInt(m.span, 1, 4, 1);
  if (!['mech', 'quartz', 'wood', 'claves', 'cowbell', 'stick', 'beep', 'click'].includes(m.sound)) m.sound = 'mech';
  const c = s.cue;
  if (!['tap', 'knock', 'clap', 'snap'].includes(c.sound)) c.sound = 'tap';
  if (!['all', 'mine', 'app'].includes(c.who)) c.who = 'all';
  c.vol = Math.min(1, Math.max(0, Number(c.vol) || 0));
  c.pan = Math.min(1, Math.max(0, Number(c.pan) || 0));
  const pat = Array.isArray(m.pattern) ? m.pattern.filter((x) => ['A', 'N', 'S', 'M'].includes(x)) : [];
  while (pat.length < m.beats) pat.push(pat.length ? 'N' : 'A');
  m.pattern = pat.slice(0, m.beats);
  for (const layer of Object.values(m.layers)) layer.vol = Math.min(1, Math.max(0, Number(layer.vol) || 0));
  return s;
}

// ---------- Progress ----------

export function loadProgress() {
  const p = readJSON(PROGRESS_KEY) || {};
  return {
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
    lessons: p.lessons && typeof p.lessons === 'object' ? p.lessons : {},
    totalSeconds: Number(p.totalSeconds) || 0,
    days: Array.isArray(p.days) ? p.days : [],
  };
}

export function saveProgress(p) {
  if (p.sessions.length > 300) p.sessions = p.sessions.slice(-300);
  if (p.days.length > 400) p.days = p.days.slice(-400);
  writeJSON(PROGRESS_KEY, p);
}

export function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
}

// ---------- Small UI state (open sections etc.) ----------

export function loadUi() {
  return readJSON(UI_KEY) || {};
}
export function saveUi(ui) {
  writeJSON(UI_KEY, ui);
}

// ---------- Saved presets (setlist) ----------

export function loadPresets() {
  const p = readJSON(PRESETS_KEY);
  return Array.isArray(p) ? p.filter((x) => x && typeof x.name === 'string' && x.data) : [];
}
export function savePresets(list) {
  writeJSON(PRESETS_KEY, list.slice(-50));
}

// ---------- Share links ----------

const HASH_FIELDS = [
  ['l', 'left', 'int'], ['r', 'right', 'int'], ['bpm', 'bpm', 'int'], ['ref', 'tempoRef', 'str'],
  ['m', 'playMode', 'str'], ['k', 'key', 'int'], ['s', 'scale', 'str'],
  ['lo', 'lhOctave', 'int'], ['ro', 'rhOctave', 'int'],
  ['lp', 'lhPattern', 'str'], ['rp', 'rhPattern', 'str'], ['lc', 'lhCustom', 'str'], ['rc', 'rhCustom', 'str'],
  ['i', 'instrument', 'str'], ['v', 'view', 'str'],
];

export function buildShareUrl(s) {
  const q = new URLSearchParams();
  for (const [short, key] of HASH_FIELDS) {
    if (key === 'lhCustom' && s.lhPattern !== 'custom') continue;
    if (key === 'rhCustom' && s.rhPattern !== 'custom') continue;
    q.set(short, String(s[key]));
  }
  const url = new URL(location.href);
  url.hash = q.toString();
  return url.toString();
}

/** Apply settings from the URL hash (if any). Returns true when something was applied. */
export function applyHash(s) {
  const raw = location.hash.replace(/^#/, '');
  if (!raw || !raw.includes('=')) return false;
  const q = new URLSearchParams(raw);
  let applied = false;
  for (const [short, key, type] of HASH_FIELDS) {
    if (!q.has(short)) continue;
    const v = q.get(short);
    s[key] = type === 'int' ? Number(v) : v;
    applied = true;
  }
  sanitize(s);
  return applied;
}
