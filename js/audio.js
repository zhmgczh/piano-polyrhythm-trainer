// Web Audio engine: synthesized instruments, metronome, reverb and clock helpers.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Offline sample synthesis (modal / physical-ish models) ----------

/** Add exponentially decaying sine modes: [freq Hz, decay seconds, amplitude, start s]. */
function addModes(d, sr, modes) {
  for (const [f, tau, amp, start = 0] of modes) {
    const off = Math.floor(start * sr);
    const n = Math.min(d.length - off, Math.ceil(tau * sr * 7));
    const w = (2 * Math.PI * f) / sr;
    const k = 1 / (tau * sr);
    const ph = Math.random() * 0.4;
    for (let i = 0; i < n; i++) d[off + i] += amp * Math.exp(-i * k) * Math.sin(w * i + ph);
  }
}

/** Add a decaying noise burst, optionally band-passed (RBJ biquad). */
function addNoise(d, sr, { dur, amp, start = 0, bp = 0, q = 1, hp = false }) {
  const off = Math.floor(start * sr);
  const n = Math.min(d.length - off, Math.ceil(dur * sr * 6));
  const k = 1 / (dur * sr);
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  if (bp) {
    const w0 = (2 * Math.PI * bp) / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
    b0 = alpha / a0; b2 = -alpha / a0; a1 = (-2 * Math.cos(w0)) / a0; a2 = (1 - alpha) / a0;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let x = (Math.random() * 2 - 1) * Math.exp(-i * k);
    if (hp) { const hx = x - prev * 0.92; prev = x; x = hx; }
    const y = bp ? b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2 : x;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[off + i] += amp * y;
  }
}

const scaleModes = (modes, r) => modes.map(([f, ...rest]) => [f * r, ...rest]);

const MECH_TICK = [[1750, 0.010, 1], [2630, 0.007, 0.7], [3920, 0.005, 0.45], [5400, 0.003, 0.3], [820, 0.016, 0.35], [310, 0.02, 0.25]];
const MECH_BELL = [[2349, 0.55, 0.5], [4770, 0.32, 0.22], [6440, 0.22, 0.14], [9630, 0.12, 0.07]];
const WOOD = [[880, 0.028, 1], [2240, 0.012, 0.45], [3560, 0.006, 0.25], [6200, 0.002, 0.12]];
const CLAVES = [[2480, 0.07, 1], [6300, 0.012, 0.12]];
const COWBELL = [[562, 0.2, 0.8], [845, 0.17, 0.8], [1690, 0.07, 0.3], [2700, 0.04, 0.18], [3400, 0.025, 0.12]];
const STICK = [[420, 0.035, 0.7], [1650, 0.02, 0.8], [3100, 0.008, 0.4]];

