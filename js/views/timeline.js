// Grid view: both hands as bars on a shared subdivision grid (like a step sequencer).

import { clamp, rgba, mix, fitCanvas, roundRect, judgeColor } from './draw.js';
import { lcm } from '../rhythm.js';

export class TimelineView {
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
    const k = Math.max(0, Math.floor(fr.pos));
    const playing = fr.playing && fr.pos >= 0;
    const phase = playing ? fr.pos - Math.floor(fr.pos) : 0;
    const spec = fr.spec(k);
    const g = lcm(spec.L, spec.R);
    const gap = playing && fr.isGap(k);

    ctx.font = `700 13px ${pal.fontUi}`;
    const labelW = Math.max(ctx.measureText(fr.handLabel.R).width, ctx.measureText(fr.handLabel.L).width);
    const padL = Math.max(clamp(w * 0.09, 54, 92), labelW + 30), padR = clamp(w * 0.04, 18, 40);
    const top = 92, bottom = h - 26;
    const laneW = w - padL - padR;
    const avail = bottom - top;
    const laneH = clamp(avail * 0.3, 40, 120);
    const compH = clamp(avail * 0.16, 26, 60);
    const gapY = (avail - laneH * 2 - compH) / 2;
    const yR = top, yC = yR + laneH + gapY, yL = yC + compH + gapY;
    const cellW = laneW / g;
    const xOf = (p) => padL + p * laneW;

    // Ruler
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const showNums = cellW > 13;
    for (let j = 0; j <= g; j++) {
      const x = xOf(j / g);
      ctx.strokeStyle = rgba(pal.text3, j === 0 || j === g ? 0.5 : 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top - 10);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      if (showNums && j < g) {
        const isNow = playing && Math.floor(phase * g) === j;
        ctx.font = `${isNow ? 700 : 500} 11px ${pal.fontUi}`;
        ctx.fillStyle = isNow ? pal.text : pal.text3;
        ctx.fillText(String(j + 1), x + cellW / 2, top - 22);
      }
    }

    // Lane labels
    ctx.textAlign = 'right';
    ctx.font = `700 13px ${pal.fontUi}`;
    ctx.fillStyle = pal.R;
    ctx.fillText(fr.handLabel.R, padL - 14, yR + laneH / 2);
    ctx.fillStyle = pal.L;
    ctx.fillText(fr.handLabel.L, padL - 14, yL + laneH / 2);
    ctx.fillStyle = pal.text3;
    ctx.font = `600 10.5px ${pal.fontUi}`;
    ctx.fillText(fr.compLabel, padL - 14, yC + compH / 2);

    const lane = (hand, y) => {
      const n = hand === 'L' ? spec.L : spec.R;
      const c = pal[hand];
      const engaged = fr.handEngaged[hand];
      ctx.fillStyle = rgba(c, 0.05);
      roundRect(ctx, padL, y, laneW, laneH, 10);
      ctx.fill();
      for (let i = 0; i < n; i++) {
        const p0 = i / n, p1 = (i + 1) / n;
        const x0 = xOf(p0) + 2, x1 = xOf(p1) - 2;
        const lit = playing && phase >= p0 && phase < p1;
        const played = playing && phase >= p1;
        let flash = 0;
        if (lit) flash = clamp(1 - ((phase - p0) * fr.dur) / 0.4, 0, 1);
        const bg = ctx.createLinearGradient(x0, 0, x1, 0);
        const aBase = gap ? 0.12 : lit ? 0.5 + flash * 0.4 : played ? 0.22 : 0.3;
        bg.addColorStop(0, rgba(c, aBase * (engaged ? 1 : 0.6)));
        bg.addColorStop(1, rgba(c, aBase * 0.35 * (engaged ? 1 : 0.6)));
        ctx.fillStyle = bg;
        roundRect(ctx, x0, y + 4, x1 - x0, laneH - 8, 8);
        ctx.fill();
        ctx.save();
        if (lit && !fr.reduce) { ctx.shadowColor = c; ctx.shadowBlur = 20 * flash; }
        ctx.fillStyle = gap ? rgba(c, 0.5) : mix(c, '#ffffff', flash * 0.5);
        roundRect(ctx, x0, y + 4, Math.min(6, x1 - x0), laneH - 8, 3);
        ctx.fill();
        ctx.restore();
        if (fr.cfg.showFingers) {
          const note = fr.note(hand, k, i, n);
          const fs = clamp(laneH * 0.3, 11, 22);
          ctx.font = `700 ${fs}px ${pal.fontUi}`;
          ctx.textAlign = 'left';
          ctx.fillStyle = lit ? pal.text : rgba(pal.text, 0.7);
          ctx.fillText(note.fingers.join('+'), x0 + 14, y + laneH / 2 + 1);
          if (x1 - x0 > 80) {
            ctx.font = `500 ${fs * 0.55}px ${pal.fontUi}`;
            ctx.fillStyle = pal.text3;
            ctx.fillText(fr.noteLabel(note.midis[0]), x0 + 14, y + laneH / 2 + fs * 0.8);
          }
        }
      }
    };
    lane('R', yR);
    lane('L', yL);

    // Composite lane
    const syl = fr.sylList || [];
    for (const s of syl) {
      const x = xOf(s.phase);
      const isNow = fr.syl?.current === s && playing;
      const col = s.who === 'L' ? pal.L : s.who === 'R' ? pal.R : pal.both;
      const rr = clamp(compH * 0.28, 8, 16);
      ctx.fillStyle = isNow ? col : rgba(col, 0.35);
      ctx.beginPath();
      ctx.arc(x + Math.min(cellW / 2, rr + 4), yC + compH / 2, isNow ? rr * 1.15 : rr * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${clamp(compH * 0.34, 11, 17)}px ${pal.fontUi}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = isNow ? pal.text : pal.text2;
      const tx = x + Math.min(cellW / 2, rr + 4) + rr + 4;
      if (cellW * (s.span || 1) > 30) ctx.fillText(s.text, tx, yC + compH / 2 + 1);
    }

    // Hit marks (this cycle)
    for (const m of fr.marks) {
      if (m.pos == null || Math.floor(m.pos) !== Math.floor(fr.pos)) continue;
      const age = (fr.nowMs - m.at) / 1000;
      const x = xOf(m.pos - Math.floor(m.pos));
      const y = m.hand === 'R' ? yR : yL;
      const col = judgeColor(pal, m.type);
      ctx.strokeStyle = rgba(col, clamp(1 - age / 4, 0.35, 1));
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (m.type === 'miss') {
        ctx.moveTo(x - 5, y + laneH - 14); ctx.lineTo(x + 5, y + laneH - 4);
        ctx.moveTo(x + 5, y + laneH - 14); ctx.lineTo(x - 5, y + laneH - 4);
      } else {
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x, y + laneH + 2);
      }
      ctx.stroke();
    }

    // Playhead
    if (playing) {
      const x = xOf(phase);
      ctx.save();
      if (!fr.reduce) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 12; }
      ctx.strokeStyle = pal.accent2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top - 12);
      ctx.lineTo(x, bottom + 4);
      ctx.stroke();
      ctx.fillStyle = pal.accent2;
      ctx.beginPath();
      ctx.moveTo(x - 6, top - 14); ctx.lineTo(x + 6, top - 14); ctx.lineTo(x, top - 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
