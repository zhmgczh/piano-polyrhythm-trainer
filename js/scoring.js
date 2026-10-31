// Timing judgement: matches key presses to expected notes and keeps statistics per hand.

export const WEIGHT = { perfect: 1, great: 0.85, good: 0.5, miss: 0, extra: 0, wrong: 0 };
export const HIT_TYPES = new Set(['perfect', 'great', 'good']);

/** Judgement windows (seconds) scaled to the gap between this hand's notes. */
export function windowsFor(interval) {
  return {
    perfect: Math.min(0.03, interval * 0.2),
    great: Math.min(0.065, interval * 0.34),
    good: Math.min(0.15, interval * 0.48),
  };
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export class Scorer {
  constructor() {
    this.onJudge = null;
    this.active = { L: false, R: false };
    this.reset();
  }

  reset() {
    this.pending = [];
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0, extra: 0, wrong: 0 };
    this.hand = {
      L: { sum: 0, total: 0, offsets: [], recent: [], counts: { perfect: 0, great: 0, good: 0, miss: 0, extra: 0, wrong: 0 } },
      R: { sum: 0, total: 0, offsets: [], recent: [], counts: { perfect: 0, great: 0, good: 0, miss: 0, extra: 0, wrong: 0 } },
    };
    this.sum = 0;
    this.total = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.byCycle = new Map();
    this.lastMatch = { L: null, R: null };
    this.marks = [];          // recent judgements for drawing { hand, pos, type, dt, at }
  }

  /** Which hands are currently being judged (can change mid-session). */
  setActive(mode) {
    this.active = { L: mode === 'left' || mode === 'both', R: mode === 'right' || mode === 'both' };
  }

  register(ev) {
    this.pending.push(ev);
  }

  /**
   * A key press. info: { pos, finger, midi, strict }
   * Returns the judgement, or null when the press is ignored.
   */
  input(hand, time, info) {
    if (!this.active[hand]) return null;
    // Several keys pressed together (chords / flams) count as one gesture.
    const lm = this.lastMatch[hand];
    if (lm && Math.abs(time - lm.time) < 0.045) return null;

    let best = null, bestAbs = Infinity;
    for (const ev of this.pending) {
      if (ev.hand !== hand || ev.result) continue;
      const dt = time - ev.time;
      const w = windowsFor(ev.interval).good;
      if (Math.abs(dt) <= w && Math.abs(dt) < bestAbs) { best = ev; bestAbs = Math.abs(dt); }
    }
    if (!best) {
      this.lastMatch[hand] = { time };
      return this.record({ type: 'extra', hand, dt: null, pos: info.pos, cycle: Math.floor(info.pos) });
    }
    const dt = time - best.time;
    let type;
    if (info.strict && !this.keyMatches(best, info)) type = 'wrong';
    else {
      const w = windowsFor(best.interval);
      type = bestAbs <= w.perfect ? 'perfect' : bestAbs <= w.great ? 'great' : 'good';
    }
    best.result = type;
    this.lastMatch[hand] = { time };
    return this.record({ type, hand, dt, pos: info.pos, cycle: best.cycle, ev: best });
  }

  keyMatches(ev, info) {
    if (info.midi != null) return ev.midis.includes(info.midi);
    if (info.finger != null) return ev.fingers.includes(info.finger);
    return true;
  }

  /** Mark notes that have passed without a press as misses. */
  update(heard) {
    for (const ev of this.pending) {
      if (ev.result) continue;
      if (heard > ev.time + windowsFor(ev.interval).good + 0.02) {
        if (!this.active[ev.hand]) { ev.result = 'skip'; continue; }
        ev.result = 'miss';
        this.record({ type: 'miss', hand: ev.hand, dt: null, pos: ev.pos, cycle: ev.cycle, ev });
      }
    }
    if (this.pending.length > 64) this.pending = this.pending.filter((e) => !e.result || e.time > heard - 1);
  }

  record(j) {
    const w = WEIGHT[j.type];
    const h = this.hand[j.hand];
    this.sum += w; this.total++;
    h.sum += w; h.total++;
    this.counts[j.type]++;
    h.counts[j.type]++;
    if (j.dt != null && HIT_TYPES.has(j.type)) h.offsets.push(j.dt);
    h.recent.push(w);
    if (h.recent.length > 12) h.recent.shift();
    if (HIT_TYPES.has(j.type)) { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
    else this.combo = 0;
    const c = this.byCycle.get(j.cycle) || { sum: 0, total: 0 };
    c.sum += w; c.total++;
    this.byCycle.set(j.cycle, c);
    j.at = performance.now();
    this.marks.push(j);
    if (this.marks.length > 80) this.marks.shift();
    this.onJudge?.(j);
    return j;
  }

  get accuracy() { return this.total ? this.sum / this.total : null; }

  handAccuracy(hand) {
    const h = this.hand[hand];
    return h.total ? h.sum / h.total : null;
  }

  /** Rolling accuracy over the last few notes of one hand (0..1) or null. */
  recentAccuracy(hand) {
    const r = this.hand[hand].recent;
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
  }

  cycleAccuracy(from, to) {
    let sum = 0, total = 0;
    for (let k = from; k <= to; k++) {
      const c = this.byCycle.get(k);
      if (c) { sum += c.sum; total += c.total; }
    }
    return total ? sum / total : null;
  }

  summary() {
    const handStats = (key) => {
      const h = this.hand[key];
      const offs = h.offsets.map((x) => x * 1000);
      const hits = h.counts.perfect + h.counts.great + h.counts.good;
      const expected = hits + h.counts.miss + h.counts.wrong;
      return {
        total: h.total,
        accuracy: h.total ? h.sum / h.total : null,
        mean: mean(offs),
        sd: sd(offs),
        hits,
        expected,
        offsets: offs,
        counts: { ...h.counts },
      };
    };
    return {
      accuracy: this.accuracy,
      total: this.total,
      counts: { ...this.counts },
      maxCombo: this.maxCombo,
      L: handStats('L'),
      R: handStats('R'),
    };
  }
}
