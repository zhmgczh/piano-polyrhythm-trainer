// Spoken rhythm chants (Traditional Chinese interface only). Each recording says one syllable
// per grid step of the beat at 120 syllables a minute: a 2:3 chant has 6 syllables, a 3:4
// chant 12. The player cuts a recording into its syllables and schedules each one on the
// metronome grid, so the chant stays aligned at any tempo: slower tempos leave longer gaps,
// faster ones time-compress each syllable (pitch unchanged).

import { lcm } from './rhythm.js';

export const CHANT_SLOT = 0.5;   // seconds per syllable in the recordings
const MAX_SQUEEZE = 2.5;         // fastest time compression before syllables are cut short

// [sound start, sound end] of every syllable in seconds; syllable i is on the beat at i × 0.5 s.
const CHANTS_DATA = {
  '2-3-both': [[0.000, 0.219], [0.373, 0.843], [0.983, 1.276], [1.490, 1.750], [1.974, 2.249], [2.482, 2.712]],
  '2-3-right': [[0.000, 0.253], [0.446, 0.706], [0.983, 1.230], [1.486, 1.779], [1.993, 2.319], [2.486, 2.800]],
  '2-3-left': [[0.000, 0.265], [0.477, 0.765], [0.963, 1.268], [1.485, 1.678], [1.988, 2.227], [2.481, 2.748]],
  '3-4-both': [[0.000, 0.184], [0.370, 0.728], [0.978, 1.228], [1.478, 1.737], [1.972, 2.187], [2.480, 2.778], [2.989, 3.167], [3.467, 3.763], [3.974, 4.225], [4.488, 4.666], [4.980, 5.237], [5.484, 5.675]],
  '3-4-right': [[0.000, 0.184], [0.460, 0.757], [0.950, 1.186], [1.488, 1.696], [1.980, 2.213], [2.488, 2.722], [2.993, 3.222], [3.493, 3.725], [3.994, 4.240], [4.485, 4.690], [4.985, 5.201], [5.483, 5.670]],
  '3-4-left': [[0.000, 0.182], [0.459, 0.688], [0.951, 1.241], [1.463, 1.685], [1.990, 2.203], [2.488, 2.726], [2.986, 3.202], [3.473, 3.742], [3.957, 4.268], [4.492, 4.725], [4.993, 5.245], [5.492, 5.757]],
};

export const CHANTS = [
  { id: '2-3-both', L: 2, R: 3, text: '一起右左右呀', count: null },
  { id: '2-3-right', L: 2, R: 3, text: '一一二二三三', count: 'R' },
  { id: '2-3-left', L: 2, R: 3, text: '一一一二二二', count: 'L' },
  { id: '3-4-both', L: 3, R: 4, text: '一起來右左來右來左右來呀', count: null },
  { id: '3-4-right', L: 3, R: 4, text: '一一一二二二三三三四四四', count: 'R' },
  { id: '3-4-left', L: 3, R: 4, text: '一一一一二二二二三三三三', count: 'L' },
].map((c) => ({ ...c, url: `assets/audio/chant-${c.id}.wav`, cuts: CHANTS_DATA[c.id] }));

export const chantById = (id) => CHANTS.find((c) => c.id === id) || null;

/** Tempo (BPM) at which a chant plays at its recorded speed: one beat holds every syllable. */
export const nativeBpm = (c) => 60 / (CHANT_SLOT * c.text.length);

/**
 * Which hand each syllable marks: 'B' / 'L' / 'R' where that hand plays, '' for rests and holds.
 * A counting chant marks only the counted hand.
 */
export function chantMarks(c) {
  const n = lcm(c.L, c.R);
  return [...c.text].map((_, i) => {
    const l = i % (n / c.L) === 0, r = i % (n / c.R) === 0;
    if (c.count === 'L') return l ? 'L' : '';
    if (c.count === 'R') return r ? 'R' : '';
    return l && r ? 'B' : l ? 'L' : r ? 'R' : '';
  });
}

/** WSOLA time-scale change of mono samples; ratio > 1 makes it shorter. */
export function wsola(x, ratio, sr) {
  const N = Math.round(0.025 * sr) & ~1, H = N >> 1, tol = Math.round(0.005 * sr);
  const outLen = Math.floor(x.length / ratio);
  const y = new Float32Array(outLen + N);
  const wsum = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N);
  const at = (i) => (i >= 0 && i < x.length ? x[i] : 0);
  let prev = 0;
  for (let m = 0; m * H < outLen; m++) {
    const nominal = Math.round(m * H * ratio);
    let pos = nominal;
    if (m > 0) {
      // Pick the frame that best continues the previous one (keeps the waveform periodic).
      const nat = prev + H;
      let best = -Infinity;
      for (let p = Math.max(0, nominal - tol); p <= nominal + tol; p += 2) {
        let c = 0;
        for (let j = 0; j < N; j += 4) c += at(p + j) * at(nat + j);
        if (c > best) { best = c; pos = p; }
      }
    }
    for (let j = 0; j < N; j++) {
      const w = m === 0 && j < H ? 1 : win[j];   // flat start keeps the attack intact
      y[m * H + j] += at(pos + j) * w;
      wsum[m * H + j] += w;
    }
    prev = pos;
  }
  for (let i = 0; i < outLen; i++) y[i] /= Math.max(wsum[i], 1e-3);
  return y.subarray(0, outLen);
}

export class ChantPlayer {
  constructor(audio) {
    this.audio = audio;
    this.decoded = new Map();   // chant id -> Promise<AudioBuffer>
    this.cache = new Map();     // `${id}:${i}:${squeeze}` -> { buf, pre }
  }

  load(c) {
    if (!this.decoded.has(c.id)) {
      const p = fetch(c.url)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => this.audio.ctx.decodeAudioData(ab, res, rej)));
      p.catch(() => this.decoded.delete(c.id));
      this.decoded.set(c.id, p);
    }
    return this.decoded.get(c.id);
  }

  /** How much to time-compress syllables when each one gets `slot` seconds. */
  static squeeze(slot) {
    return Math.min(MAX_SQUEEZE, Math.max(1, Math.round((CHANT_SLOT / slot) * 20) / 20));
  }

  /** Seconds from a syllable's first sound to its beat, after compression. */
  static pre(c, i, squeeze) {
    return (i * CHANT_SLOT - c.cuts[i][0]) / squeeze;
  }

  /** Syllable i of a decoded chant, compressed by `squeeze`: { buf, pre }. */
  syllable(c, decoded, i, squeeze) {
    const key = `${c.id}:${i}:${squeeze}`;
    let s = this.cache.get(key);
    if (s) return s;
    const sr = decoded.sampleRate;
    const [a, b] = c.cuts[i];
    let data = decoded.getChannelData(0).subarray(Math.round(a * sr), Math.round(b * sr));
    if (squeeze > 1) data = wsola(data, squeeze, sr);
    const buf = this.audio.ctx.createBuffer(1, Math.max(1, data.length), sr);
    buf.copyToChannel(data, 0);
    s = { buf, pre: ChantPlayer.pre(c, i, squeeze) };
    this.cache.set(key, s);
    return s;
  }
}
