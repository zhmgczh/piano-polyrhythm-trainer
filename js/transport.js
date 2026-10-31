// Sample-accurate look-ahead scheduler. Musical time is measured in "cycle positions":
// position 3.25 means a quarter of the way through the 4th cycle (cycles count from 0;
// negative positions are the count-in).

import { cycleSeconds, noteAt, positions, playsHand, lcm, mod } from './rhythm.js';

const AHEAD = 0.14;     // seconds of audio scheduled in advance
const TICK_MS = 25;

/** Piecewise-linear map between context time and cycle position (handles tempo changes). */
export class Timeline {
  constructor() { this.segs = [{ t0: 0, pos0: 0, dur: 1 }]; }

  reset(t0, pos0, dur) { this.segs = [{ t0, pos0, dur }]; }

  segForTime(t) {
    for (let i = this.segs.length - 1; i > 0; i--) if (this.segs[i].t0 <= t) return this.segs[i];
    return this.segs[0];
  }

  segForPos(p) {
    for (let i = this.segs.length - 1; i > 0; i--) if (this.segs[i].pos0 <= p) return this.segs[i];
    return this.segs[0];
  }

  posAt(t) { const s = this.segForTime(t); return s.pos0 + (t - s.t0) / s.dur; }
  timeAt(p) { const s = this.segForPos(p); return s.t0 + (p - s.pos0) * s.dur; }
  durAtPos(p) { return this.segForPos(p).dur; }

  /** New tempo from context time t onward. */
  change(t, dur) {
    const pos0 = this.posAt(t);
    this.segs = this.segs.filter((s, i) => i === 0 || s.t0 <= t);
    this.segs.push({ t0: t, pos0, dur });
    this.prune(t);
  }

  /** New tempo from cycle position p onward. */
  changeAtPos(p, dur) {
    const t0 = this.timeAt(p);
    this.segs = this.segs.filter((s, i) => i === 0 || s.pos0 <= p);
    this.segs.push({ t0, pos0: p, dur });
    this.prune(t0);
  }

  prune(t) {
    while (this.segs.length > 2 && this.segs[1].t0 < t - 20) this.segs.shift();
  }
}

function makeTimer(fn) {
  try {
    const src = 'let id=0;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return { start: () => w.postMessage(TICK_MS), stop: () => w.postMessage(0) };
  } catch {
    let id = 0;
    return { start: () => { clearInterval(id); id = setInterval(fn, TICK_MS); }, stop: () => clearInterval(id) };
  }
}

export class Transport {
  /**
   * hooks: {
   *   getCfg(): settings,
   *   onCycle(k, transport) -> { stop?: boolean, bpm?: number } | void,
   *   onNote(event),
   * }
   */
  constructor(audio, hooks) {
    this.audio = audio;
    this.hooks = hooks;
    this.tl = new Timeline();
    this.playing = false;
    this.halted = false;
    this.finishAt = null;
    this.bpm = 60;
    this.countIn = 0;
    this.specs = new Map();
    this.seq = 0;
    this.timer = makeTimer(() => this.tick());
  }

  get cfg() { return this.hooks.getCfg(); }

  /** Rhythm used by cycle k (cycles already scheduled keep their own; future ones follow settings). */
  specAt(k) {
    const s = this.specs.get(k);
    if (s) return s;
    const cfg = this.cfg;
    return { L: cfg.left, R: cfg.right };
  }

  isGap(k) {
    const g = this.cfg.gap;
    return !!(g.on && k >= 0 && mod(k, g.play + g.mute) >= g.play);
  }

  durFor(spec) {
    return cycleSeconds(this.cfg.tempoRef, this.bpm, spec.L, spec.R);
  }

  start(bpm) {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    const cfg = this.cfg;
    this.bpm = bpm;
    this.countIn = cfg.countIn;
    this.specs.clear();
    const spec = { L: cfg.left, R: cfg.right };
    const t0 = ctx.currentTime + 0.12;
    this.tl.reset(t0, -this.countIn, this.durFor(spec));
    this.startTime = t0;
    this.nextCycle = -this.countIn;
    this.list = null;
    this.cursor = 0;
    this.halted = false;
    this.finishAt = null;
    this.playing = true;
    this.positions = positions(cfg);
    this.timer.start();
    this.tick();
  }

  /** Stop immediately. `natural` keeps already-sounding notes ringing. */
  stop(natural = false) {
    if (!this.playing) return;
    this.playing = false;
    this.halted = false;
    this.finishAt = null;
    this.timer.stop();
    if (!natural) this.audio.cutTransport();
  }

