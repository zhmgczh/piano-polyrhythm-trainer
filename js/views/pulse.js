// Pulse view: one big light per hand that flashes on every note of that hand,
// with an approach ring that shrinks onto the light right when the next note is due.

import { clamp, rgba, mix, fitCanvas, TAU, judgeColor, easeOut } from './draw.js';
import { lcm } from '../rhythm.js';

export class PulseView {
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
    const playing = fr.playing;
    const pos = fr.pos;
    const k = Math.floor(pos);
    const kk = Math.max(0, k);
    const phase = pos - k;
    const spec = fr.spec(kk);
    const gap = playing && pos >= 0 && fr.isGap(k);
    const glow = !fr.reduce;

    const stripH = 58;
    const cy = 70 + (h - 70 - stripH - 40) / 2;
    const R = clamp(Math.min(w * 0.16, (h - 70 - stripH - 96) / 2.15), 30, 140);
    const centers = { L: { x: w * 0.28, y: cy }, R: { x: w * 0.72, y: cy } };
    const flashOf = {};

    for (const hand of ['L', 'R']) {
      const n = hand === 'L' ? spec.L : spec.R;
      const c = pal[hand];
      const { x, y } = centers[hand];
      const engaged = fr.handEngaged[hand];
      const interval = fr.dur / n;

      let idx = -1, flash = 0, eta = null;
      if (playing && pos >= 0) {
        idx = Math.min(n - 1, Math.floor(phase * n + 1e-9));
        const since = (pos - (k + idx / n)) * fr.dur;
        flash = clamp(1 - since / Math.min(0.42, interval * 0.8), 0, 1);
        if (gap) flash *= 0.15;
        eta = (k + (idx + 1) / n - pos) * fr.dur;
      } else if (playing) {
        eta = -pos * fr.dur;
      }
      flashOf[hand] = idx === 0 ? flash : 0;


      // Halo
      if (flash > 0 && glow) {
        const rg = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 2.1);
        rg.addColorStop(0, rgba(c, 0.38 * flash));
        rg.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, R * 2.1, 0, TAU);
        ctx.fill();
      }

      // Body
      const r = R * (1 + 0.07 * easeOut(flash));
      const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      const lit = flash;
      body.addColorStop(0, lit > 0 ? mix(mix(c, '#ffffff', 0.55), pal.stage, 1 - lit) : rgba(c, pal.dark ? 0.16 : 0.12));
      body.addColorStop(1, lit > 0 ? mix(c, pal.stage, 1 - lit * 0.95) : rgba(c, pal.dark ? 0.06 : 0.05));
      ctx.save();
      if (glow && flash > 0) { ctx.shadowColor = c; ctx.shadowBlur = 40 * flash; }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(c, engaged ? 0.85 : 0.45);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();

      // Approach ring: shrinks onto the light exactly when the next note is due
      const lead = Math.min(interval, 1.2);
      if (eta != null && eta > 0 && eta <= lead) {
        const a = 1 - eta / lead;
        const rr = R * (1 + 0.75 * (eta / lead));
        ctx.lineWidth = 2 + 3 * a;
        ctx.strokeStyle = rgba(c, (gap ? 0.3 : 0.25) + 0.7 * a);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.stroke();
      }

      // Label on a pill so approach rings never hide it
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${clamp(R * 0.2, 12, 18)}px ${pal.fontUi}`;
      const lw = ctx.measureText(fr.handLabel[hand]).width + 18, lh = clamp(R * 0.2, 12, 18) + 10;
      ctx.fillStyle = rgba(pal.stage, 0.85);
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - lw / 2, y - R - 30 - lh / 2, lw, lh, lh / 2) : ctx.rect(x - lw / 2, y - R - 30 - lh / 2, lw, lh);
      ctx.fill();
      ctx.fillStyle = rgba(c, engaged ? 1 : 0.6);
      ctx.fillText(fr.handLabel[hand], x, y - R - 30);

      // Big count: which note of the hand's group is sounding
      const shown = playing && pos >= 0 ? idx + 1 : n;
      ctx.font = `600 ${R * 0.9}px ${pal.fontDisplay}`;
      ctx.fillStyle = flash > 0.35 ? (pal.dark ? '#0b0e1a' : '#ffffff') : rgba(c, engaged ? 1 : 0.65);
      ctx.fillText(String(shown), x, y - R * 0.06);

      // Finger + note of the current (or upcoming) note
      const noteIdx = playing && pos >= 0 ? idx : 0;
      const note = fr.note(hand, kk, Math.max(0, noteIdx), n);
      ctx.font = `600 ${clamp(R * 0.15, 10, 15)}px ${pal.fontUi}`;
      ctx.fillStyle = flash > 0.35 ? (pal.dark ? 'rgba(11,14,26,.8)' : 'rgba(255,255,255,.9)') : pal.text2;
      ctx.fillText(`${fr.fingerWord} ${note.fingers.join('+')} · ${note.midis.map(fr.noteLabel).join(' ')}`, x, y + R * 0.5);

      // Beat dots
      const dotR = clamp(R * 0.075, 4, 8);
      const gapX = Math.min(dotR * 3.4, (R * 2.6) / Math.max(1, n - 1));
      const y0 = y + R + 26;
      for (let i = 0; i < n; i++) {
        const dx = x + (i - (n - 1) / 2) * gapX;
        const on = i === idx;
        const past = playing && pos >= 0 && i < idx;
        ctx.fillStyle = on ? c : past ? rgba(c, 0.5) : rgba(pal.text3, 0.45);
        ctx.beginPath();
        ctx.arc(dx, y0, on ? dotR * 1.35 : dotR, 0, TAU);
        ctx.fill();
      }

      // Most recent judgement for this hand
      for (let i = fr.marks.length - 1; i >= 0; i--) {
        const m = fr.marks[i];
        if (m.hand !== hand) continue;
        const age = (fr.nowMs - m.at) / 1000;
        if (age > 0.9) break;
        ctx.font = `700 ${clamp(R * 0.17, 12, 18)}px ${pal.fontUi}`;
        ctx.fillStyle = rgba(judgeColor(pal, m.type), 1 - age / 0.9);
        ctx.fillText(m.lampText || m.label || '', x, y0 + 28 - age * 10);
        break;
      }
    }

    // Downbeat link: both hands land together on note 1
    const together = Math.min(flashOf.L || 0, flashOf.R || 0);
    const xa = centers.L.x + R + 14, xb = centers.R.x - R - 14;
    ctx.lineCap = 'round';
    ctx.setLineDash(together > 0 ? [] : [2, 8]);
    ctx.lineWidth = together > 0 ? 3 : 2;
    const lg = ctx.createLinearGradient(xa, 0, xb, 0);
    lg.addColorStop(0, rgba(pal.L, 0.25 + 0.75 * together));
    lg.addColorStop(1, rgba(pal.R, 0.25 + 0.75 * together));
    ctx.strokeStyle = lg;
    ctx.beginPath();
    ctx.moveTo(xa, cy);
    ctx.lineTo(xb, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Composite syllable in the middle
    if (playing && pos >= 0 && fr.syl?.current) {
      const s = fr.syl.current;
      const col = s.who === 'L' ? pal.L : s.who === 'R' ? pal.R : s.who === 'N' ? pal.text2 : pal.both;
      const pop = clamp(1 - fr.syl.since / 0.25, 0, 1);
      ctx.save();
      ctx.translate(w / 2, cy - 30);
      ctx.scale(1 + 0.12 * pop, 1 + 0.12 * pop);
      ctx.font = `700 ${clamp(R * 0.34, 18, 40)}px ${pal.fontUi}`;
      ctx.fillStyle = col;
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = 16 * pop; }
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }

    // Shared mini timeline: both hands on one bar
    const x0 = w * 0.1, x1 = w * 0.9, ys = h - stripH / 2 - (playing ? 10 : 46);
    const g = lcm(spec.L, spec.R);
    ctx.strokeStyle = rgba(pal.text3, 0.35);
    ctx.lineWidth = 1;
    for (let j = 0; j <= g; j++) {
      const x = x0 + (j / g) * (x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x, ys - 4);
      ctx.lineTo(x, ys + 4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x0, ys);
    ctx.lineTo(x1, ys);
    ctx.stroke();
    for (const hand of ['R', 'L']) {
      const n = hand === 'L' ? spec.L : spec.R;
      const yy = hand === 'R' ? ys - 13 : ys + 13;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i / n) * (x1 - x0);
        const since = playing && pos >= 0 ? (phase - i / n) * fr.dur : -1;
        const hot = since >= 0 && since < 0.3;
        ctx.fillStyle = hot ? mix(pal[hand], '#ffffff', 0.3) : rgba(pal[hand], since >= 0 ? 0.55 : 0.85);
        ctx.beginPath();
        ctx.arc(x, yy, hot ? 7 : 5, 0, TAU);
        ctx.fill();
      }
    }
    if (playing && pos >= 0) {
      const x = x0 + phase * (x1 - x0);
      ctx.strokeStyle = pal.accent2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, ys - 22);
      ctx.lineTo(x, ys + 22);
      ctx.stroke();
    }
  }
}
