// Falling-notes view, aligned key-for-key with the piano below it.

import { clamp, rgba, mix, fitCanvas, roundRect, judgeColor, TAU, easeOut } from './draw.js';
import { lcm } from '../rhythm.js';

export class FallingView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(fr) {
    const { ctx } = this;
    const { w, h, dpr } = fitCanvas(this.canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const kb = fr.kb;
    if (!kb) return;
    const pal = fr.pal;
    const sx = w / kb.width;
    const visible = fr.cfg.fallZoom;
    const hitY = h - 3;
    const ppc = (h - 70) / visible;      // pixels per cycle
    const pos = fr.pos;
    const yOf = (p) => hitY - (p - pos) * ppc;
    const keyX = (m) => {
      const k = kb.keys.get(m);
      if (!k) return null;
      const pad = k.black ? 1 : Math.max(2, k.w * 0.1);
      return { x: (k.x + pad) * sx, w: (k.w - pad * 2) * sx, cx: k.cx * sx, black: k.black };
    };

    // Lanes for the ten position keys
    for (const hand of ['L', 'R']) {
      for (let f = 1; f <= 5; f++) {
        const kx = keyX(fr.posMap[hand][f]);
        if (!kx) continue;
        const lg = ctx.createLinearGradient(0, 0, 0, h);
        lg.addColorStop(0, rgba(pal[hand], 0));
        lg.addColorStop(1, rgba(pal[hand], fr.handEngaged[hand] ? 0.1 : 0.05));
        ctx.fillStyle = lg;
        ctx.fillRect(kx.x, 0, kx.w, h);
      }
    }

    // Cycle and grid lines
    const k0 = Math.floor(pos), k1 = Math.floor(pos + visible) + 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const spec = fr.spec(k);
      const g = lcm(spec.L, spec.R);
      for (let j = 0; j < g; j++) {
        const y = yOf(k + j / g);
        if (y < 0 || y > hitY) continue;
        ctx.strokeStyle = rgba(pal.text3, j === 0 ? 0.45 : 0.1);
        ctx.lineWidth = j === 0 ? 1.5 : 1;
        if (j !== 0) ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (j === 0) {
          ctx.font = `600 11px ${pal.fontUi}`;
          ctx.fillStyle = pal.text3;
          ctx.fillText(String(k + 1), w - 8, y - 3);
        }
      }
    }

    // Notes
    const glow = !fr.reduce;
    for (const hand of ['L', 'R']) {
      const c = pal[hand];
      const engaged = fr.handEngaged[hand];
      for (let k = Math.max(0, k0 - 1); k <= k1; k++) {
        const spec = fr.spec(k);
        const n = hand === 'L' ? spec.L : spec.R;
        const gap = fr.isGap(k);
        for (let i = 0; i < n; i++) {
          const p = k + i / n;
          const len = 0.82 / n;
          const yB = yOf(p), yT = yOf(p + len);
          if (yT > hitY || yB < -10) continue;
          const sounding = fr.playing && yB >= hitY;
          const bottom = Math.min(yB, hitY);
          const note = fr.note(hand, k, i, n);
          for (let ci = 0; ci < note.midis.length; ci++) {
            const kx = keyX(note.midis[ci]);
            if (!kx) continue;
            const hh = bottom - yT;
            if (hh < 1) continue;
            ctx.save();
            if (sounding && glow) { ctx.shadowColor = c; ctx.shadowBlur = 24; }
            const lg = ctx.createLinearGradient(0, yT, 0, bottom);
            const a = (engaged ? 1 : 0.55) * (gap ? 0.35 : 1);
            lg.addColorStop(0, rgba(mix(c, '#ffffff', sounding ? 0.35 : 0.12), a));
            lg.addColorStop(1, rgba(sounding ? mix(c, '#ffffff', 0.15) : c, a));
            ctx.fillStyle = lg;
            roundRect(ctx, kx.x, yT, kx.w, hh, Math.min(8, kx.w * 0.3));
            if (gap) {
              ctx.strokeStyle = rgba(c, 0.8);
              ctx.lineWidth = 1.5;
              ctx.stroke();
            } else ctx.fill();
            ctx.restore();
            // Highlight edge
            ctx.fillStyle = rgba('#ffffff', 0.35 * a);
            roundRect(ctx, kx.x + 2, yT + 2, Math.max(1, kx.w - 4), Math.min(3, hh - 2), 2);
            ctx.fill();
            if (fr.cfg.showFingers && hh > 16 && kx.w > 12) {
              const f = note.fingers[ci];
              const fs = clamp(kx.w * 0.5, 9, 16);
              ctx.font = `700 ${fs}px ${pal.fontUi}`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = gap ? c : '#0d1020';
              ctx.fillText(String(f), kx.cx, bottom - Math.min(hh / 2, fs * 0.9));
            }
          }
        }
      }
    }

    // Hit line
    const hl = ctx.createLinearGradient(0, 0, w, 0);
    hl.addColorStop(0, rgba(pal.L, 0.9));
    hl.addColorStop(0.5, rgba(pal.accent, 0.9));
    hl.addColorStop(1, rgba(pal.R, 0.9));
    ctx.save();
    if (glow) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 14; }
    ctx.fillStyle = hl;
    ctx.fillRect(0, hitY - 1, w, 3);
    ctx.restore();

    // Hit bursts and judgement text
    for (const m of fr.marks) {
      const age = (fr.nowMs - m.at) / 1000;
      if (age > 0.7 || m.keyMidi == null) continue;
      const kx = keyX(m.keyMidi);
      if (!kx) continue;
      const col = judgeColor(pal, m.type);
      const e = easeOut(age / 0.7);
      ctx.strokeStyle = rgba(col, 1 - e);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(kx.cx, hitY, 6 + e * 26, Math.PI, TAU);
      ctx.stroke();
      if (m.type !== 'miss') {
        for (let r = 0; r < 6; r++) {
          const a = Math.PI + (r + 0.5) * (Math.PI / 6);
          const r0 = 8 + e * 16, r1 = r0 + 8 * (1 - e);
          ctx.beginPath();
          ctx.moveTo(kx.cx + Math.cos(a) * r0, hitY + Math.sin(a) * r0);
          ctx.lineTo(kx.cx + Math.cos(a) * r1, hitY + Math.sin(a) * r1);
          ctx.stroke();
        }
      }
      ctx.font = `700 12px ${pal.fontUi}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = rgba(col, 1 - e);
      ctx.fillText(m.label || '', kx.cx, hitY - 26 - e * 20);
    }
  }
}