/** Metronome sounds: [length s, renderer(d, sr, accent)] */
const METRO_SOUNDS = {
  mech: [0.8, (d, sr, acc) => {
    addNoise(d, sr, { dur: 0.0012, amp: 0.7, hp: true });
    addModes(d, sr, MECH_TICK);
    if (acc) addModes(d, sr, MECH_BELL.map(([f, t, a]) => [f, t, a, 0.001]));
  }],
  quartz: [0.06, (d, sr, acc) => {
    const f = acc ? 3150 : 2520, len = acc ? 0.022 : 0.014;
    const n = Math.floor(len * sr);
    for (let i = 0; i < n; i++) {
      const tt = i / sr, env = Math.min(1, i / (0.0008 * sr)) * Math.min(1, (n - i) / (0.002 * sr));
      d[i] += env * (Math.sin(2 * Math.PI * f * tt) + 0.25 * Math.sin(2 * Math.PI * 3 * f * tt));
    }
  }],
  wood: [0.2, (d, sr, acc) => {
    addNoise(d, sr, { dur: 0.002, amp: 0.4, hp: true });
    addModes(d, sr, scaleModes(WOOD, acc ? 1.24 : 1));
  }],
  claves: [0.35, (d, sr, acc) => {
    addNoise(d, sr, { dur: 0.0015, amp: 0.25, hp: true });
    addModes(d, sr, scaleModes(CLAVES, acc ? 1.12 : 1));
  }],
  cowbell: [0.9, (d, sr, acc) => {
    addNoise(d, sr, { dur: 0.003, amp: 0.3, bp: 3000, q: 1 });
    addModes(d, sr, scaleModes(COWBELL, acc ? 1.06 : 1));
  }],
  stick: [0.25, (d, sr, acc) => {
    addNoise(d, sr, { dur: 0.004, amp: 0.8, bp: 2600, q: 0.8 });
    addModes(d, sr, scaleModes(STICK, acc ? 1.1 : 1));
  }],
  beep: [0.07, (d, sr, acc) => {
    const f = acc ? 2000 : 1000, n = Math.floor(0.04 * sr);
    for (let i = 0; i < n; i++) {
      const tt = i / sr, env = Math.min(1, i / (0.001 * sr)) * Math.min(1, (n - i) / (0.003 * sr));
      let v = 0;
      for (let hm = 1; hm <= 7; hm += 2) v += Math.sin(2 * Math.PI * f * hm * tt) / hm;
      d[i] += env * v;
    }
  }],
  click: [0.08, (d, sr, acc) => {
    addModes(d, sr, [[acc ? 1720 : 1320, 0.012, 1]]);
    addNoise(d, sr, { dur: 0.0015, amp: 0.3, hp: true });
  }],
};

/** Ear-cue sounds (body percussion), rendered once. */
const CUE_SOUNDS = {
  tap: [0.2, (d, sr) => {
    addNoise(d, sr, { dur: 0.0025, amp: 0.5, bp: 1800, q: 0.7 });
    addModes(d, sr, [[190, 0.03, 1], [520, 0.015, 0.5], [1400, 0.006, 0.35]]);
  }],
  knock: [0.25, (d, sr) => {
    addNoise(d, sr, { dur: 0.002, amp: 0.4, bp: 2200, q: 0.8 });
    addModes(d, sr, [[115, 0.04, 0.9], [262, 0.03, 0.8], [640, 0.015, 0.5], [1500, 0.006, 0.3]]);
  }],
  clap: [0.3, (d, sr) => {
    for (const st of [0, 0.007, 0.014]) addNoise(d, sr, { dur: 0.0025, amp: 0.7, start: st, bp: 1150, q: 1.6 });
    addNoise(d, sr, { dur: 0.045, amp: 1, start: 0.021, bp: 1150, q: 1.2 });
  }],
  snap: [0.15, (d, sr) => {
    addNoise(d, sr, { dur: 0.004, amp: 0.9, bp: 3200, q: 1.1 });
    addModes(d, sr, [[2100, 0.012, 0.6], [3300, 0.008, 0.4]]);
  }],
};

