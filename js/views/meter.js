// Compact early/late meter: the last few hits of each hand as ticks around "on time".

import { clamp, rgba, fitCanvas, roundRect, judgeColor } from './draw.js';

const RANGE = 0.15; // seconds shown on each side

export class MeterView {
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
    const cx = w / 2;
    const xOf = (dt) => cx + clamp(dt / RANGE, -1, 1) * (w / 2 - 6);

    ctx.fillStyle = rgba(pal.text3, 0.1);
    roundRect(ctx, 0, 2, w, h - 4, 8);
    ctx.fill();
    ctx.fillStyle = rgba(pal.perfect, 0.16);
    ctx.fillRect(xOf(-0.03), 2, xOf(0.03) - xOf(-0.03), h - 4);
    ctx.fillStyle = rgba(pal.perfect, 0.07);
    ctx.fillRect(xOf(-0.065), 2, xOf(0.065) - xOf(-0.065), h - 4);
    ctx.strokeStyle = rgba(pal.text, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, 2);
    ctx.lineTo(cx + 0.5, h - 2);
    ctx.stroke();

    const rows = { R: [4, h / 2 - 1], L: [h / 2 + 1, h - 4] };
    const per = { L: [], R: [] };
    for (let i = fr.marks.length - 1; i >= 0; i--) {
      const m = fr.marks[i];
      if (m.dt == null || per[m.hand].length >= 14) continue;
      per[m.hand].push(m);
    }
    for (const hand of ['L', 'R']) {
      const [y0, y1] = rows[hand];
      per[hand].forEach((m, idx) => {
        const age = (fr.nowMs - m.at) / 1000;
        const a = clamp(1 - idx / 14, 0.15, 1) * clamp(1.4 - age / 12, 0.2, 1);
        ctx.strokeStyle = rgba(judgeColor(pal, m.type), a);
        ctx.lineWidth = idx === 0 ? 3 : 2;
        const x = xOf(m.dt);
        ctx.beginPath();
        ctx.moveTo(x, y0 + 2);
        ctx.lineTo(x, y1 - 2);
        ctx.stroke();
      });
      const recent = per[hand].slice(0, 8);
      if (recent.length >= 3) {
        const mean = recent.reduce((s, m) => s + m.dt, 0) / recent.length;
        const x = xOf(mean);
        const yy = hand === 'R' ? y0 : y1;
        ctx.fillStyle = pal[hand];
        ctx.beginPath();
        if (hand === 'R') { ctx.moveTo(x - 5, yy - 3); ctx.lineTo(x + 5, yy - 3); ctx.lineTo(x, yy + 3); }
        else { ctx.moveTo(x - 5, yy + 3); ctx.lineTo(x + 5, yy + 3); ctx.lineTo(x, yy - 3); }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.font = `700 9.5px ${pal.fontUi}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(pal.R, 0.9);
    ctx.fillText(fr.handShort.R, 6, h * 0.27);
    ctx.fillStyle = rgba(pal.L, 0.9);
    ctx.fillText(fr.handShort.L, 6, h * 0.73);
  }
}
