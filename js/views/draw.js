// Canvas helpers shared by every view.

import { isBlack } from '../rhythm.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const TAU = Math.PI * 2;

const rgbCache = new Map();
export function toRgb(color) {
  if (rgbCache.has(color)) return rgbCache.get(color);
  let c = color.trim();
  let rgb = [128, 128, 128];
  if (c.startsWith('#')) {
    if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
    const n = parseInt(c.slice(1, 7), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = c.match(/[\d.]+/g);
    if (m) rgb = m.slice(0, 3).map(Number);
  }
  rgbCache.set(color, rgb);
  return rgb;
}

export function rgba(color, a) {
  const [r, g, b] = toRgb(color);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1).toFixed(3)})`;
}

export function mix(c1, c2, t) {
  const a = toRgb(c1), b = toRgb(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

/** Read colors from CSS custom properties. */
export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    dark: document.documentElement.dataset.theme !== 'light',
    bg: v('--bg'), stage: v('--stage-bg'), card: v('--card-solid'),
    text: v('--text'), text2: v('--text-2'), text3: v('--text-3'),
    line: v('--line'), line2: v('--line-2'),
    accent: v('--accent'), accent2: v('--accent-2'),
    L: v('--lh'), L2: v('--lh-2'), R: v('--rh'), R2: v('--rh-2'), both: v('--both'),
    perfect: v('--perfect'), great: v('--great'), good: v('--good'), miss: v('--miss'),
    chartL: v('--chart-lh'), chartR: v('--chart-rh'),
    keyWhite: v('--key-white'), keyWhite2: v('--key-white-2'),
    keyBlack: v('--key-black'), keyBlack2: v('--key-black-2'),
    handMix: parseFloat(v('--hand-mix')) || 0.7,
    fontUi: v('--font-ui'), fontDisplay: v('--font-display'), fontMusic: v('--font-music'),
  };
}

export const judgeColor = (pal, type) => ({
  perfect: pal.perfect, great: pal.perfect, good: pal.good, miss: pal.miss, extra: pal.miss, wrong: pal.miss,
}[type] || pal.text3);

/** Size a canvas to its CSS box at device pixel ratio; returns { w, h, dpr, changed }. */
export function fitCanvas(canvas, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(cssH ?? rect.height));
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  let changed = false;
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    changed = true;
  }
  return { w, h, dpr, changed };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Keyboard geometry shared by the piano and the falling-notes view. */
export function keyboardLayout(width, lo, hi, padX = 10) {
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const ww = (width - padX * 2) / whites.length;
  const keys = new Map();
  whites.forEach((m, i) => {
    const x = padX + i * ww;
    keys.set(m, { midi: m, black: false, x, w: ww, cx: x + ww / 2 });
  });
  const shift = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
  const bw = ww * 0.6;
  for (let m = lo + 1; m < hi; m++) {
    if (!isBlack(m)) continue;
    const left = keys.get(m - 1);
    if (!left) continue;
    const cx = left.x + ww + (shift[((m % 12) + 12) % 12] || 0) * ww;
    keys.set(m, { midi: m, black: true, x: cx - bw / 2, w: bw, cx });
  }
  return { keys, whites, ww, lo, hi, padX, width };
}

/** Clip a hand-drawn text to fit. */
export function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
