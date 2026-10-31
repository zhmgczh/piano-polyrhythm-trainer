// Polyrhythm math, five-finger positions and fingering patterns. Pure functions only.

export const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export const lcm = (a, b) => (a / gcd(a, b)) * b;
export const mod = (n, m) => ((n % m) + m) % m;

export const PRESETS = [
  [2, 3], [3, 2], [3, 4], [4, 3], [2, 5], [3, 5], [5, 3], [4, 5], [5, 4], [5, 6],
];

/**
 * Onsets of one cycle, merged across both hands.
 * Each entry: { step, phase, L: index|null, R: index|null }.
 */
export function composite(L, R) {
  const g = lcm(L, R);
  const map = new Map();
  const at = (step) => {
    if (!map.has(step)) map.set(step, { step, phase: step / g, L: null, R: null });
    return map.get(step);
  };
  for (let i = 0; i < L; i++) at(i * (g / L)).L = i;
  for (let i = 0; i < R; i++) at(i * (g / R)).R = i;
  return [...map.values()].sort((a, b) => a.step - b.step);
}

const MNEMONICS = {
  '2:3': { en: ['Nice', 'cup', 'of', 'tea'], 'zh-TW': ['喝', '杯', '熱', '茶'] },
  '3:4': { en: ['Pass', 'the', 'gol', 'den', 'but', 'ter'], 'zh-TW': ['請', '遞', '金', '黃', '奶', '油'] },
};

/** Composite onsets with a syllable each (mnemonic words when known, grid counts otherwise). */
export function syllables(L, R, lang) {
  const comp = composite(L, R);
  const key = `${Math.min(L, R)}:${Math.max(L, R)}`;
  const words = L !== R ? MNEMONICS[key]?.[lang] : null;
  return comp.map((c, i) => ({
    ...c,
    who: c.L !== null && c.R !== null ? 'B' : c.L !== null ? 'L' : 'R',
    text: words && words.length === comp.length ? words[i] : String(c.step + 1),
  }));
}

// ---------- Five-finger positions ----------

export const KEY_NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const KEY_NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SOLFEGE = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

// Keys (pitch classes) whose major / minor five-finger positions are spelled with flats.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);
// Display names for the key selector: prefer the common spelling.
export const KEY_LABELS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod(m, 12));

export function usesFlats(cfg) {
  return (cfg.scale === 'minor' ? FLAT_MINOR : FLAT_MAJOR).has(cfg.key);
}

/** Spelling of a MIDI note: { letter 0–6, acc -1|0|1, octave, diatonic } */
export function spell(midi, flats) {
  const pc = mod(midi, 12);
  const [letter, acc] = (flats ? FLAT_SPELL : SHARP_SPELL)[pc];
  const octave = Math.floor(midi / 12) - 1;
  return { letter, acc, octave, diatonic: octave * 7 + letter };
}

export function noteName(midi, flats, style = 'letters', withOctave = true) {
  const s = spell(midi, flats);
  const base = style === 'solfege' ? SOLFEGE[s.letter] : LETTERS[s.letter];
  const acc = s.acc === 1 ? '♯' : s.acc === -1 ? '♭' : '';
  return base + acc + (withOctave ? s.octave : '');
}

const MAJOR = [0, 2, 4, 5, 7];
const MINOR = [0, 2, 3, 5, 7];

/** MIDI note for each finger (index 1..5) of each hand. */
export function positions(cfg) {
  const offs = cfg.scale === 'minor' ? MINOR : MAJOR;
  const lhRoot = 12 * (cfg.lhOctave + 1) + cfg.key;
  const rhRoot = 12 * (cfg.rhOctave + 1) + cfg.key;
  const L = [0], R = [0];
  for (let f = 1; f <= 5; f++) {
    R[f] = rhRoot + offs[f - 1];   // RH thumb on the root
    L[f] = lhRoot + offs[5 - f];   // LH pinky on the root
  }
  return { L, R };
}

/** Lowest/highest white keys to draw so both positions fit with some room around. */
export function keyboardRange(cfg) {
  const p = positions(cfg);
  const all = [...p.L.slice(1), ...p.R.slice(1)];
  let lo = Math.min(...all) - 3, hi = Math.max(...all) + 3;
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  const whites = () => { let n = 0; for (let m = lo; m <= hi; m++) if (!isBlack(m)) n++; return n; };
  let flip = false;
  while (whites() < 15) {
    if (flip) { hi++; while (isBlack(hi)) hi++; } else { lo--; while (isBlack(lo)) lo--; }
    flip = !flip;
  }
  return { lo, hi };
}