  /** Change tempo now, keeping the musical position continuous. */
  setBpm(bpm) {
    this.bpm = bpm;
    if (!this.playing) return;
    const now = this.audio.ctx.currentTime;
    const k = Math.floor(this.tl.posAt(now));
    this.tl.change(now, this.durFor(this.specAt(k)));
  }

  /** Re-read the five-finger positions (called when key/octave changes during playback). */
  refreshPositions() { this.positions = positions(this.cfg); }

  tick() {
    if (!this.playing || this.halted) return;
    const horizon = this.audio.ctx.currentTime + AHEAD;
    for (let guard = 0; guard < 400; guard++) {
      if (!this.list && !this.beginCycle(this.nextCycle)) return;
      const item = this.list[this.cursor];
      const pos = this.nextCycle + item.phase;
      const t = this.tl.timeAt(pos);
      if (t > horizon) break;
      this.emit(item, pos, t);
      if (++this.cursor >= this.list.length) {
        this.list = null;
        this.cursor = 0;
        this.nextCycle++;
      }
    }
  }

  beginCycle(k) {
    const cfg = this.cfg;
    if (k >= 0) {
      const r = this.hooks.onCycle?.(k, this) || {};
      if (r.stop) {
        const t = this.tl.timeAt(k);
        this.emitFinal(k, t);
        this.finishAt = t + 1.2;
        this.halted = true;
        return false;
      }
      if (r.bpm) this.bpm = r.bpm;
    }
    const spec = { L: cfg.left, R: cfg.right };
    this.specs.set(k, spec);
    for (const key of this.specs.keys()) if (key < k - 6) this.specs.delete(key);
    const dur = this.durFor(spec);
    if (Math.abs(this.tl.durAtPos(k) - dur) > 1e-9) this.tl.changeAtPos(k, dur);
    this.list = this.buildList(k, spec, cfg);
    this.cursor = 0;
    return true;
  }

  buildList(k, { L, R }, cfg) {
    const items = [];
    if (k < 0) {
      const m = cfg.tempoRef === 'L' ? L : cfg.tempoRef === 'R' ? R : Math.max(L, R);
      for (let i = 0; i < m; i++) items.push({ kind: 'count', phase: i / m, i, m });
      return items;
    }
    for (let i = 0; i < L; i++) items.push({ kind: 'note', hand: 'L', i, n: L, phase: i / L });
    for (let i = 0; i < R; i++) items.push({ kind: 'note', hand: 'R', i, n: R, phase: i / R });
    items.push(...this.metroItems(k, { L, R }, cfg));
    // Stable sort by phase; metronome first so the click never lags a note.
    const order = { metro: 0, note: 1 };
    return items.sort((a, b) => a.phase - b.phase || order[a.kind] - order[b.kind]);
  }

  /**
   * Metronome clicks for cycle k: every enabled layer, merged so that clicks
   * landing on the same instant sound once at the strongest level.
   */
  metroItems(k, { L, R }, cfg = this.cfg) {
    const M = cfg.metro;
    if (!M.on || k < 0) return [];
    const lay = M.layers;
    const subOn = M.mode === 'sub';
    const sub = subOn ? M.sub : 1;
    const swingR = 0.5 + (M.swing / 100) * 0.25;
    // Offset of subdivision s inside one beat (0..1), with swing on the off-beats of even subdivisions.
    const subOff = (s) => (sub % 2 === 0 && s % 2 === 1 ? (s - 1 + swingR * 2) / sub : s / sub);
    const raw = [];
    const add = (phase, level, vol, layer) => { if (level !== 'mute' && vol > 0) raw.push({ kind: 'metro', phase, level, vol, layer }); };
    // A main click plus its subdivisions; `len` is the beat length in cycles.
    const beat = (p0, len, level, vol, layer) => {
      add(p0, level, vol, layer);
      for (let s = 1; s < sub; s++) {
        const p = p0 + subOff(s) * len;
        if (p < 1 - 1e-9) add(p, 'soft', vol * M.subVol, layer);
      }
    };
    if (lay.down.on) beat(0, 1, 'accent', lay.down.vol, 'down');
    if (lay.L.on) for (let i = 0; i < L; i++) beat(i / L, 1 / L, i === 0 ? 'accent' : 'normal', lay.L.vol, 'L');
    if (lay.R.on) for (let i = 0; i < R; i++) beat(i / R, 1 / R, i === 0 ? 'accent' : 'normal', lay.R.vol, 'R');
    if (lay.grid.on && subOn) {
      const g = lcm(L, R);
      for (let j = 0; j < g; j++) add(j / g, j === 0 ? 'normal' : 'soft', lay.grid.vol, 'grid');
    }
    if (lay.custom.on) {
      const inBar = mod(k, M.span);
      const LV = { A: 'accent', N: 'normal', S: 'soft', M: 'mute' };
      for (let b = 0; b < M.beats; b++) {
        const lv = M.pattern[b] || 'N';
        if (lv === 'M') continue;
        for (let s = 0; s < sub; s++) {
          const barPos = ((b + subOff(s)) / M.beats) * M.span;
          if (Math.floor(barPos + 1e-9) !== inBar) continue;
          const level = s === 0 ? LV[lv] : 'soft';
          add(barPos - inBar, level, lay.custom.vol * (s === 0 ? 1 : M.subVol), 'custom');
        }
      }
    }
    const rank = { accent: 3, normal: 2, soft: 1 };
    const merged = new Map();
    for (const it of raw) {
      const key = Math.round(it.phase * 1e6);
      const prev = merged.get(key);
      if (!prev) { merged.set(key, it); continue; }
      if (rank[it.level] > rank[prev.level] || (rank[it.level] === rank[prev.level] && it.vol > prev.vol)) {
        merged.set(key, { ...it, vol: Math.max(it.vol, prev.vol) });
      } else prev.vol = Math.max(prev.vol, it.vol);
    }
    return [...merged.values()].sort((a, b) => a.phase - b.phase);
  }

