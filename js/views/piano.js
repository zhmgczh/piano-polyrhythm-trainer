// Piano keyboard with two stylized hands resting on their five-finger positions.

import { clamp, lerp, rgba, mix, roundRect, keyboardLayout, fitCanvas } from './draw.js';
import { noteName, usesFlats } from '../rhythm.js';
import { FINGER_KEY_LABEL } from '../input.js';

const FINGER_W = { 1: 0.56, 2: 0.5, 3: 0.52, 4: 0.48, 5: 0.42 };
const TIP_DY = { 1: 0.12, 2: 0, 3: -0.05, 4: 0, 5: 0.1 };
const KNUCKLE_DY = { 2: 0.06, 3: 0, 4: 0.07, 5: 0.22 };

export class PianoView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.kb = null;
    this.dims = null;
    this.handImg = { L: null, R: null };
    this.cacheKey = '';
  }

  /** Compute layout for a CSS width; returns the CSS height the canvas should have. */
  layout(width, range) {
    const kb = keyboardLayout(width, range.lo, range.hi, 10);
    const ww = kb.ww;
    const keyTop = 3;
    const keyH = clamp(ww * 3.3, 84, 178);
    const blackH = keyH * 0.62;
    const tipY = keyTop + keyH * 0.86;
    const height = Math.round(tipY + clamp(ww * 2.45, 44, 150));
    this.kb = kb;
    this.dims = { keyTop, keyH, blackH, tipY, height, ww };
    return height;
  }

  /** Geometry of one hand in CSS px. */
  handGeometry(hand, posMap) {
    const { kb, dims } = this;
    const ww = kb.ww;
    const sgn = hand === 'R' ? -1 : 1;     // direction toward the thumb
    const tips = {};
    for (let f = 1; f <= 5; f++) {
      const key = kb.keys.get(posMap[hand][f]);
      if (!key) return null;
      const y = key.black ? dims.keyTop + dims.blackH * 0.72 : dims.tipY + TIP_DY[f] * ww;
      tips[f] = { x: key.cx, y, black: key.black };
    }
    const baseY = dims.tipY + ww * 1.18;
    let hc = 0;
    for (let f = 2; f <= 5; f++) hc += tips[f].x / 4;
    const kn = {};
    for (let f = 2; f <= 5; f++) kn[f] = { x: hc + (tips[f].x - hc) * 0.84, y: baseY + KNUCKLE_DY[f] * ww };
    const k1 = { x: lerp(tips[1].x, kn[2].x, 0.35) + sgn * 0.22 * ww, y: kn[2].y + 0.55 * ww };
    const c1 = { x: kn[2].x - sgn * 0.12 * ww, y: kn[2].y + 1.5 * ww };
    return { hand, sgn, tips, kn, k1, c1, ww, baseY, bottom: dims.height + 12 };
  }

  palmPath(c, g, grow) {
    const { kn, k1, c1, sgn, ww, bottom } = g;
    const o = grow;
    const pts = [
      { x: kn[2].x + sgn * (0.3 * ww + o), y: kn[2].y + 0.04 * ww },
      { x: kn[2].x, y: kn[2].y - 0.2 * ww - o },
      { x: kn[3].x, y: kn[3].y - 0.22 * ww - o },
      { x: kn[4].x, y: kn[4].y - 0.2 * ww - o },
      { x: kn[5].x, y: kn[5].y - 0.17 * ww - o },
      { x: kn[5].x - sgn * (0.25 * ww + o), y: kn[5].y + 0.12 * ww },
      { x: kn[5].x - sgn * (0.34 * ww + o), y: kn[5].y + 1.25 * ww },
      { x: kn[5].x - sgn * (0.3 * ww + o), y: bottom },
      { x: c1.x + sgn * (0.5 * ww + o), y: bottom },
      { x: c1.x + sgn * (0.42 * ww + o), y: c1.y },
      { x: k1.x + sgn * (0.12 * ww + o), y: k1.y + 0.2 * ww },
    ];
    c.beginPath();
    const n = pts.length;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = mid(pts[n - 1], pts[0]);
    c.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = mid(p, pts[(i + 1) % n]);
      c.quadraticCurveTo(p.x, p.y, q.x, q.y);
    }
    c.closePath();
  }

  fingerStroke(c, g, f, tip) {
    c.beginPath();
    if (f === 1) {
      c.moveTo(g.c1.x, g.c1.y);
      c.lineTo(g.k1.x, g.k1.y);
      c.lineTo(tip.x, tip.y);
    } else {
      c.moveTo(g.kn[f].x, g.kn[f].y);
      c.lineTo(tip.x, tip.y);
    }
  }

  /** Render the static silhouette of a hand into an offscreen canvas. */
  renderHand(g, pal, w, h, dpr) {
    const oc = document.createElement('canvas');
    oc.width = Math.round(w * dpr);
    oc.height = Math.round(h * dpr);
    const c = oc.getContext('2d');
    c.scale(dpr, dpr);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const base = pal[g.hand];
    const fill = mix(base, pal.stage, pal.handMix);
    const edge = mix(base, pal.stage, pal.dark ? 0.25 : 0.1);
    const ww = g.ww;
    const ol = Math.max(1.4, ww * 0.045);

    const shapes = (grow) => {
      this.palmPath(c, g, grow);
      c.fill();
      for (let f = 1; f <= 5; f++) {
        c.lineWidth = FINGER_W[f] * ww + grow * 2;
        this.fingerStroke(c, g, f, g.tips[f]);
        c.stroke();
      }
    };
    c.fillStyle = c.strokeStyle = edge;
    shapes(ol);
    c.fillStyle = c.strokeStyle = fill;
    shapes(0);

    // Soft light from the fingertips.
    c.globalCompositeOperation = 'source-atop';
    const lg = c.createLinearGradient(0, g.tips[3].y - ww, 0, g.baseY + ww);
    lg.addColorStop(0, rgba('#ffffff', pal.dark ? 0.16 : 0.35));
    lg.addColorStop(1, rgba('#ffffff', 0));
    c.fillStyle = lg;
    c.fillRect(0, 0, w, h);

    // Knuckle creases.
    c.strokeStyle = rgba(edge, 0.5);
    c.lineWidth = Math.max(1, ww * 0.03);
    for (let f = 2; f <= 5; f++) {
      const k = g.kn[f], t = g.tips[f];
      const mx = lerp(k.x, t.x, 0.45), my = lerp(k.y, t.y, 0.45);
      const hw = FINGER_W[f] * ww * 0.28;
      c.beginPath();
      c.moveTo(mx - hw, my + 1);
      c.quadraticCurveTo(mx, my - 2, mx + hw, my + 1);
      c.stroke();
    }

    // Nails.
    for (let f = 1; f <= 5; f++) {
      const t = g.tips[f];
      const from = f === 1 ? g.k1 : g.kn[f];
      const ang = Math.atan2(t.y - from.y, t.x - from.x);
      const nx = t.x - Math.cos(ang) * ww * 0.08, ny = t.y - Math.sin(ang) * ww * 0.08;
      c.save();
      c.translate(nx, ny);
      c.rotate(ang + Math.PI / 2);
      c.fillStyle = rgba('#ffffff', pal.dark ? 0.13 : 0.5);
      c.beginPath();
      c.ellipse(0, 0, FINGER_W[f] * ww * 0.3, FINGER_W[f] * ww * 0.36, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Fade the palm out toward the wrist.
    c.globalCompositeOperation = 'destination-in';
    const fg = c.createLinearGradient(0, g.baseY, 0, h);
    fg.addColorStop(0, 'rgba(0,0,0,1)');
    fg.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = fg;
    c.fillRect(0, 0, w, h);
    return oc;
  }

  hitTest(x, y) {
    if (!this.kb) return null;
    const { keyTop, blackH } = this.dims;
    if (y >= keyTop && y <= keyTop + blackH) {
      for (const k of this.kb.keys.values()) if (k.black && x >= k.x && x <= k.x + k.w) return k.midi;
    }
    for (const m of this.kb.whites) {
      const k = this.kb.keys.get(m);
      if (x >= k.x && x < k.x + k.w) return m;
    }
    return null;
  }

  draw(fr) {
    const { canvas, ctx } = this;
    const { w, h, dpr } = fitCanvas(canvas);
    if (!this.kb) return;
    const pal = fr.pal;
    const { keyTop, keyH, blackH } = this.dims;
    const ww = this.kb.ww;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const flats = usesFlats(fr.cfg);
    const posKeys = new Map();
    for (const hand of ['L', 'R']) for (let f = 1; f <= 5; f++) posKeys.set(fr.posMap[hand][f], { hand, f });

    const keyState = (m) => {
      const a = fr.active.get(m);
      const p = fr.pressed.get(m);
      return { a, p };
    };

    // Shadow under the keyboard.
    ctx.fillStyle = rgba('#000000', pal.dark ? 0.35 : 0.08);
    roundRect(ctx, this.kb.padX - 2, keyTop - 2, w - this.kb.padX * 2 + 4, keyH + 5, 8);
    ctx.fill();

    // White keys
    for (const m of this.kb.whites) {
      const k = this.kb.keys.get(m);
      const { a, p } = keyState(m);
      const x = k.x + 0.5, kw = k.w - 1;
      const down = p && p.down;
      const hgt = keyH - (down ? 2 : 0);
      const g = ctx.createLinearGradient(0, keyTop, 0, keyTop + hgt);
      g.addColorStop(0, pal.keyWhite);
      g.addColorStop(0.85, pal.keyWhite);
      g.addColorStop(1, pal.keyWhite2);
      ctx.fillStyle = g;
      roundRect(ctx, x, keyTop, kw, hgt, Math.min(6, kw * 0.14));
      ctx.fill();
      if (a && a.s > 0.01) {
        const c = pal[a.hand];
        const ag = ctx.createLinearGradient(0, keyTop, 0, keyTop + hgt);
        ag.addColorStop(0, rgba(c, 0.25 * a.s));
        ag.addColorStop(1, rgba(c, 0.95 * a.s));
        ctx.fillStyle = ag;
        roundRect(ctx, x, keyTop, kw, hgt, Math.min(6, kw * 0.14));
        ctx.fill();
      }
      if (p && p.s > 0.01) {
        ctx.fillStyle = rgba(pal[p.hand] || pal.accent, 0.35 * p.s);
        roundRect(ctx, x, keyTop, kw, hgt, Math.min(6, kw * 0.14));
        ctx.fill();
        ctx.strokeStyle = rgba(pal[p.hand] || pal.accent, 0.9 * p.s);
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1.5, keyTop + 1.5, kw - 3, hgt - 3, Math.min(5, kw * 0.12));
        ctx.stroke();
      }
      ctx.fillStyle = rgba('#000000', 0.16);
      ctx.fillRect(k.x + k.w - 0.5, keyTop, 1, keyH - 4);
      const pk = posKeys.get(m);
      if (pk) {
        ctx.fillStyle = rgba(pal[pk.hand], 0.85);
        roundRect(ctx, x + kw * 0.18, keyTop + 3, kw * 0.64, 3, 1.5);
        ctx.fill();
      }
    }

    // Black keys
    for (const k of this.kb.keys.values()) {
      if (!k.black) continue;
      const { a, p } = keyState(k.midi);
      const down = p && p.down;
      const bh = blackH - (down ? 2 : 0);
      ctx.fillStyle = rgba('#000000', 0.35);
      roundRect(ctx, k.x + 1, keyTop + 1, k.w, bh + 2, 3);
      ctx.fill();
      const g = ctx.createLinearGradient(0, keyTop, 0, keyTop + bh);
      g.addColorStop(0, pal.keyBlack);
      g.addColorStop(0.9, pal.keyBlack2);
      g.addColorStop(1, pal.keyBlack);
      ctx.fillStyle = g;
      roundRect(ctx, k.x, keyTop, k.w, bh, Math.min(4, k.w * 0.15));
      ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.08);
      roundRect(ctx, k.x + k.w * 0.18, keyTop + 2, k.w * 0.64, bh * 0.82, 2);
      ctx.fill();
      if (a && a.s > 0.01) {
        ctx.fillStyle = rgba(pal[a.hand], 0.92 * a.s);
        roundRect(ctx, k.x, keyTop, k.w, bh, Math.min(4, k.w * 0.15));
        ctx.fill();
      }
      if (p && p.s > 0.01) {
        ctx.strokeStyle = rgba(pal[p.hand] || pal.accent, 0.95 * p.s);
        ctx.lineWidth = 2;
        roundRect(ctx, k.x + 1, keyTop + 1, k.w - 2, bh - 2, 3);
        ctx.stroke();
      }
      const pk = posKeys.get(k.midi);
      if (pk) {
        ctx.fillStyle = rgba(pal[pk.hand], 0.95);
        roundRect(ctx, k.x + k.w * 0.2, keyTop + 3, k.w * 0.6, 3, 1.5);
        ctx.fill();
      }
    }

    // Labels
    const small = keyH < 120;
    const fs = clamp(ww * 0.24, 8.5, 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of this.kb.keys.values()) {
      const pk = posKeys.get(k.midi);
      const isC = ((k.midi % 12) + 12) % 12 === 0;
      if (!pk && !isC) continue;
      const name = noteName(k.midi, flats, fr.cfg.noteNames, isC || !pk);
      const cap = pk && fr.cfg.keyLabels ? FINGER_KEY_LABEL[pk.hand][pk.f] : null;
      if (k.black) {
        if (!pk) continue;
        const y = keyTop + blackH * (cap ? 0.36 : 0.5);
        ctx.font = `600 ${fs * 0.92}px ${pal.fontUi}`;
        ctx.fillStyle = rgba('#ffffff', 0.75);
        if (cap) ctx.fillText(cap, k.cx, y);
        if (!small || !cap) { ctx.font = `500 ${fs * 0.8}px ${pal.fontUi}`; ctx.fillStyle = rgba('#ffffff', 0.5); ctx.fillText(name, k.cx, keyTop + blackH * (cap ? 0.56 : 0.5)); }
        continue;
      }
      const yCap = keyTop + keyH * 0.665, yName = keyTop + keyH * (cap && !small ? 0.765 : 0.7);
      if (cap) {
        const bw = Math.min(k.w * 0.62, fs * 2), bh = fs * 1.5;
        ctx.fillStyle = rgba(pal[pk.hand], 0.16);
        ctx.strokeStyle = rgba(pal[pk.hand], 0.6);
        ctx.lineWidth = 1;
        roundRect(ctx, k.cx - bw / 2, yCap - bh / 2, bw, bh, 4);
        ctx.fill();
        ctx.stroke();
        ctx.font = `700 ${fs}px ${pal.fontUi}`;
        ctx.fillStyle = mix(pal[pk.hand], '#000000', 0.35);
        ctx.fillText(cap, k.cx, yCap + 0.5);
      }
      if (!cap || !small) {
        ctx.font = `${isC ? 600 : 500} ${fs * 0.88}px ${pal.fontUi}`;
        ctx.fillStyle = rgba('#3a3530', isC ? 0.75 : 0.55);
        ctx.fillText(name, k.cx, yName);
      }
    }

    // Hands
    const key = [w, h, dpr, pal.L, pal.R, pal.stage, ...fr.posMap.L, ...fr.posMap.R, this.kb.lo, this.kb.hi].join(',');
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.geo = { L: this.handGeometry('L', fr.posMap), R: this.handGeometry('R', fr.posMap) };
      for (const hand of ['L', 'R']) this.handImg[hand] = this.geo[hand] ? this.renderHand(this.geo[hand], pal, w, h, dpr) : null;
    }
    for (const hand of ['L', 'R']) {
      const g = this.geo[hand];
      if (!g || !this.handImg[hand]) continue;
      const engaged = fr.handEngaged[hand];
      ctx.globalAlpha = engaged ? 0.94 : 0.55;
      ctx.drawImage(this.handImg[hand], 0, 0, w, h);
      ctx.globalAlpha = 1;
      this.drawFingers(ctx, g, fr, hand);
    }
  }

  drawFingers(ctx, g, fr, hand) {
    const pal = fr.pal;
    const color = pal[hand];
    const ww = g.ww;
    const glow = !fr.reduce;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const next = fr.next[hand];
    for (let f = 1; f <= 5; f++) {
      const s = Math.max(fr.fingerOn[hand].get(f) || 0, fr.fingerPressed[hand].get(f) || 0);
      const t0 = g.tips[f];
      const from = f === 1 ? g.k1 : g.kn[f];
      const len = Math.hypot(t0.x - from.x, t0.y - from.y) || 1;
      const press = s * 0.12 * ww;
      const tip = { x: t0.x + (from.x - t0.x) / len * press, y: t0.y + (from.y - t0.y) / len * press + s * 1.5 };
      if (s > 0.01) {
        ctx.save();
        if (glow) { ctx.shadowColor = rgba(color, 0.9); ctx.shadowBlur = 22 * s; }
        const lg = ctx.createLinearGradient(from.x, from.y, tip.x, tip.y);
        lg.addColorStop(0, rgba(color, 0.15 * s));
        lg.addColorStop(1, rgba(mix(color, '#ffffff', 0.25), 0.95 * s));
        ctx.strokeStyle = lg;
        ctx.lineWidth = FINGER_W[f] * ww * 1.04;
        this.fingerStroke(ctx, g, f, tip);
        ctx.stroke();
        ctx.restore();
      }
      // Anticipation ring for the next finger.
      if (next && next.fingers.includes(f) && fr.handEngaged[hand]) {
        const a = clamp(1 - next.eta / 0.6, 0, 1);
        if (a > 0.02) {
          const r = FINGER_W[f] * ww * (0.62 + (1 - a) * 0.5);
          ctx.strokeStyle = rgba(color, 0.85 * a);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (fr.cfg.showFingers) {
        const r = clamp(ww * 0.19, 6.5, 11);
        ctx.beginPath();
        ctx.arc(tip.x, tip.y - r * 0.15, r, 0, Math.PI * 2);
        ctx.fillStyle = s > 0.2 ? mix(color, '#ffffff', 0.15) : rgba(pal.stage, 0.72);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(color, s > 0.2 ? 1 : 0.55);
        ctx.stroke();
        ctx.fillStyle = s > 0.2 ? '#10131f' : pal.text;
        ctx.font = `700 ${r * 1.15}px ${pal.fontUi}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(f), tip.x, tip.y - r * 0.15 + 0.5);
      }
    }
  }
}