// ---------- Fingering patterns ----------

export const PATTERNS = [
  { id: 'f1', group: 'single', seq: [1] },
  { id: 'f2', group: 'single', seq: [2] },
  { id: 'f3', group: 'single', seq: [3] },
  { id: 'f4', group: 'single', seq: [4] },
  { id: 'f5', group: 'single', seq: [5] },
  { id: 'up', group: 'seq', seq: [1, 2, 3, 4, 5] },
  { id: 'down', group: 'seq', seq: [5, 4, 3, 2, 1] },
  { id: 'updown', group: 'seq', seq: [1, 2, 3, 4, 5, 4, 3, 2] },
  { id: 'thirds', group: 'seq', seq: [1, 3, 2, 4, 3, 5, 4, 2] },
  { id: 'pivot', group: 'seq', seq: [1, 2, 1, 3, 1, 4, 1, 5] },
  { id: 'spread', group: 'seq', seq: [3, 2, 4, 1, 5, 1, 4, 2] },
  { id: 'triad', group: 'seq', seq: [1, 3, 5, 3] },
  { id: 'alberti', group: 'seq', seq: [1, 5, 3, 5] },
  { id: 'albertiLow', group: 'seq', seq: [5, 1, 3, 1] },
  { id: 'dyad', group: 'chord', seq: [[1, 5]] },
  { id: 'thirdsDbl', group: 'chord', seq: [[1, 3], [2, 4], [3, 5], [2, 4]] },
  { id: 'chord', group: 'chord', seq: [[1, 3, 5]] },
  { id: 'rotate', group: 'smart' },
  { id: 'random', group: 'smart' },
  { id: 'custom', group: 'custom' },
];
export const PATTERN_GROUPS = ['single', 'seq', 'chord', 'smart', 'custom'];
const PATTERN_BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));
export const isPattern = (id) => PATTERN_BY_ID.has(id);

const customCache = new Map();
/** Parse "1 3 5+1, 2" into [[1],[3],[5,1],[2]]. */
export function parseCustom(text) {
  if (customCache.has(text)) return customCache.get(text);
  const seq = [];
  for (const tok of String(text || '').split(/[\s,，、;／/|]+/)) {
    const fingers = [...new Set(tok.split(/[+＋&]/).map((x) => parseInt(x, 10)).filter((f) => f >= 1 && f <= 5))];
    if (fingers.length) seq.push(fingers.sort((a, b) => a - b));
  }
  const result = seq.length ? seq : [[1]];
  if (customCache.size > 50) customCache.clear();
  customCache.set(text, result);
  return result;
}

function hash32(a, b, c) {
  let h = 2166136261 ^ a;
  h = Math.imul(h ^ (b + 0x9e3779b9), 16777619);
  h = Math.imul(h ^ (c + 0x85ebca6b), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

function shuffledBag(bag, handSalt, seed) {
  let x = hash32(seed, bag, handSalt) || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const a = [1, 2, 3, 4, 5];
  for (let i = 4; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Fingers used by `hand` for note `i` (of `n`) in cycle `cycle`. */
export function fingersAt(cfg, hand, cycle, i, n) {
  const id = hand === 'L' ? cfg.lhPattern : cfg.rhPattern;
  const step = cycle * n + i;
  if (id === 'rotate') return [mod(cycle, 5) + 1];
  if (id === 'random') {
    const salt = hand === 'L' ? 7 : 13;
    return [shuffledBag(Math.floor(step / 5), salt, cfg.seed || 1)[mod(step, 5)]];
  }
  const seq = id === 'custom'
    ? parseCustom(hand === 'L' ? cfg.lhCustom : cfg.rhCustom)
    : (PATTERN_BY_ID.get(id) || PATTERN_BY_ID.get('up')).seq;
  const item = seq[mod(step, seq.length)];
  return Array.isArray(item) ? item : [item];
}

/** Fingers + MIDI notes for one note event. */
export function noteAt(cfg, pos, hand, cycle, i, n) {
  const fingers = fingersAt(cfg, hand, cycle, i, n);
  const table = hand === 'L' ? pos.L : pos.R;
  return { fingers, midis: fingers.map((f) => table[f]) };
}

/** Cycle duration in seconds for a given tempo setting. */
export function cycleSeconds(tempoRef, bpm, L, R) {
  const beat = 60 / bpm;
  if (tempoRef === 'L') return beat * L;
  if (tempoRef === 'R') return beat * R;
  return beat;
}

export const playsHand = (mode, hand) => mode === 'both' || (mode === 'left' && hand === 'L') || (mode === 'right' && hand === 'R');
