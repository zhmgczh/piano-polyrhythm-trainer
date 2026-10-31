// Small canvas charts with hover tooltips: timing histogram (results) and accuracy trend (progress).

import { rgba, fitCanvas, roundRect, clamp } from './views/draw.js';

function setupTip(wrap) {
  let tip = wrap.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    wrap.appendChild(tip);
  }
  return tip;
}

function placeTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const ww = wrap.clientWidth;
  const tw = tip.offsetWidth;
  tip.style.left = `${clamp(x + 12, 0, ww - tw)}px`;
  tip.style.top = `${Math.max(0, y - 44)}px`;
}

/**
 * Two stacked histograms (right hand on top, left hand below) of timing offsets in ms.
 * opts: { pal, labels: { L, R }, tip(hand, lo, hi, count) -> html }
 */
export function drawHistogram(wrap, data, opts) {
  const canvas = wrap.querySelector('canvas');
  const tip = setupTip(wrap);
  const BIN = 10, MAX = 150;
  const bins = (arr) => {
    const b = new Array((MAX * 2) / BIN).fill(0);
    for (const v of arr) b[clamp(Math.floor((v + MAX) / BIN), 0, b.length - 1)]++;
    return b;
  };
  const series = { R: bins(data.R), L: bins(data.L) };
  const peak = Math.max(1, ...series.R, ...series.L);
  const hit = [];

  const render = (hover) => {
    const { pal } = opts;
    const { w, h, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 40, padR = 8, axisH = 22;
    const rowH = (h - axisH - 8) / 2;
    const plotW = w - padL - padR;
    const n = series.R.length;
    const bw = plotW / n;
    const xOfMs = (ms) => padL + ((ms + MAX) / (MAX * 2)) * plotW;
    hit.length = 0;

    // Perfect band and zero line (recessive)
    ctx.fillStyle = rgba(pal.text3, 0.07);
    ctx.fillRect(xOfMs(-30), 0, xOfMs(30) - xOfMs(-30), rowH * 2 + 6);
    ['R', 'L'].forEach((hand, row) => {
      const base = 4 + row * (rowH + 2) + rowH;
      ctx.strokeStyle = rgba(pal.text3, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, base + 0.5);
      ctx.lineTo(w - padR, base + 0.5);
      ctx.stroke();
      ctx.fillStyle = pal.text2;
      ctx.font = `600 11px ${pal.fontUi}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.labels[hand], 0, base - rowH + 2);
      const color = hand === 'L' ? pal.chartL : pal.chartR;
      series[hand].forEach((count, i) => {
        if (!count) return;
        const bh = Math.max(2, (count / peak) * (rowH - 16));
        const x = padL + i * bw + 1;
        const isHover = hover && hover.hand === hand && hover.i === i;
        ctx.fillStyle = isHover ? color : rgba(color, 0.88);
        roundRect(ctx, x, base - bh, Math.max(1, bw - 2), bh + 4, Math.min(4, (bw - 2) / 2));
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, base);
        ctx.clip();
        roundRect(ctx, x, base - bh, Math.max(1, bw - 2), bh + 4, Math.min(4, (bw - 2) / 2));
        ctx.fill();
        ctx.restore();
        hit.push({ hand, i, x0: padL + i * bw, x1: padL + (i + 1) * bw, y0: base - rowH, y1: base, count });
      });
      // Make every bin hoverable (not only filled ones) for consistent targets
      for (let i = 0; i < n; i++) if (!series[hand][i]) hit.push({ hand, i, x0: padL + i * bw, x1: padL + (i + 1) * bw, y0: base - rowH, y1: base, count: 0 });
    });
    ctx.strokeStyle = rgba(pal.text3, 0.5);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xOfMs(0) + 0.5, 0);
    ctx.lineTo(xOfMs(0) + 0.5, rowH * 2 + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = pal.text3;
    ctx.font = `500 10.5px ${pal.fontUi}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const ms of [-150, -100, -50, 0, 50, 100, 150]) {
      ctx.fillText(ms > 0 ? `+${ms}` : String(ms), clamp(xOfMs(ms), padL + 10, w - padR - 12), rowH * 2 + 10);
    }
  };

  render(null);
  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const target = hit.find((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y <= b.y1);
    if (!target) { tip.classList.remove('show'); render(null); return; }
    render(target);
    const lo = -MAX + target.i * BIN;
    placeTip(tip, wrap, x, y, opts.tip(target.hand, lo, lo + BIN, target.count));
  };
  canvas.onpointerleave = () => { tip.classList.remove('show'); render(null); };
  return () => render(null);
}

/**
 * Accuracy trend line (0–100%) across sessions.
 * points: [{ acc 0..1, label html }]
 */
export function drawTrend(wrap, points, opts) {
  const canvas = wrap.querySelector('canvas');
  const tip = setupTip(wrap);
  let coords = [];

  const render = (hoverIdx) => {
    const { pal } = opts;
    const { w, h, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 36, padR = 10, padT = 10, padB = 18;
    const pw = w - padL - padR, ph = h - padT - padB;
    const yOf = (v) => padT + (1 - v) * ph;
    ctx.font = `500 10.5px ${pal.fontUi}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0.5, 0.75, 1]) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = rgba(pal.text3, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = pal.text3;
      ctx.fillText(`${Math.round(v * 100)}%`, padL - 6, y);
    }
    ctx.strokeStyle = rgba(pal.text3, 0.4);
    ctx.beginPath();
    ctx.moveTo(padL, yOf(0) + 0.5);
    ctx.lineTo(w - padR, yOf(0) + 0.5);
    ctx.stroke();
    ctx.fillStyle = pal.text3;
    ctx.fillText('0%', padL - 6, yOf(0));

    const n = points.length;
    coords = points.map((p, i) => ({ x: padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), y: yOf(clamp(p.acc, 0, 1)) }));
    if (hoverIdx != null) {
      const c = coords[hoverIdx];
      ctx.strokeStyle = rgba(pal.text3, 0.5);
      ctx.beginPath();
      ctx.moveTo(c.x + 0.5, padT);
      ctx.lineTo(c.x + 0.5, yOf(0));
      ctx.stroke();
    }
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    coords.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.stroke();
    coords.forEach((c, i) => {
      const r = i === hoverIdx ? 5.5 : 4;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = pal.card;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
    });
    // Direct label on the latest point only
    if (n) {
      const last = coords[n - 1];
      ctx.fillStyle = pal.text;
      ctx.font = `700 11px ${pal.fontUi}`;
      ctx.textAlign = last.x > w - 50 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(points[n - 1].acc * 100)}%`, last.x + (last.x > w - 50 ? -8 : 8), last.y - 6);
    }
  };

  render(null);
  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = null, bd = Infinity;
    coords.forEach((c, i) => { const d = Math.abs(c.x - x); if (d < bd) { bd = d; best = i; } });
    if (best == null || bd > 40) { tip.classList.remove('show'); render(null); return; }
    render(best);
    placeTip(tip, wrap, coords[best].x, coords[best].y, points[best].label);
  };
  canvas.onpointerleave = () => { tip.classList.remove('show'); render(null); };
  return () => render(null);
}