  emit(item, pos, t) {
    const cfg = this.cfg;
    const k = Math.floor(pos + 1e-9);
    if (item.kind === 'count') {
      this.audio.click(t, item.i === 0 ? 'accent' : 'normal', Math.max(0.35, cfg.metroVol), { sound: cfg.metro.sound });
      return;
    }
    if (item.kind === 'metro') {
      if (this.isGap(k) && !cfg.metro.gapKeep) return;
      if (cfg.metro.randomMute && item.phase > 0 && Math.random() * 100 < cfg.metro.randomMute) return;
      this.audio.click(t, item.level, cfg.metroVol * item.vol, { sound: cfg.metro.sound, layer: item.layer });
      return;
    }
    const { hand, i, n } = item;
    const dur = this.tl.durAtPos(pos);
    const note = noteAt(cfg, this.positions, hand, k, i, n);
    const muted = this.isGap(k);
    const gain = this.handGain(hand, cfg);
    if (!muted && gain > 0.001) {
      this.audio.play(t, note.midis, {
        hand, inst: cfg.instrument, gain,
        vel: i === 0 ? 0.84 : 0.7,
        dur: Math.min(1.6, (dur / n) * 0.92),
      });
    }
    const cue = cfg.cue;
    if (cue.on && !muted) {
      const mine = playsHand(cfg.playMode, hand);
      const want = cue.who === 'all' || (cue.who === 'mine' ? mine || cfg.playMode === 'listen' : !mine);
      if (want) this.audio.cue(t, hand, cue.vol, { sound: cue.sound, accent: i === 0 });
    }
    this.hooks.onNote?.({
      id: ++this.seq, hand, cycle: k, i, n, pos, time: t,
      interval: dur / n, fingers: note.fingers, midis: note.midis, muted,
    });
  }

  /**
   * How loud the app plays a hand. Listening: everything. Practicing: the hands you play only
   * at the guide volume (0 by default), the other hand only when accompaniment is on.
   */
  handGain(hand, cfg = this.cfg) {
    const vol = hand === 'L' ? cfg.lhVol : cfg.rhVol;
    if (cfg.playMode === 'listen') return vol;
    if (playsHand(cfg.playMode, hand)) return vol * cfg.guideVol;
    return cfg.accomp ? vol : 0;
  }

  /** Resolve on the next downbeat when a session ends. */
  emitFinal(k, t) {
    const cfg = this.cfg;
    for (const hand of ['L', 'R']) {
      const spec = this.specAt(k - 1);
      const note = noteAt(cfg, this.positions, hand, k, 0, hand === 'L' ? spec.L : spec.R);
      const gain = this.handGain(hand, cfg);
      if (gain <= 0.001) continue;
      this.audio.play(t, note.midis, { hand, inst: cfg.instrument, gain, vel: 0.8, dur: 1.4 });
    }
    if (cfg.metro.on) this.audio.click(t, 'accent', cfg.metroVol, { sound: cfg.metro.sound });
  }
}
