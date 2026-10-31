// Circular view: each hand is a polygon on its own ring, a playhead sweeps the cycle.

import { clamp, rgba, mix, fitCanvas, TAU, easeOut, judgeColor } from './draw.js';
import { lcm } from '../rhythm.js';

const angleOf = (phase) => -Math.PI / 2 + phase * TAU;

export class OrbitView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(fr) {
    const { ctx } = this;
    const { w, h, dpr } = fitCanvas(this.canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pal = fr.pal;
    const cx = w / 2, cy = h / 2 + 8;
    const R = Math.max(40, Math.min(w * 0.4, h / 2 - 42));
    const rings = { R: R, L: R * 0.64 };
    const k = Math.floor(fr.pos);
    const phase = fr.pos - k;
    const spec = fr.spec(Math.max(0, k));
    const g = lcm(spec.L, spec.R);
    const glow = !fr.reduce;
    const playing = fr.playing && fr.pos >= 0;
    const gap = playing && fr.isGap(k);

    // Grid ticks around the outer ring
    for (let j = 0; j < g; j++) {
      const a = angleOf(j / g);
      const r1 = R + 12, r2 = R + (j === 0 ? 24 : 18);
      ctx.strokeStyle = rgba(pal.text3, j === 0 ? 0.7 : 0.35);
      ctx.lineWidth = j === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }

    // Metronome clicks on the outermost ring
    if (fr.cfg.metro.on) {
      const ticks = fr.metroTicks(k);
      for (const tk of ticks) {
        const a = angleOf(tk.phase);
        const r = R + 34;
        let flash = 0;
        if (playing) {
          const since = (phase - tk.phase) * fr.dur;
          if (since >= 0) flash = clamp(1 - since / 0.25, 0, 1);
        }
        const size = (tk.level === 'accent' ? 4.2 : tk.level === 'normal' ? 3 : 2) * (1 + flash * 0.6);
        ctx.fillStyle = flash > 0 ? rgba(pal.accent2, 0.5 + flash * 0.5) : rgba(pal.text2, tk.level === 'soft' ? 0.35 : 0.6);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, 0, TAU);
        ctx.fill();
      }
    }

