// Grand-staff view in proportional notation: horizontal position = time.

import { clamp, rgba, mix, fitCanvas } from './draw.js';
import { spell, usesFlats } from '../rhythm.js';

const TREBLE_REF = 30; // E4, bottom line of the treble staff (diatonic index)
const BASS_REF = 18;   // G2, bottom line of the bass staff

export class NotationView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.musicFontOk = false;
    if (document.fonts?.load) {
      document.fonts.load('40px "Noto Music"', '\u{1D11E}\u{1D122}').then(() => {
        this.musicFontOk = document.fonts.check('40px "Noto Music"', '\u{1D11E}');
      }).catch(() => {});
    }
  }

  draw(fr) {
    const { ctx } = this;
    const { w, h, dpr } = fitCanvas(this.canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pal = fr.pal;
    const flats = usesFlats(fr.cfg);

    const topPad = 70, botPad = 18;
    const avail = h - topPad - botPad;
    const sp = clamp(avail / 25, 5, 12);
    const staffGap = sp * 7.5;
    const total = 8 * sp + staffGap;
    const yTrebleTop = topPad + (avail - total) / 2 + sp * 1.5;
    const yTrebleBot = yTrebleTop + 4 * sp;
    const yBassTop = yTrebleBot + staffGap;
    const yBassBot = yBassTop + 4 * sp;

    const left = clamp(w * 0.03, 12, 36);
    const right = clamp(w * 0.03, 12, 36);
    const clefW = sp * 4.2;
    const x0 = left + sp * 1.4 + clefW;
    const barW = (w - x0 - right) / 2;
    const padIn = Math.max(sp * 2.6, 18);

    const k = Math.max(0, Math.floor(fr.pos));
    const playing = fr.playing && fr.pos >= 0;
    const firstBar = playing ? k - (k % 2) : 0;

    // Staves
    ctx.strokeStyle = rgba(pal.text, 0.45);
    ctx.lineWidth = 1;
    for (const top of [yTrebleTop, yBassTop]) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * sp) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left + sp * 1.4, y);
        ctx.lineTo(w - right, y);
        ctx.stroke();
      }
    }
    // System line + brace
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left + sp * 1.4, yTrebleTop);
    ctx.lineTo(left + sp * 1.4, yBassBot);
    ctx.stroke();
    this.brace(ctx, left + sp * 0.9, yTrebleTop, yBassBot, sp, pal.text);

    // Barlines
    ctx.strokeStyle = rgba(pal.text, 0.55);
    ctx.lineWidth = 1.2;
    // No barline right after the clefs: a system opens with the system line only.
    for (let b = 1; b <= 2; b++) {
      const x = Math.round(x0 + b * barW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, yTrebleTop);
      ctx.lineTo(x, yBassBot);
      ctx.stroke();
    }
    ctx.font = `600 ${clamp(sp * 1.1, 9, 12)}px ${pal.fontUi}`;
    ctx.fillStyle = pal.text3;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let b = 0; b < 2; b++) ctx.fillText(String(firstBar + b + 1), x0 + b * barW + 4, yTrebleTop - sp * 4.6);

    // Clefs, fitted to the staff by their measured outline (standard engraving extents,
    // in staff spaces above the bottom line): the treble clef runs from -1.63 to 5.39 so its
    // curl wraps the G line; the bass clef runs from 0.46 to 4.04 so its dots straddle the F line.
    ctx.fillStyle = pal.text;
    if (this.musicFontOk) {
      const x = left + sp * 1.9;
      this.clef(ctx, '\u{1D11E}', x, yTrebleBot - 5.39 * sp, yTrebleBot + 1.63 * sp);
      this.clef(ctx, '\u{1D122}', x, yBassBot - 4.04 * sp, yBassBot - 0.46 * sp);
    } else {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${sp * 2.4}px ${pal.fontDisplay}`;
      ctx.fillText('G', left + sp * 2.2, yTrebleBot - sp * 0.6);
      ctx.fillText('F', left + sp * 2.2, yBassTop + sp * 2.2);
    }

    // Notes
    for (let b = 0; b < 2; b++) {
      const cyc = firstBar + b;
      const spec = fr.spec(cyc);
      const bx = x0 + b * barW;
      const xOf = (phase) => bx + padIn + phase * (barW - padIn * 2);
      const gap = fr.isGap(cyc);
      this.group(ctx, fr, 'R', cyc, spec.R, xOf, yTrebleBot, TREBLE_REF, sp, flats, gap, playing);
      this.group(ctx, fr, 'L', cyc, spec.L, xOf, yBassBot, BASS_REF, sp, flats, gap, playing);
    }

    // Playhead
    if (playing) {
      const b = k - firstBar;
      const x = x0 + b * barW + padIn + (fr.pos - k) * (barW - padIn * 2);
      ctx.save();
      if (!fr.reduce) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 10; }
      const lg = ctx.createLinearGradient(0, yTrebleTop - sp * 4, 0, yBassBot + sp * 4);
      lg.addColorStop(0, rgba(pal.accent, 0));
      lg.addColorStop(0.15, rgba(pal.accent, 0.85));
      lg.addColorStop(0.85, rgba(pal.accent, 0.85));
      lg.addColorStop(1, rgba(pal.accent, 0));
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, yTrebleTop - sp * 4);
      ctx.lineTo(x, yBassBot + sp * 4);
      ctx.stroke();
      ctx.restore();
    }

    // Caption
    ctx.font = `500 ${clamp(sp * 1.05, 10, 12)}px ${pal.fontUi}`;
    ctx.fillStyle = pal.text3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fr.scoreCaption, w - right, h - 6);
  }

  /** Draw a clef glyph scaled and placed so its ink spans exactly yTop..yBottom. */
  clef(ctx, glyph, x, yTop, yBottom) {
    const REF = 200;
    ctx.font = `${REF}px "Noto Music"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(glyph);
    const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(ink > 0)) return;
    const k = (yBottom - yTop) / ink;
    ctx.font = `${REF * k}px "Noto Music"`;
    ctx.fillText(glyph, x + m.actualBoundingBoxLeft * k, yTop + m.actualBoundingBoxAscent * k);
  }

  brace(ctx, x, y0, y1, sp, color) {
    const mid = (y0 + y1) / 2;
    const wv = sp * 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.bezierCurveTo(x - wv * 1.4, y0 + (mid - y0) * 0.25, x + wv * 0.4, mid - (mid - y0) * 0.3, x - wv, mid);
    ctx.bezierCurveTo(x + wv * 0.4, mid + (y1 - mid) * 0.3, x - wv * 1.4, y1 - (y1 - mid) * 0.25, x, y1);
    ctx.bezierCurveTo(x - wv * 0.9, y1 - (y1 - mid) * 0.25, x + wv * 0.9, mid + (y1 - mid) * 0.3, x - wv * 0.6, mid);
    ctx.bezierCurveTo(x + wv * 0.9, mid - (mid - y0) * 0.3, x - wv * 0.9, y0 + (mid - y0) * 0.25, x, y0);
    ctx.fill();
  }

  group(ctx, fr, hand, cyc, n, xOf, yBot, ref, sp, flats, gap, playing) {
    const pal = fr.pal;
    const yOf = (d) => yBot - (d - ref) * sp / 2;
    const middle = ref + 4;
    const notes = [];
    for (let i = 0; i < n; i++) {
      const note = fr.note(hand, cyc, i, n);
      const sp_ = note.midis.map((m) => spell(m, flats));
      const p = cyc + i / n;
      const since = (fr.pos - p) * fr.dur;
      const sounding = playing && since >= 0 && since < Math.min(0.5, (fr.dur / n) * 0.9);
      const played = playing && since >= 0;
      notes.push({ i, x: xOf(i / n), note, sp: sp_, sounding, played, flash: sounding ? clamp(1 - since / 0.5, 0, 1) : 0 });
    }
    if (!notes.length) return;
    const allD = notes.flatMap((nt) => nt.sp.map((s) => s.diatonic));
    const avg = allD.reduce((a, b) => a + b, 0) / allD.length;
    const up = avg < middle;
    const rx = sp * 0.62, ry = sp * 0.44;
    const color = pal[hand];
    const engaged = fr.handEngaged[hand];
    const colorFor = (nt) => (nt.sounding ? color : nt.played ? rgba(pal.text, 0.4) : rgba(pal.text, engaged ? 0.92 : 0.6));

    // Ledger lines
    ctx.lineWidth = 1;
    for (const nt of notes) {
      for (const s of nt.sp) {
        ctx.strokeStyle = colorFor(nt);
        for (let d = ref - 2; d >= s.diatonic; d -= 2) this.ledger(ctx, nt.x, yOf(d), rx);
        for (let d = ref + 10; d <= s.diatonic; d += 2) this.ledger(ctx, nt.x, yOf(d), rx);
      }
    }

    // Beam position
    const stemLen = sp * 3.3;
    let beamY = 0;
    if (n >= 2) {
      const ys = notes.flatMap((nt) => nt.sp.map((s) => yOf(s.diatonic)));
      beamY = up ? Math.min(...ys) - stemLen : Math.max(...ys) + stemLen;
      beamY = up ? Math.min(beamY, yBot - 4 * sp - sp * 0.5) : Math.max(beamY, yBot + sp * 0.5);
    }

    for (const nt of notes) {
      const col = colorFor(nt);
      ctx.save();
      if (nt.sounding && !fr.reduce) { ctx.shadowColor = color; ctx.shadowBlur = 16 * nt.flash + 4; }
      for (const s of nt.sp) {
        const y = yOf(s.diatonic);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.ellipse(nt.x, y, rx, ry, -0.35, 0, Math.PI * 2);
        if (n === 1 || gap) { ctx.lineWidth = 1.6; ctx.stroke(); } else ctx.fill();
        if (s.acc) {
          ctx.font = `${sp * 2.1}px ${pal.fontMusic}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.acc > 0 ? '♯' : '♭', nt.x - rx - 2, y - (s.acc < 0 ? sp * 0.35 : 0));
        }
      }
      ctx.restore();
      if (n >= 2) {
        const ys = nt.sp.map((s) => yOf(s.diatonic));
        const sx = up ? nt.x + rx - 0.8 : nt.x - rx + 0.8;
        const from = up ? Math.max(...ys) : Math.min(...ys);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sx, from);
        ctx.lineTo(sx, beamY);
        ctx.stroke();
      }
    }

    if (n >= 2) {
      const xa = up ? notes[0].x + rx - 0.8 : notes[0].x - rx + 0.8;
      const xb = up ? notes[n - 1].x + rx - 0.8 : notes[n - 1].x - rx + 0.8;
      ctx.fillStyle = rgba(pal.text, engaged ? 0.9 : 0.6);
      const th = sp * 0.48;
      ctx.fillRect(xa - 0.7, up ? beamY : beamY - th, xb - xa + 1.4, th);
      if (![2, 4, 8].includes(n)) {
        ctx.font = `italic 700 ${sp * 1.35}px ${pal.fontDisplay}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(String(n), (xa + xb) / 2, up ? beamY - sp * 1.1 : beamY + sp * 1.1);
      }
    }

    // Fingering
    if (fr.cfg.showFingers) {
      const isTreble = hand === 'R';
      const staffTop = yBot - 4 * sp;
      ctx.font = `700 ${clamp(sp * 1.25, 10, 15)}px ${pal.fontUi}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const nt of notes) {
        const ys = nt.sp.map((s) => yOf(s.diatonic));
        let y;
        if (isTreble) {
          y = Math.min(staffTop - sp * 1.4, Math.min(...ys) - sp * 1.6, up && n >= 2 ? beamY - sp * (![2, 4, 8].includes(n) ? 2.4 : 1.2) : Infinity);
        } else {
          y = Math.max(yBot + sp * 1.4, Math.max(...ys) + sp * 1.6, !up && n >= 2 ? beamY + sp * (![2, 4, 8].includes(n) ? 2.4 : 1.2) : -Infinity);
        }
        ctx.fillStyle = nt.sounding ? color : pal.text2;
        const fs = [...nt.note.fingers].sort((a, b) => (isTreble ? b - a : a - b));
        fs.forEach((f, j) => ctx.fillText(String(f), nt.x, y + (isTreble ? -j : j) * sp * 1.25));
      }
    }
  }

  ledger(ctx, x, y, rx) {
    ctx.beginPath();
    ctx.moveTo(x - rx * 1.6, Math.round(y) + 0.5);
    ctx.lineTo(x + rx * 1.6, Math.round(y) + 0.5);
    ctx.stroke();
  }
}