export const METRO_SOUND_IDS = Object.keys(METRO_SOUNDS);
export const CUE_SOUND_IDS = Object.keys(CUE_SOUNDS);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.opts = { master: 0.8, reverb: 0.22, stereo: true, cuePan: 1 };
    this.samples = new Map();
  }

  /** Create the audio graph (must be called from a user gesture the first time). */
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    // `duck` silences everything except the spoken chant while a chant plays.
    this.duck = ctx.createGain();
    this.out.connect(this.duck).connect(this.comp).connect(ctx.destination);
    this.voiceOut = ctx.createGain();
    this.voiceOut.connect(ctx.destination);
    this.voices = new Set();

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.8);
    this.reverb.connect(this.out);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.waves = {
      piano: this.makeWave((n) => (0.35 + Math.abs(Math.sin(Math.PI * n / 7.5))) / Math.pow(n, 1.25), 28),
      bright: this.makeWave((n) => 1 / Math.pow(n, 1.6), 16),
    };

    this.bus = this.makeBus();
    this.inputBus = this.makeBus();
    this.apply(this.opts);
    return ctx;
  }

  async resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state !== 'running') {
      try { await ctx.resume(); } catch { /* ignored */ }
    }
    return ctx;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Context time of the sound that is reaching the speakers right now. */
  heardTime() {
    const ctx = this.ctx;
    if (!ctx) return 0;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        // Guard against stale timestamps (e.g. after a suspend).
        if (Math.abs(t - ctx.currentTime) < 0.5) return t;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** Convert a performance.now()-based event timestamp to "heard" context time. */
  perfToCtx(perfMs) {
    return this.heardTime() - (performance.now() - perfMs) / 1000;
  }

  makeWave(amp, count) {
    const real = new Float32Array(count + 1);
    const imag = new Float32Array(count + 1);
    for (let n = 1; n <= count; n++) imag[n] = amp(n);
    return this.ctx.createPeriodicWave(real, imag);
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const x = (i - pre) / (len - pre);
        const white = Math.random() * 2 - 1;
        const k = 0.55 - 0.45 * x;            // darker tail
        lp += (white - lp) * k;
        d[i] = lp * Math.pow(1 - x, decay) * (x < 0.004 ? x / 0.004 : 1);
      }
    }
    return buf;
  }

  makeBus() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const send = ctx.createGain();
    out.connect(this.out);
    out.connect(send);
    send.connect(this.reverb);
    const mkPan = () => {
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.connect(out); return p; }
      const g = ctx.createGain(); g.connect(out); return g;
    };
    const bus = { out, send, L: mkPan(), R: mkPan(), CL: mkPan(), CR: mkPan(), C: ctx.createGain() };
    bus.C.connect(out);
    this.configureBus(bus);
    return bus;
  }

  configureBus(bus) {
    const { stereo, reverb } = this.opts;
    if (bus.L.pan) bus.L.pan.value = stereo ? -0.45 : 0;
    if (bus.R.pan) bus.R.pan.value = stereo ? 0.45 : 0;
    if (bus.CL.pan) bus.CL.pan.value = -this.opts.cuePan;
    if (bus.CR.pan) bus.CR.pan.value = this.opts.cuePan;
    bus.send.gain.value = reverb * 0.55;
  }

  apply(opts) {
    Object.assign(this.opts, opts);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(Math.pow(this.opts.master, 1.6) * 0.9, t, 0.02);
    this.voiceOut.gain.setTargetAtTime(Math.pow(this.opts.master, 1.6), t, 0.02);
    this.configureBus(this.bus);
    this.configureBus(this.inputBus);
  }

  /** Silence everything scheduled on the transport bus (used on stop). */
  cutTransport() {
    if (!this.ctx) return;
    const old = this.bus;
    const t = this.ctx.currentTime;
    old.out.gain.cancelScheduledValues(t);
    old.out.gain.setValueAtTime(old.out.gain.value, t);
    old.out.gain.linearRampToValueAtTime(0, t + 0.06);
    setTimeout(() => { try { old.out.disconnect(); old.send.disconnect(); } catch { /* ignore */ } }, 400);
    this.bus = this.makeBus();
  }

  /** Mute (or restore) every sound except the spoken chant. */
  solo(on) {
    if (!this.ctx) return;
    this.duck.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.015);
  }

  /** Play one chant syllable; it fades out early if it would run past `maxDur` seconds. */
  voice(time, buf, vol, maxDur = Infinity) {
    const ctx = this.ctx;
    if (!ctx || vol <= 0) return;
    let t = time, offset = 0;
    if (t < ctx.currentTime) { offset = ctx.currentTime - t; t = ctx.currentTime; }
    const len = Math.min(buf.duration - offset, maxDur - offset);
    if (len <= 0.02) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (len < buf.duration - offset) {
      g.gain.setValueAtTime(vol, t + len - 0.015);
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    src.connect(g).connect(this.voiceOut);
    src.start(t, offset);
    src.stop(t + len + 0.005);
    this.voices.add(src);
    src.onended = () => { this.voices.delete(src); g.disconnect(); };
  }

  /** Stop every chant syllable that is playing or scheduled. */
  cutVoice() {
    for (const src of this.voices) { try { src.stop(); } catch { /* already stopped */ } }
    this.voices.clear();
  }

  dest(hand, input) {
    const bus = input ? this.inputBus : this.bus;
    return hand === 'L' ? bus.L : hand === 'R' ? bus.R : bus.C;
  }

  /**
   * Play one or more MIDI notes.
   * opts: { hand, vel 0..1, dur seconds, inst, gain, input }
   */
  play(time, midis, opts = {}) {
    if (!this.ctx) return;
    const { hand = 'C', vel = 0.75, dur = 0.5, inst = 'piano', gain = 1, input = false } = opts;
    const dest = this.dest(hand, input);
    const t = Math.max(time, this.ctx.currentTime);
    const list = Array.isArray(midis) ? midis : [midis];
    const chordScale = 1 / Math.sqrt(list.length);
    for (const m of list) {
      const g = gain * chordScale;
      if (g <= 0.0005) continue;
      switch (inst) {
        case 'epiano': this.epiano(t, m, vel, dur, g, dest); break;
        case 'marimba': this.marimba(t, m, vel, g, dest); break;
        case 'woodblock': this.woodblock(t, hand, vel, g, dest); break;
        default: this.piano(t, m, vel, dur, g, dest);
      }
      if (inst === 'woodblock') break;
    }
  }

  piano(t, midi, vel, dur, gain, dest) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const peak = 0.34 * vel * gain;
    const decay = clamp(6 - (midi - 36) * 0.08, 0.9, 6);
    const hold = clamp(dur, 0.08, 4);
    const rel = 0.12 + Math.max(0, 64 - midi) * 0.004;
    const end = t + hold;
    const stop = end + rel * 6;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(peak * 0.42, t + 0.003, 0.07);
    amp.gain.setTargetAtTime(0.0001, t + 0.09, decay / 3.2);
    amp.gain.setTargetAtTime(0.0001, end, rel);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(Math.min(17000, f * (4 + vel * 10)), t);
    lp.frequency.setTargetAtTime(Math.max(f * 2.4, 600), t + 0.01, 0.28 + decay * 0.06);

    const o1 = ctx.createOscillator();
    o1.setPeriodicWave(this.waves.piano);
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.setPeriodicWave(this.waves.piano);
    o2.frequency.value = f;
    o2.detune.value = 2.5 + (midi % 3) * 0.6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = f * 2.003;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.12, t);
    g3.gain.setTargetAtTime(0, t, 0.25);

    o1.connect(lp);
    o2.connect(g2).connect(lp);
    o3.connect(g3).connect(lp);
    lp.connect(amp).connect(dest);

    // Hammer
    const hn = ctx.createBufferSource();
    hn.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(6000, f * 5 + 800);
    bp.Q.value = 1.4;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.05 * vel * gain, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    hn.connect(bp).connect(hg).connect(dest);

    for (const o of [o1, o2, o3]) { o.start(t); o.stop(stop); }
    hn.start(t, Math.random() * 0.5, 0.05);
    o1.onended = () => { amp.disconnect(); };
  }

  epiano(t, midi, vel, dur, gain, dest) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const peak = 0.3 * vel * gain;
    const decay = clamp(3.4 - (midi - 48) * 0.035, 0.8, 3.6);
    const end = t + clamp(dur, 0.08, 4);
    const stop = end + 0.6;

    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = f;
    const modo = ctx.createOscillator();
    modo.type = 'sine';
    modo.frequency.value = f;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * (1.2 + vel * 1.6), t);
    idx.gain.setTargetAtTime(f * 0.25, t, 0.18);
    modo.connect(idx).connect(car.frequency);

    const tine = ctx.createOscillator();
    tine.type = 'sine';
    tine.frequency.value = f * 7.02;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.09 * vel, t);
    tg.gain.setTargetAtTime(0, t, 0.03);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setTargetAtTime(0.0001, t + 0.004, decay / 3);
    amp.gain.setTargetAtTime(0.0001, end, 0.1);

    car.connect(amp);
    tine.connect(tg).connect(amp);
    amp.connect(dest);
    for (const o of [car, modo, tine]) { o.start(t); o.stop(stop); }
    car.onended = () => amp.disconnect();
  }

  marimba(t, midi, vel, gain, dest) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const tau = clamp(0.32 - (midi - 48) * 0.004, 0.08, 0.4);
    const peak = 0.42 * vel * gain;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.002);
    amp.gain.setTargetAtTime(0.0001, t + 0.002, tau);
    amp.connect(dest);
    const parts = [[1, 1, tau], [3.93, 0.28, tau * 0.25], [9.8, 0.08, tau * 0.08]];
    for (const [ratio, level, tt] of parts) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.setTargetAtTime(0, t, tt);
      o.connect(g).connect(amp);
      o.start(t);
      o.stop(t + tau * 7 + 0.05);
      if (ratio === 1) o.onended = () => amp.disconnect();
    }
  }

  woodblock(t, hand, vel, gain, dest) {
    const ctx = this.ctx;
    const base = hand === 'L' ? 520 : hand === 'R' ? 930 : 720;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.012);
    const g = ctx.createGain();
    const peak = 0.55 * vel * gain;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.1);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 2.6;
    bp.Q.value = 4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(peak * 0.7, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    n.connect(bp).connect(ng).connect(dest);
    n.start(t, Math.random() * 0.5, 0.03);
    o.onended = () => g.disconnect();
  }

  /** Render (once) and cache a percussion sample. */
  sample(table, id, accent = false) {
    const key = `${table === METRO_SOUNDS ? 'm' : 'c'}:${id}:${accent ? 1 : 0}`;
    let buf = this.samples.get(key);
    if (buf) return buf;
    const [len, render] = table[id] || Object.values(table)[0];
    const sr = this.ctx.sampleRate;
    buf = this.ctx.createBuffer(1, Math.ceil(len * sr), sr);
    const d = buf.getChannelData(0);
    render(d, sr, accent);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak ? 0.95 / peak : 1;
    for (let i = 0; i < d.length; i++) d[i] *= g;
    // Short fade-out so the tail never clicks.
    const fade = Math.min(d.length, Math.floor(0.004 * sr));
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
    this.samples.set(key, buf);
    return buf;
  }

  playSample(t, buf, gain, rate, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(t);
    src.onended = () => g.disconnect();
  }

  /**
   * Metronome click.
   * level: 'accent' | 'normal' | 'soft'; opts: { sound, layer } — each layer gets its own pitch.
   */
  click(time, level = 'normal', vol = 0.5, opts = {}) {
    if (!this.ctx || vol <= 0) return;
    const t = Math.max(time, this.ctx.currentTime);
    // Every beat must stay clearly audible; accents are louder, not the only thing you hear.
    const lv = level === 'accent' ? 1 : level === 'soft' ? 0.55 : 0.8;
    // Subdivision clicks get their own pitch: left grouping lower, right grouping higher.
    const rate = { L: 0.84, R: 1.19, grid: 1.33, n: 1.12 }[opts.layer] || 1;
    const buf = this.sample(METRO_SOUNDS, opts.sound || 'mech', level === 'accent');
    this.playSample(t, buf, Math.min(1.2, lv * Math.pow(vol, 1.2) * 1.1), rate, this.bus.C);
  }

  /** Ear cue: a body-percussion tap in the left ear (left hand) or right ear (right hand). */
  cue(time, hand, vol = 0.6, opts = {}) {
    if (!this.ctx || vol <= 0) return;
    const t = Math.max(time, this.ctx.currentTime);
    const buf = this.sample(CUE_SOUNDS, opts.sound || 'tap');
    const bus = opts.input ? this.inputBus : this.bus;
    const rate = hand === 'L' ? 0.9 : 1.1;
    this.playSample(t, buf, (opts.accent ? 1 : 0.72) * vol * vol, rate, hand === 'L' ? bus.CL : bus.CR);
  }
}