    // Guide rings
    for (const hand of ['L', 'R']) {
      ctx.strokeStyle = rgba(pal[hand], 0.12);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rings[hand], 0, TAU);
      ctx.stroke();
    }

    // Progress arc + sweep
    if (playing) {
      const a0 = angleOf(0), a1 = angleOf(phase);
      ctx.strokeStyle = rgba(pal.accent, 0.55);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R + 12, a0, a1);
      ctx.stroke();
      if (ctx.createConicGradient && !fr.reduce) {
        const cg = ctx.createConicGradient(a1 - TAU * 0.18, cx, cy);
        cg.addColorStop(0, rgba(pal.accent, 0));
        cg.addColorStop(0.18, rgba(pal.accent, pal.dark ? 0.16 : 0.1));
        cg.addColorStop(0.1801, rgba(pal.accent, 0));
        cg.addColorStop(1, rgba(pal.accent, 0));
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, R + 8, 0, TAU);
        ctx.fill();
      }
    }

    // Polygons
    for (const hand of ['R', 'L']) {
      const n = hand === 'L' ? spec.L : spec.R;
      const r = rings[hand];
      const c = pal[hand];
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = angleOf(i / n);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (n > 2) ctx.closePath();
      if (n === 1) ctx.lineTo(cx, cy);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(c, fr.handEngaged[hand] ? 0.7 : 0.35);
      ctx.stroke();
      if (n > 2) {
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, rgba(c, 0.0));
        rg.addColorStop(1, rgba(c, pal.dark ? 0.12 : 0.08));
        ctx.fillStyle = rg;
        ctx.fill();
      }
    }

    // User hit marks on the rings
    const now = fr.nowMs;
    for (const m of fr.marks) {
      const age = (now - m.at) / 1000;
      if (age > 2.2 || m.pos == null) continue;
      const a = angleOf(m.pos - Math.floor(m.pos));
      const r = rings[m.hand];
      const col = judgeColor(pal, m.type);
      const alpha = 1 - age / 2.2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = rgba(col, alpha);
      ctx.beginPath();
      const sz = m.type === 'miss' ? 5 : 6;
      ctx.moveTo(sz * 2.4, 0); ctx.lineTo(0, -sz); ctx.lineTo(-sz * 2.4 * 0.3, 0); ctx.lineTo(0, sz);
      ctx.closePath();
      ctx.translate(0, 0);
      ctx.fill();
      ctx.restore();
      if (m.type !== 'miss') {
        ctx.strokeStyle = rgba(col, alpha * 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 14 + age * 18, 0, TAU);
        ctx.stroke();
      }
    }

    // Note dots
    const dotR = clamp(R * 0.075, 9, 20);
    for (const hand of ['R', 'L']) {
      const n = hand === 'L' ? spec.L : spec.R;
      const r = rings[hand];
      const c = pal[hand];
      const engaged = fr.handEngaged[hand];
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const a = angleOf(p);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        let flash = 0;
        if (playing) {
          let since = (phase - p) * fr.dur;
          if (since < 0 && k > 0) since += fr.dur;
          if (since >= 0) flash = clamp(1 - since / 0.45, 0, 1);
        }
        if (gap) flash *= 0.25;
        // Ripple
        if (flash > 0 && glow) {
          const e = easeOut(1 - flash);
          ctx.strokeStyle = rgba(c, flash * 0.8);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, dotR + e * dotR * 2.2, 0, TAU);
          ctx.stroke();
        }
        ctx.save();
        if (glow && flash > 0) { ctx.shadowColor = c; ctx.shadowBlur = 26 * flash; }
        const rr = dotR * (1 + flash * 0.35) * (i === 0 ? 1.12 : 1);
        const grd = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
        grd.addColorStop(0, mix(c, '#ffffff', 0.35 + flash * 0.4));
        grd.addColorStop(1, c);
        ctx.fillStyle = gap ? rgba(c, 0.25) : grd;
        ctx.globalAlpha = engaged ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.fill();
        ctx.restore();
        if (gap) {
          ctx.strokeStyle = rgba(c, 0.8);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, TAU);
          ctx.stroke();
        }
        // Finger number of the upcoming note at this spot.
        if (fr.cfg.showFingers) {
          const kk = playing && p <= phase ? k + 1 : Math.max(0, k);
          const note = fr.note(hand, kk, i, n);
          ctx.fillStyle = gap ? pal.text : '#0d1020';
          ctx.font = `700 ${Math.round(dotR * (note.fingers.length > 1 ? 0.72 : 0.95))}px ${pal.fontUi}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(note.fingers.join(note.fingers.length > 2 ? '' : '+'), x, y + 0.5);
        }
      }
    }

    // Playhead
    if (playing) {
      const a = angleOf(phase);
      ctx.save();
      if (glow) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 14; }
      const lg = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
      lg.addColorStop(0, rgba(pal.accent, 0));
      lg.addColorStop(0.35, rgba(pal.accent, 0.5));
      lg.addColorStop(1, rgba(pal.accent2, 1));
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18);
      ctx.lineTo(cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
      ctx.stroke();
      ctx.fillStyle = pal.accent2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (R + 12), cy + Math.sin(a) * (R + 12), 5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Center
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!fr.playing || fr.pos >= 0) {
      ctx.fillStyle = pal.stage;
      ctx.globalAlpha = 0.86;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (fr.playing ? 0.3 : 0.36), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!fr.playing) {
      const fs = clamp(R * 0.36, 28, 72);
      ctx.font = `600 ${fs}px ${pal.fontDisplay}`;
      const gapW = fs * 0.35;
      const tl = String(spec.L), tr = String(spec.R);
      const wl = ctx.measureText(tl).width, wr = ctx.measureText(tr).width;
      const total = wl + wr + gapW * 2;
      ctx.fillStyle = pal.L;
      ctx.fillText(tl, cx - total / 2 + wl / 2, cy);
      ctx.fillStyle = pal.text3;
      ctx.font = `500 ${fs * 0.6}px ${pal.fontDisplay}`;
      ctx.fillText(':', cx, cy - fs * 0.04);
      ctx.font = `600 ${fs}px ${pal.fontDisplay}`;
      ctx.fillStyle = pal.R;
      ctx.fillText(tr, cx + total / 2 - wr / 2, cy);
    } else if (fr.pos >= 0 && fr.syl) {
      const fs = clamp(R * 0.26, 20, 54);
      const cur = fr.syl.current;
      if (cur) {
        const col = cur.who === 'L' ? pal.L : cur.who === 'R' ? pal.R : pal.both;
        const age = fr.syl.since;
        const s = 1 + 0.14 * clamp(1 - age / 0.2, 0, 1);
        ctx.save();
        ctx.translate(cx, cy - fs * 0.15);
        ctx.scale(s, s);
        ctx.font = `700 ${fs}px ${pal.fontUi}`;
        ctx.fillStyle = col;
        if (glow) { ctx.shadowColor = col; ctx.shadowBlur = 18; }
        ctx.fillText(cur.text, 0, 0);
        ctx.restore();
      }
      ctx.font = `500 ${clamp(R * 0.075, 10, 14)}px ${pal.fontUi}`;
      ctx.fillStyle = pal.text3;
      ctx.fillText(fr.cycleLabel, cx, cy + fs * 0.75);
    }

    // Ring labels
    ctx.font = `600 11px ${pal.fontUi}`;
    ctx.textAlign = 'left';
    for (const hand of ['R', 'L']) {
      const r = rings[hand];
      const a = angleOf(0.02);
      ctx.fillStyle = rgba(pal[hand], 0.8);
      ctx.fillText(fr.handLabel[hand], cx + Math.cos(a) * r + dotR + 8, cy + Math.sin(a) * r - 2);
    }
  }
}
