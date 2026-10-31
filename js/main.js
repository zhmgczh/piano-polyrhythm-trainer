// App controller: settings UI, transport, input, scoring, rendering and dialogs.

import { t, setLang, getLang, detectLang, applyI18n, numWord } from './i18n.js';
import {
  loadSettings, saveSettings, defaultSettings, sanitize, loadProgress, saveProgress, clearProgress,
  loadUi, saveUi, buildShareUrl, applyHash, loadPresets, savePresets,
} from './store.js';
import {
  PRESETS, PATTERNS, PATTERN_GROUPS, isPattern, KEY_LABELS, positions, keyboardRange, noteAt, syllables,
  lcm, composite, cycleSeconds, playsHand, noteName, usesFlats,
} from './rhythm.js';
import { AudioEngine } from './audio.js';
import { Transport } from './transport.js';
import { Scorer, HIT_TYPES } from './scoring.js';
import { InputManager } from './input.js';
import { readPalette, clamp, fitCanvas, rgba, mix } from './views/draw.js';
import { PianoView } from './views/piano.js';
import { OrbitView } from './views/orbit.js';
import { TimelineView } from './views/timeline.js';
import { FallingView } from './views/falling.js';
import { NotationView } from './views/notation.js';
import { MeterView } from './views/meter.js';
import { PulseView } from './views/pulse.js';
import { LESSONS, LESSON_GROUPS, LESSON_KEYS, lessonById, nextLesson, starsFor } from './lessons.js';
import { drawHistogram, drawTrend } from './charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const MODES = ['listen', 'left', 'both', 'right'];
const VIEWS = ['pulse', 'orbit', 'timeline', 'falling', 'score'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const S = loadSettings();
if (applyHash(S)) history.replaceState(null, '', location.pathname + location.search);
if (!isPattern(S.lhPattern)) S.lhPattern = 'up';
if (!isPattern(S.rhPattern)) S.rhPattern = 'up';
if (!['piano', 'epiano', 'marimba', 'woodblock'].includes(S.instrument)) S.instrument = 'piano';
if (S.lhOctave >= S.rhOctave) S.lhOctave = S.rhOctave - 1;
S.seed = (Math.random() * 1e9) | 0;

let progress = loadProgress();
const uiState = loadUi();
let pal = null;
let posMap = positions(S);
let sylList = [];
let activeLesson = null;
let lessonBackup = null;
let session = null;
let lastResult = null;

const audio = new AudioEngine();
const scorer = new Scorer();
const transport = new Transport(audio, {
  getCfg: () => S,
  onCycle: (k, tr) => onCycle(k, tr),
  onNote: (ev) => scorer.register(ev),
});

const views = {
  pulse: new PulseView($('#stage-canvas')),
  orbit: new OrbitView($('#stage-canvas')),
  timeline: new TimelineView($('#stage-canvas')),
  falling: new FallingView($('#stage-canvas')),
  score: new NotationView($('#stage-canvas')),
};
const piano = new PianoView($('#piano-canvas'));
const meter = new MeterView($('#meter-canvas'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getPath = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
function setPath(path, v) {
  const keys = path.split('.');
  let o = S;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = v;
}

const ratioHtml = (L, R) => `<span class="cl">${L}</span><span class="cx">:</span><span class="cr">${R}</span>`;
const againstText = (L, R) => t('rhythm.against', { l: numWord(L), r: numWord(R) });
const modeName = (m) => t(`mode.name.${m}`);

function displayedBpm() {
  if (transport.playing) return Math.round(transport.bpm);
  return S.speed.on && !activeLesson ? S.speed.start : S.bpm;
}

function currentLimit() {
  if (activeLesson) return { type: 'c', n: activeLesson.cycles };
  const m = /^([cm])(\d+)$/.exec(S.limit);
  return m ? { type: m[1], n: Number(m[2]) } : null;
}

function splitPoint() {
  if (S.midiSplit) return S.midiSplit;
  const maxL = Math.max(...posMap.L.slice(1));
  const minR = Math.min(...posMap.R.slice(1));
  return minR > maxL ? Math.floor((maxL + minR) / 2) + 1 : 60;
}

function handForMidi(midi) {
  for (const hand of ['L', 'R']) {
    const f = posMap[hand].indexOf(midi);
    if (f >= 1) return { hand, finger: f };
  }
  return { hand: midi < splitPoint() ? 'L' : 'R', finger: null };
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function audioOpts() {
  return { master: S.masterVol, reverb: S.reverb, stereo: S.stereo, cuePan: S.cue.pan };
}

// ---------------------------------------------------------------------------
// Theme & language
// ---------------------------------------------------------------------------

const mqLight = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const th = S.theme === 'auto' ? (mqLight.matches ? 'light' : 'dark') : S.theme;
  document.documentElement.dataset.theme = th;
  $('meta[name="theme-color"]').setAttribute('content', th === 'light' ? '#f2f0ea' : '#090b13');
  pal = readPalette();
}
mqLight.addEventListener?.('change', () => { if (S.theme === 'auto') applyTheme(); });

function applyLanguage() {
  setLang(S.lang === 'auto' ? detectLang() : S.lang);
  applyI18n();
  buildSelects();
  buildPresets();
  rebuildRhythmUi();
  refreshControls();
  updateLamps(true);
  updateLessonBanner();
  if ($('#dlg-lessons').open) renderLessons();
  if ($('#dlg-progress').open) renderProgress();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function buildSelects() {
  const keySel = $('#in-key');
  keySel.innerHTML = KEY_LABELS.map((n, i) => `<option value="${i}">${n}</option>`).join('');

  for (const sel of $$('.pattern-select')) {
    sel.innerHTML = PATTERN_GROUPS.map((g) => {
      const opts = PATTERNS.filter((p) => p.group === g).map((p) => `<option value="${p.id}">${t(`pat.${p.id}`)}</option>`).join('');
      return g === 'custom' ? opts : `<optgroup label="${t(`pat.group.${g}`)}">${opts}</optgroup>`;
    }).join('');
  }

  $('#in-countin').innerHTML = [0, 1, 2, 3, 4, 6, 8].map((n) => `<option value="${n}">${n ? t('practice.cycles', { n }) : t('practice.off')}</option>`).join('');

  const limits = ['none', 'c8', 'c16', 'c32', 'c64', 'm2', 'm5', 'm10', 'm20'];
  $('#in-limit').innerHTML = limits.map((v) => {
    const label = v === 'none' ? t('limit.none') : v[0] === 'c' ? t('limit.cycles', { n: v.slice(1) }) : t('limit.minutes', { n: v.slice(1) });
    return `<option value="${v}">${label}</option>`;
  }).join('');

  $('#in-msub').innerHTML = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}">÷${n} · ${t(`metro.subName${n}`)}</option>`).join('');

  const split = [`<option value="0">${t('settings.midiAuto')}</option>`];
  for (let m = 36; m <= 84; m++) split.push(`<option value="${m}">${noteName(m, false, S.noteNames)}</option>`);
  $('#in-split').innerHTML = split.join('');
}

function buildPresets() {
  $('#presets').innerHTML = PRESETS.map(([l, r]) => `<button type="button" class="chip" data-l="${l}" data-r="${r}" title="${againstText(l, r)}"><span class="cl">${l}</span><span class="cx">:</span><span class="cr">${r}</span></button>`).join('');
}

const FMT = {
  pct: (v) => `${Math.round(v * 100)}%`,
  ms: (v) => `${v > 0 ? '+' : ''}${v} ms`,
  cycles: (v) => t('unit.cycles', { n: v }),
  pct100: (v) => `${v}%`,
};

function setRangeFill(el) {
  const min = Number(el.min) || 0, max = Number(el.max) || 100;
  el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
}

function refreshControls(except) {
  for (const el of $$('[data-bind]')) {
    const path = el.dataset.bind;
    const v = getPath(path);
    if (el.classList.contains('seg')) {
      for (const b of el.querySelectorAll('button[data-value]')) {
        const on = b.dataset.value === String(v);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on);
      }
      continue;
    }
    if (el === except) { if (el.type === 'range') setRangeFill(el); continue; }
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
    if (el.type === 'range') setRangeFill(el);
  }
  for (const out of $$('output[data-out]')) {
    const path = out.dataset.out;
    const src = $(`[data-bind="${path}"]`);
    const fmt = FMT[src?.dataset.fmt] || ((x) => x);
    out.textContent = fmt(getPath(path));
  }
  for (const el of $$('[data-show]')) el.hidden = !getPath(el.dataset.show);
  for (const el of $$('[data-show-eq]')) {
    const [path, val] = el.dataset.showEq.split(':');
    el.hidden = String(getPath(path)) !== val;
  }
  renderBeatEditor();
  const sigNow = SIG_ORDER.find((k) => SIGS[k] === S.metro.pattern.join(''));
  for (const c of $$('#sig-presets .chip')) c.classList.toggle('is-on', c.dataset.sig === sigNow);
  renderPresets();
  const mt = $('#btn-metro');
  mt.classList.toggle('is-on', S.metro.on);
  mt.setAttribute('aria-pressed', S.metro.on);
  const ab = $('#btn-accomp');
  ab.classList.toggle('is-on', S.accomp);
  ab.classList.toggle('is-na', S.playMode === 'listen' || S.playMode === 'both');
  ab.setAttribute('aria-pressed', S.accomp);
  const ct = $('#btn-cue');
  ct.classList.toggle('is-on', S.cue.on);
  ct.setAttribute('aria-pressed', S.cue.on);

  for (const [id, key] of [['#in-left', 'left'], ['#in-right', 'right']]) {
    const el = $(id);
    if (document.activeElement !== el) el.value = S[key];
  }
  $('#out-lhOctave').textContent = S.lhOctave;
  $('#out-rhOctave').textContent = S.rhOctave;
  $('[data-bind="lhCustom"]').hidden = S.lhPattern !== 'custom';
  $('[data-bind="rhCustom"]').hidden = S.rhPattern !== 'custom';

  for (const c of $$('#presets .chip')) c.classList.toggle('is-on', Number(c.dataset.l) === S.left && Number(c.dataset.r) === S.right);
  for (const b of $$('#lang-seg button')) b.classList.toggle('is-on', b.dataset.lang === getLang());
  for (const b of $$('#hand-switch button')) {
    const on = b.dataset.mode === S.playMode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on);
  }
  for (const b of $$('#view-tabs button')) {
    const on = b.dataset.view === S.view;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on);
  }
  refreshTempo();
  document.body.classList.toggle('reduce-motion', S.reduceMotion);
}

function refreshTempo() {
  const bpm = displayedBpm();
  const unit = t(`tempo.unit.${S.tempoRef}`);
  for (const el of [$('#tb-bpm'), $('#in-bpm-num')]) if (document.activeElement !== el) el.value = bpm;
  $('#tb-bpm-unit').textContent = unit;
  $('#bpm-unit').textContent = unit;
  const slider = $('#in-bpm');
  if (document.activeElement !== slider) slider.value = bpm;
  setRangeFill(slider);
  const cyc = cycleSeconds(S.tempoRef, bpm, S.left, S.right);
  $('#tempo-info').textContent = t('tempo.info', {
    cycle: cyc.toFixed(2),
    L: S.left,
    R: S.right,
    l: Math.round((S.left * 60) / cyc),
    r: Math.round((S.right * 60) / cyc),
  });
}

function rebuildRhythmUi() {
  const L = S.left, R = S.right;
  sylList = syllables(L, R, getLang());
  const g = lcm(L, R);
  sylList.forEach((s, i) => { s.span = ((sylList[i + 1]?.step ?? g) - s.step); });
  $('#mnemonic').innerHTML = sylList.map((s, i) => `<span class="syl s-${s.who}" data-i="${i}">${s.text}</span>`).join('');
  $('#ratio-info').textContent = t('rhythm.info', { grid: g, comp: composite(L, R).length });
  $('#hud-ratio').innerHTML = `${ratioHtml(L, R)} <small style="font-size:13px;color:var(--text-3);font-family:var(--font-ui);font-weight:500;margin-left:6px">${againstText(L, R)}</small>`;
  lastSylIdx = -1;
  $('#metro-explain').textContent = t('metro.explain', { l: numWord(L), r: numWord(R) });
  const sd = [['both', `÷${L} + ÷${R}`], ['L', `÷${L}`], ['R', `÷${R}`], ['grid', `÷${g}`], ['n', '÷n']];
  $('#subdiv-grid').innerHTML = sd.map(([v, big]) => `<button type="button" data-value="${v}" class="sd-${v}"><b>${big}</b><small>${t(`metro.sd.${v}`)}</small></button>`).join('');
}

const LEVEL_CYCLE = { A: 'N', N: 'S', S: 'M', M: 'A' };
// Accent on each group's first beat (5/4 = 3+2, 7/8 = 2+2+3, compound meters in threes); every other beat at normal level.
const SIGS = { '1/4': 'A', '2/4': 'AN', '3/4': 'ANN', '4/4': 'ANNN', '5/4': 'ANNAN', '6/8': 'ANNANN', '7/8': 'ANANANN', '9/8': 'ANNANNANN', '12/8': 'ANNANNANNANN' };
const SIG_ORDER = Object.keys(SIGS);
const TEMPO_TERMS = [[40, 'grave'], [60, 'largo'], [66, 'larghetto'], [76, 'adagio'], [108, 'andante'], [120, 'moderato'], [168, 'allegro'], [177, 'vivace'], [200, 'presto'], [Infinity, 'prestissimo']];
const tempoTerm = (bpm) => t(`term.${TEMPO_TERMS.find(([lim]) => bpm < lim)[1]}`);
const PRESET_FIELDS = ['left', 'right', 'bpm', 'tempoRef', 'playMode', 'key', 'scale', 'lhOctave', 'rhOctave', 'lhPattern', 'rhPattern', 'lhCustom', 'rhCustom',
  'instrument', 'lhVol', 'rhVol', 'guideVol', 'accomp', 'metroVol', 'metro', 'cue', 'speed', 'gap', 'countIn', 'limit', 'strict'];
let presets = loadPresets();

function renderPresets() {
  const ul = $('#preset-list');
  const sig = presets.map((p) => p.name).join('|') + getLang();
  if (ul.dataset.sig === sig) return;
  ul.dataset.sig = sig;
  ul.innerHTML = presets.map((p, i) => `<li><button type="button" class="preset-load" data-i="${i}"><b></b><small>${p.data.left}:${p.data.right} · ${p.data.bpm}</small></button><button type="button" class="preset-del" data-del="${i}" aria-label="${t('presets.delete')}" title="${t('presets.delete')}"><svg><use href="#i-close"/></svg></button></li>`).join('');
  ul.querySelectorAll('.preset-load b').forEach((b, i) => { b.textContent = presets[i].name; });
}

function savePreset() {
  const input = $('#preset-name');
  const name = input.value.trim() || `${S.left}:${S.right} · ${displayedBpm()} ${t(`tempo.unit.${S.tempoRef}`)}`;
  const data = {};
  for (const k of PRESET_FIELDS) data[k] = JSON.parse(JSON.stringify(S[k]));
  presets = presets.filter((p) => p.name !== name);
  presets.push({ name, at: Date.now(), data });
  savePresets(presets);
  input.value = '';
  renderPresets();
  toast(t('presets.saved', { name }));
}

function loadPreset(i) {
  const p = presets[i];
  if (!p) return;
  for (const k of PRESET_FIELDS) if (k in p.data) S[k] = JSON.parse(JSON.stringify(p.data[k]));
  sanitize(S);
  saveSettings(S);
  posMap = positions(S);
  transport.refreshPositions();
  if (transport.playing) transport.setBpm(S.speed.on ? displayedBpm() : S.bpm);
  audio.apply(audioOpts());
  rebuildRhythmUi();
  onModeChanged();
  relayout();
  refreshControls();
  toast(t('presets.loaded', { name: p.name }));
}

let pendulumCtx = null;
function drawPendulum(fr) {
  const cv = $('#pendulum-canvas');
  if (!cv.offsetParent) return;
  const { w, h, dpr } = fitCanvas(cv);
  const ctx = pendulumCtx || (pendulumCtx = cv.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const M = S.metro;
  // Main (non-subdivided) clicks of the current cycle drive the pendulum.
  let angle = 0, flash = 0, beatText = '–';
  const playing = fr.playing && fr.pos >= 0;
  if (playing) {
    const k = Math.floor(fr.pos), phase = fr.pos - k;
    angle = (k % 2 ? 1 : -1) * 0.42 * Math.cos(Math.PI * phase);
    flash = clamp(1 - (phase * fr.dur) / 0.18, 0, 1);
    beatText = `${(((k % M.beats) + M.beats) % M.beats) + 1} / ${M.beats}`;
  }
  const cx = w / 2, base = h - 6, top = 8;
  const body = ctx.createLinearGradient(0, top, 0, base);
  body.addColorStop(0, pal.dark ? '#6b4423' : '#9a6a3c');
  body.addColorStop(1, pal.dark ? '#3e2613' : '#6e4625');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.12, top);
  ctx.lineTo(cx + w * 0.12, top);
  ctx.lineTo(cx + w * 0.34, base);
  ctx.lineTo(cx - w * 0.34, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.25);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.07, top + 6);
  ctx.lineTo(cx + w * 0.07, top + 6);
  ctx.lineTo(cx + w * 0.16, base - 14);
  ctx.lineTo(cx - w * 0.16, base - 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#f5e6c8', 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const y = top + 12 + i * ((base - top - 30) / 6);
    ctx.beginPath();
    ctx.moveTo(cx - 3, y);
    ctx.lineTo(cx + 3, y);
    ctx.stroke();
  }
  const pivot = { x: cx, y: base - 14 };
  const len = base - top - 8;
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(angle);
  ctx.strokeStyle = '#d9dce6';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len);
  ctx.stroke();
  const wy = -len * 0.62;
  if (flash > 0 && !fr.reduce) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 14 * flash; }
  ctx.fillStyle = flash > 0 ? mix(pal.accent, '#ffffff', 0.4 * flash) : pal.accent;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-7, wy - 6, 14, 12, 3) : ctx.rect(-7, wy - 6, 14, 12);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c9b48a';
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  const pb = $('#pr-beat');
  if (pb.textContent !== beatText) pb.textContent = beatText;
  const term = `${tempoTerm(displayedBpm())} · ${displayedBpm()} ${t(`tempo.unit.${S.tempoRef}`)}`;
  const pt = $('#pr-term');
  if (pt.textContent !== term) pt.textContent = term;
}
let lastBeatNow = -1;

function renderBeatEditor() {
  const M = S.metro;
  const ed = $('#beat-editor');
  const sig = `${M.beats}|${M.pattern.join('')}|${getLang()}`;
  if (ed.dataset.sig === sig) return;
  ed.dataset.sig = sig;
  ed.innerHTML = M.pattern.map((lv, i) => {
    return `<button type="button" class="beat lvl-${lv}" data-beat="${i}" title="${t(`metro.lvl.${lv}`)}"><b>${i + 1}</b></button>`;
  }).join('');
  lastBeatNow = -1;
}

function applyMetroPreset(name) {
  const n = S.metro.beats;
  const p = Array.from({ length: n }, (_, i) => {
    switch (name) {
      case 'even': return 'N';
      case 'alt': return i % 2 === 0 ? 'A' : 'N';
      case 'back': return i % 2 === 1 ? 'A' : 'N';
      case 'last': return i === n - 1 ? 'A' : 'M';
      default: return i === 0 ? 'A' : 'N';
    }
  });
  update('metro.pattern', p);
}

function highlightBeat(fr) {
  const M = S.metro;
  let idx = -1;
  if (fr.playing && fr.pos >= 0) idx = ((Math.floor(fr.pos) % M.beats) + M.beats) % M.beats;
  if (idx === lastBeatNow) return;
  lastBeatNow = idx;
  $$('#beat-editor .beat').forEach((b, i) => b.classList.toggle('is-now', i === idx));
}

function relayout() {
  const wrap = $('.piano-wrap');
  const w = wrap.clientWidth;
  if (!w) return;
  const height = piano.layout(w, keyboardRange(S));
  $('#piano-canvas').style.height = `${height}px`;
}

function onSettingChange(path) {
  switch (path) {
    case 'left': case 'right':
      rebuildRhythmUi();
      break;
    case 'tempoRef':
      break;
    case 'playMode': case 'accomp':
      onModeChanged();
      break;
    case 'key': case 'scale': case 'lhOctave': case 'rhOctave':
      posMap = positions(S);
      transport.refreshPositions();
      relayout();
      break;
    case 'masterVol': case 'reverb': case 'stereo': case 'cue.pan':
      audio.apply(audioOpts());
      break;
    case 'theme':
      applyTheme();
      break;
    case 'lang':
      applyLanguage();
      break;
    case 'noteNames':
      buildSelects();
      break;
    default:
  }
}

function update(path, value, srcEl) {
  setPath(path, value);
  sanitize(S);
  saveSettings(S);
  onSettingChange(path);
  refreshControls(srcEl);
}

function bindControls() {
  for (const el of $$('[data-bind]')) {
    const path = el.dataset.bind;
    if (el.classList.contains('seg')) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-value]');
        if (b) update(path, b.dataset.value);
      });
      continue;
    }
    const evName = el.type === 'range' || el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evName, () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || el.type === 'number' || el.dataset.type === 'number') {
        v = Number(el.value);
        if (!Number.isFinite(v)) return;
      } else v = el.value;
      update(path, v, el);
    });
  }

  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const path = b.dataset.step;
    const delta = Number(b.dataset.delta);
    const v = getPath(path) + delta;
    if (path === 'lhOctave' && v >= S.rhOctave) { if (S.rhOctave < 6) { S.rhOctave++; } else return; }
    if (path === 'rhOctave' && v <= S.lhOctave) { if (S.lhOctave > 1) { S.lhOctave--; } else return; }
    update(path, v);
    if (path === 'lhOctave' || path === 'rhOctave') onSettingChange('key');
  }));

  $('#presets').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    S.left = Number(c.dataset.l);
    update('right', Number(c.dataset.r));
  });

  $('#btn-swap').addEventListener('click', () => {
    [S.left, S.right] = [S.right, S.left];
    update('left', S.left);
  });

  $('#in-bpm').addEventListener('input', (e) => setTempo(Number(e.target.value)));
  for (const el of [$('#tb-bpm'), $('#in-bpm-num')]) {
    el.addEventListener('change', () => { if (el.value !== '') setTempo(Number(el.value)); el.value = displayedBpm(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
    el.addEventListener('focus', () => el.select());
  }
  for (const [id, key] of [['#in-left', 'left'], ['#in-right', 'right']]) {
    const el = $(id);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (Number.isInteger(v) && v >= 1 && v <= 12) update(key, v, el);
    });
    el.addEventListener('change', () => { el.value = S[key]; });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
    el.addEventListener('focus', () => el.select());
  }
  $('#btn-bpm-down').addEventListener('click', () => setTempo(displayedBpm() - 1));
  $('#btn-bpm-up').addEventListener('click', () => setTempo(displayedBpm() + 1));
  $('#btn-tap').addEventListener('click', tapTempo);
  $('#btn-metro').addEventListener('click', () => {
    update('metro.on', !S.metro.on);
    toast(t(S.metro.on ? 'metro.onToast' : 'metro.offToast'));
  });
  $('#btn-accomp').addEventListener('click', toggleAccomp);
  $('#btn-cue').addEventListener('click', () => {
    update('cue.on', !S.cue.on);
    toast(t(S.cue.on ? 'cue.onToast' : 'cue.offToast'));
  });
  const testCue = async (hand) => {
    const ctx = await audio.resume();
    if (!ctx) return;
    audio.apply(audioOpts());
    for (let i = 0; i < 3; i++) audio.cue(audio.now + 0.05 + i * 0.22, hand, Math.max(0.4, S.cue.vol), { sound: S.cue.sound, accent: i === 0, input: true });
    flashLamp(hand, 'auto', t(hand === 'L' ? 'cue.testL' : 'cue.testR'), '', 0.8);
  };
  $('#btn-cue-test').addEventListener('click', () => testCue('L'));
  $('#btn-cue-test-r').addEventListener('click', () => testCue('R'));
  $('#beat-editor').addEventListener('click', (e) => {
    const b = e.target.closest('[data-beat]');
    if (!b) return;
    const p = [...S.metro.pattern];
    const i = Number(b.dataset.beat);
    p[i] = LEVEL_CYCLE[p[i]] || 'N';
    update('metro.pattern', p);
  });
  $('#sig-presets').addEventListener('click', (e) => {
    const c = e.target.closest('[data-sig]');
    if (!c) return;
    const pat = [...SIGS[c.dataset.sig]];
    S.metro.beats = pat.length;
    update('metro.pattern', pat);
  });
  $('#btn-preset-save').addEventListener('click', savePreset);
  $('#preset-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); });
  $('#preset-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      presets.splice(Number(del.dataset.del), 1);
      savePresets(presets);
      renderPresets();
      return;
    }
    const ld = e.target.closest('[data-i]');
    if (ld) loadPreset(Number(ld.dataset.i));
  });
  $('#metro-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mpreset]');
    if (b) applyMetroPreset(b.dataset.mpreset);
  });

  $('#hand-switch').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#view-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) update('view', b.dataset.view);
  });
  $('#lang-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) update('lang', b.dataset.lang);
  });

  $('#btn-play').addEventListener('click', () => togglePlay());
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    update('theme', cur === 'dark' ? 'light' : 'dark');
  });
  $('#btn-share').addEventListener('click', shareLink);
  $('#btn-focus').addEventListener('click', toggleFocus);
  $('#btn-settings').addEventListener('click', () => openDialog('#dlg-settings'));
  $('#btn-help').addEventListener('click', () => openDialog('#dlg-help'));
  $('#btn-lessons').addEventListener('click', () => { renderLessons(); openDialog('#dlg-lessons'); });
  $('#btn-progress').addEventListener('click', () => { openDialog('#dlg-progress'); renderProgress(); });
  $('#btn-exit-lesson').addEventListener('click', exitLesson);
  $('#btn-midi').addEventListener('click', () => input.connectMidi());
  $('#in-midi').addEventListener('change', (e) => input.setMidiInput(e.target.value));
  $('#btn-reset-settings').addEventListener('click', () => {
    if (!confirm(t('settings.confirmReset'))) return;
    const d = defaultSettings();
    for (const k of Object.keys(d)) S[k] = d[k];
    S.seed = (Math.random() * 1e9) | 0;
    saveSettings(S);
    posMap = positions(S);
    transport.refreshPositions();
    applyTheme();
    applyLanguage();
    audio.apply(audioOpts());
    relayout();
  });
  $('#btn-calibrate').addEventListener('click', () => openDialog('#dlg-calibrate'));
  $('#btn-cal-start').addEventListener('click', startCalibration);
  $('#btn-cal-apply').addEventListener('click', applyCalibration);
  $('#cal-pad').addEventListener('pointerdown', (e) => { e.preventDefault(); calTap(e.timeStamp); });
  $('#btn-retry').addEventListener('click', () => {
    $('#dlg-results').close();
    if (lastResult?.lesson) startLesson(lastResult.lesson);
    else play();
  });
  $('#btn-next-lesson').addEventListener('click', () => {
    $('#dlg-results').close();
    const nx = lastResult?.lesson && nextLesson(lastResult.lesson.id);
    if (nx) startLesson(nx);
  });

  for (const dlg of $$('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('close', () => { if (dlg.id === 'dlg-calibrate') cancelCalibration(); });
  }

  // Remember which sidebar sections are open.
  for (const d of $$('details[data-section]')) {
    const key = d.dataset.section;
    if (uiState.open && key in uiState.open) d.open = uiState.open[key];
    d.addEventListener('toggle', () => {
      uiState.open = uiState.open || {};
      uiState.open[key] = d.open;
      saveUi(uiState);
    });
  }
}

function openDialog(sel) {
  const d = $(sel);
  if (!d.open) d.showModal();
}

function setTempo(v) {
  if (!Number.isFinite(v)) return;
  const bpm = clamp(Math.round(v), 5, 300);
  if (transport.playing) {
    transport.setBpm(bpm);
    if (session) session.bpmMax = Math.max(session.bpmMax, bpm);
    if (!S.speed.on || activeLesson) S.bpm = bpm;
  } else if (S.speed.on && !activeLesson) S.speed.start = bpm;
  else S.bpm = bpm;
  saveSettings(S);
  refreshControls();
}

let taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 6) taps.shift();
  const btn = $('#btn-tap');
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 120);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setTempo(60000 / avg);
  }
}

function toggleAccomp() {
  update('accomp', !S.accomp);
  toast(t(S.accomp ? 'accomp.onToast' : 'accomp.offToast'));
}

function setMode(m) {
  if (!MODES.includes(m)) return;
  update('playMode', m);
}

function onModeChanged() {
  scorer.setActive(S.playMode);
  if (session) session.modes.add(S.playMode);
  updateLamps(true);
}

// ---------------------------------------------------------------------------
// Playback & sessions
// ---------------------------------------------------------------------------

async function togglePlay() {
  if (transport.playing) stop('user');
  else await play();
}

async function play() {
  if (transport.playing) return;
  const ctx = await audio.resume();
  if (!ctx) { toast(t('audio.unsupported')); return; }
  audio.apply(audioOpts());
  scorer.reset();
  scorer.setActive(S.playMode);
  posMap = positions(S);
  const bpm = S.speed.on && !activeLesson ? S.speed.start : S.bpm;
  transport.start(bpm);
  session = {
    startPerf: performance.now(),
    modes: new Set([S.playMode]),
    bpmStart: bpm, bpmMax: bpm,
    L: S.left, R: S.right, ref: S.tempoRef,
    lesson: activeLesson,
    lastPos: 0,
  };
  lastCycleSeen = -99;
  lastCount = null;
  resetLamps();
  setPlayingUi(true);
  requestWake();
}

function stop(reason = 'user') {
  if (!transport.playing) return;
  transport.stop(reason === 'complete');
  setPlayingUi(false);
  releaseWake();
  $('#countdown').classList.remove('show');
  endSession(reason);
}

function setPlayingUi(on) {
  const b = $('#btn-play');
  b.classList.toggle('is-playing', on);
  b.setAttribute('aria-pressed', on);
  b.querySelector('.sr-only').textContent = t(on ? 'transport.stop' : 'transport.play');
  document.body.classList.toggle('is-playing-app', on);
  updateLamps(true);
  refreshTempo();
}

function onCycle(k, tr) {
  if (session) session.cycles = k;
  const lim = currentLimit();
  if (lim) {
    if (lim.type === 'c' && k >= lim.n) return { stop: true };
    if (lim.type === 'm' && audio.now - tr.startTime >= lim.n * 60) return { stop: true };
  }
  const res = {};
  const sp = S.speed;
  if (sp.on && !activeLesson && k > 0 && k % sp.every === 0 && tr.bpm < sp.target) {
    let ok = true;
    if (S.playMode !== 'listen') {
      const acc = scorer.cycleAccuracy(k - sp.every, k - 1);
      ok = acc != null && acc * 100 >= sp.threshold;
    }
    if (ok) {
      const nb = Math.min(sp.target, Math.round(tr.bpm) + sp.step);
      res.bpm = nb;
      if (session) session.bpmMax = Math.max(session.bpmMax, nb);
      const delay = Math.max(0, (tr.tl.timeAt(k) - audio.now) * 1000);
      setTimeout(() => {
        toast(nb >= sp.target ? t('toast.reached', { bpm: nb }) : t('toast.speedUp', { bpm: nb }));
        refreshTempo();
      }, delay);
    }
  }
  return res;
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endSession(reason) {
  const s = session;
  session = null;
  if (!s) return;
  const seconds = (performance.now() - s.startPerf) / 1000;
  progress.totalSeconds += seconds;
  const day = todayKey();
  if (seconds > 5 && progress.days[progress.days.length - 1] !== day) progress.days.push(day);

  const sum = scorer.summary();
  const cycles = reason === 'complete' && s.cycles != null ? s.cycles : Math.max(0, Math.floor(s.lastPos));
  const practiced = sum.total >= 6 && [...s.modes].some((m) => m !== 'listen');
  const mode = s.modes.size > 1 ? 'mixed' : [...s.modes][0];
  const info = { reason, cycles, mode, bpm: s.bpmMax, L: s.L, R: s.R, ref: s.ref, lesson: s.lesson, seconds };

  if (s.lesson && reason === 'complete') {
    const l = s.lesson;
    const listenOnly = !l.goal;
    const acc = sum.accuracy ?? 0;
    const stars = listenOnly ? 3 : starsFor(l, acc);
    const prev = progress.lessons[l.id] || { stars: 0, best: 0 };
    progress.lessons[l.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, listenOnly ? 1 : acc), at: Date.now() };
    info.stars = stars;
    info.passed = stars > 0;
    info.listenOnly = listenOnly;
  }

  if (practiced) {
    progress.sessions.push({
      at: Date.now(), L: s.L, R: s.R, bpm: s.bpmMax, ref: s.ref,
      cpm: Math.round(60 / cycleSeconds(s.ref, s.bpmMax, s.L, s.R)),
      mode, acc: sum.accuracy, cycles, seconds: Math.round(seconds),
      counts: sum.counts, lesson: s.lesson?.id || null,
      meanL: sum.L.mean, meanR: sum.R.mean, sdL: sum.L.sd, sdR: sum.R.sd,
    });
  }
  saveProgress(progress);
  if (practiced || (s.lesson && reason === 'complete')) showResults(sum, info);
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

function lessonTitle(l) {
  return `${againstText(l.L, l.R)} · ${t(`lessons.step.${l.step}`)}`;
}

function lessonGoalText(l) {
  return l.goal ? t('lessons.goal', { acc: l.goal, n: l.cycles }) : t('lessons.listenGoal', { n: l.cycles });
}

function starsHtml(n, size = '') {
  return `<span class="stars ${size}">${[0, 1, 2].map((i) => `<svg class="${i < n ? 'on' : ''}"><use href="#i-star"/></svg>`).join('')}</span>`;
}

function renderLessons() {
  const body = $('#lessons-body');
  const levels = [1, 2, 3];
  let num = 0;
  const html = [];
  for (const g of LESSON_GROUPS) {
    const ls = LESSONS.filter((l) => l.L === g.L && l.R === g.R);
    const levelLabel = t(`lessons.level${g.level}`);
    html.push(`<section class="lesson-group"><h3><span class="ratio">${ratioHtml(g.L, g.R)}</span> ${againstText(g.L, g.R)} <small>· ${levelLabel}</small></h3><div class="lesson-list">`);
    for (const l of ls) {
      num++;
      const p = progress.lessons[l.id];
      const modeTag = l.cfg.playMode === 'listen' ? `<span class="tag">${t('mode.listen')}</span>`
        : l.cfg.playMode === 'left' ? `<span class="tag t-l">${t('mode.left')}</span>`
          : l.cfg.playMode === 'right' ? `<span class="tag t-r">${t('mode.right')}</span>`
            : `<span class="tag t-b">${t('mode.both')}</span>`;
      html.push(`<button type="button" class="lesson-card ${p?.stars ? 'is-done' : ''}" data-lesson="${l.id}">
        <div class="lc-top"><span class="lc-num">${String(num).padStart(2, '0')}</span>${starsHtml(p?.stars || 0)}</div>
        <div class="lc-title">${t(`lessons.step.${l.step}`)}</div>
        <div class="lc-desc">${t(`lessons.desc.${l.step}`, { l: numWord(l.L), r: numWord(l.R) })}</div>
        <div class="lc-meta">${modeTag}<span class="tag">${l.cfg.bpm} ${t('tempo.unit.cycle')}</span><span class="tag">${lessonGoalText(l)}</span></div>
      </button>`);
    }
    html.push('</div></section>');
  }
  void levels;
  body.innerHTML = `<div class="lesson-groups">${html.join('')}</div>`;
  body.onclick = (e) => {
    const c = e.target.closest('[data-lesson]');
    if (!c) return;
    $('#dlg-lessons').close();
    startLesson(lessonById(c.dataset.lesson));
  };
}

function startLesson(l) {
  if (!l) return;
  if (transport.playing) stop('user');
  if (!activeLesson) {
    lessonBackup = {};
    for (const k of LESSON_KEYS) lessonBackup[k] = JSON.parse(JSON.stringify(S[k]));
  }
  activeLesson = l;
  for (const [k, v] of Object.entries(l.cfg)) S[k] = JSON.parse(JSON.stringify(v));
  S.speed = { ...S.speed, on: false };
  sanitize(S);
  saveSettings(S);
  onSettingChange('left');
  onModeChanged();
  refreshControls();
  updateLessonBanner();
  setTimeout(() => play(), 150);
}

function exitLesson() {
  if (transport.playing) stop('user');
  if (lessonBackup) for (const [k, v] of Object.entries(lessonBackup)) S[k] = v;
  lessonBackup = null;
  activeLesson = null;
  sanitize(S);
  saveSettings(S);
  rebuildRhythmUi();
  onModeChanged();
  refreshControls();
  updateLessonBanner();
}

function updateLessonBanner() {
  const b = $('#lesson-banner');
  b.hidden = !activeLesson;
  document.body.classList.toggle('lesson-active', !!activeLesson);
  if (!activeLesson) return;
  $('#lb-title').textContent = lessonTitle(activeLesson);
  $('#lb-goal').textContent = lessonGoalText(activeLesson);
}

// ---------------------------------------------------------------------------
// Results & progress
// ---------------------------------------------------------------------------

function offsetText(ms) {
  if (ms == null) return '—';
  const r = Math.round(Math.abs(ms));
  if (r < 3) return t('judge.onTime');
  return ms < 0 ? t('results.offsetEarly', { ms: r }) : t('results.offsetLate', { ms: r });
}

function buildTips(sum) {
  const tips = [];
  for (const hand of ['L', 'R']) {
    const st = sum[hand];
    const name = t(hand === 'L' ? 'hand.leftLower' : 'hand.rightLower');
    if (st.hits < 5) continue;
    if (st.mean < -15) tips.push(t('tip.early', { hand: name, ms: Math.round(-st.mean) }));
    else if (st.mean > 15) tips.push(t('tip.late', { hand: name, ms: Math.round(st.mean) }));
    if (st.sd != null && st.sd > 35) tips.push(t('tip.unsteady', { hand: name, ms: Math.round(st.sd) }));
  }
  const expected = sum.L.expected + sum.R.expected;
  if (expected && sum.counts.miss / expected > 0.2) tips.push(t('tip.misses'));
  if (sum.counts.extra > Math.max(3, sum.total * 0.1)) tips.push(t('tip.extra'));
  if (sum.counts.wrong > 2) tips.push(t('tip.wrong'));
  if ((sum.accuracy ?? 0) >= 0.92 && !tips.length) tips.push(t('tip.great'));
  if ((sum.accuracy ?? 1) < 0.6) tips.push(t('tip.slow'));
  return tips;
}

function showResults(sum, info) {
  lastResult = info;
  const l = info.lesson;
  $('#res-title').textContent = l ? t('results.lessonTitle') : t('results.title');
  $('#res-sub').textContent = (l ? `${lessonTitle(l)} · ` : '') + t('results.sub', {
    ratio: againstText(info.L, info.R),
    bpm: `${info.bpm} ${t(`tempo.unit.${info.ref}`)}`,
    cycles: info.cycles,
    mode: modeName(info.mode),
  });
  const body = $('#results-body');
  const next = l && nextLesson(l.id);
  $('#btn-next-lesson').hidden = !(l && info.passed && next);

  if (l && info.listenOnly) {
    body.innerHTML = `<div class="res-top" style="grid-template-columns:1fr;text-align:center;justify-items:center">
      <div class="res-stars">${starsHtml(3)}</div>
      <div class="res-verdict">${t('results.listenDone')}</div></div>`;
    openDialog('#dlg-results');
    return;
  }

  const acc = sum.accuracy ?? 0;
  const pct = Math.round(acc * 100);
  const C = 2 * Math.PI * 60;
  const verdict = l ? (info.passed ? t('results.passed') : t('results.failed', { goal: l.goal })) : t('results.done');
  const pill = (type, color) => `<span class="count-pill"><i style="background:${color}"></i>${t(`judge.${type}`)} <b>${sum.counts[type]}</b></span>`;
  const handCard = (hand) => {
    const st = sum[hand];
    const name = t(hand === 'L' ? 'hand.left' : 'hand.right');
    const color = hand === 'L' ? 'var(--lh)' : 'var(--rh)';
    if (!st.total) return `<div class="res-hand"><h4><i style="background:${color}"></i>${name}</h4><p class="hint">${t('results.notPlayed')}</p></div>`;
    return `<div class="res-hand"><h4><i style="background:${color}"></i>${name}</h4><dl>
      <dt>${t('results.accuracy')}</dt><dd>${Math.round((st.accuracy ?? 0) * 100)}%</dd>
      <dt>${t('results.hitRate')}</dt><dd>${st.hits} / ${st.expected}</dd>
      <dt>${t('results.mean')}</dt><dd>${offsetText(st.mean)}</dd>
      <dt>${t('results.sd')}</dt><dd>${st.sd != null ? `± ${Math.round(st.sd)} ms` : '—'}</dd>
    </dl></div>`;
  };
  const tips = buildTips(sum);
  body.innerHTML = `
    <div class="res-top">
      <div class="res-ring">
        <svg viewBox="0 0 140 140"><defs><linearGradient id="res-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.L}"/><stop offset="1" stop-color="${pal.R}"/></linearGradient></defs>
          <circle class="bg" cx="70" cy="70" r="60"/><circle class="fg" cx="70" cy="70" r="60" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - acc)}"/></svg>
        <div class="num"><div><b>${pct}%</b><small>${t('results.accuracy')}</small></div></div>
      </div>
      <div>
        ${l ? `<div class="res-stars">${starsHtml(info.stars || 0)}</div>` : ''}
        <div class="res-verdict">${verdict}</div>
        <div class="res-counts">
          ${pill('perfect', 'var(--perfect)')}${pill('great', 'var(--perfect)')}${pill('good', 'var(--good)')}
          ${pill('miss', 'var(--miss)')}${pill('extra', 'var(--miss)')}${sum.counts.wrong ? pill('wrong', 'var(--miss)') : ''}
        </div>
      </div>
    </div>
    <div class="res-hands">${handCard('L')}${handCard('R')}</div>
    <div class="res-chart">
      <h4><span>${t('results.hist')}</span><span class="legend"><span><i style="background:var(--chart-lh)"></i>${t('hand.left')}</span><span><i style="background:var(--chart-rh)"></i>${t('hand.right')}</span></span></h4>
      <div class="chart-wrap"><canvas></canvas></div>
      <p class="hint" style="text-align:center;margin-top:4px">${t('results.histAxis')}</p>
    </div>
    ${tips.length ? `<ul class="res-tips">${tips.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`;
  openDialog('#dlg-results');
  requestAnimationFrame(() => {
    drawHistogram($('.chart-wrap', body), { L: sum.L.offsets, R: sum.R.offsets }, {
      pal,
      labels: { L: t('hand.left'), R: t('hand.right') },
      tip: (hand, lo, hi, n) => t('results.histTip', { hand: t(hand === 'L' ? 'hand.left' : 'hand.right'), lo: lo > 0 ? `+${lo}` : lo, hi: hi > 0 ? `+${hi}` : hi, n: `<b>${n}</b>` }),
    });
  });
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? t('time.hm', { h, m }) : t('time.m', { m });
}

function dayStreak() {
  const set = new Set(progress.days);
  const d = new Date();
  if (!set.has(todayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderProgress() {
  const body = $('#progress-body');
  const sessions = progress.sessions.filter((s) => s.acc != null);
  const last10 = sessions.slice(-10);
  const avg = last10.length ? Math.round((last10.reduce((a, s) => a + s.acc, 0) / last10.length) * 100) : null;
  const dtf = new Intl.DateTimeFormat(getLang() === 'zh-TW' ? 'zh-TW' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const doneLessons = LESSONS.filter((l) => progress.lessons[l.id]?.stars).length;

  const tiles = `<div class="stat-tiles">
    <div class="tile"><span>${t('progress.time')}</span><b>${fmtDuration(progress.totalSeconds)}</b></div>
    <div class="tile"><span>${t('progress.sessions')}</span><b>${sessions.length}</b></div>
    <div class="tile"><span>${t('progress.avg')}</span><b>${avg == null ? '—' : `${avg}%`}</b></div>
    <div class="tile"><span>${t('progress.streak')}</span><b>${t('progress.dayUnit', { n: dayStreak() })}</b></div>
  </div>`;

  if (!sessions.length) {
    body.innerHTML = `${tiles}<div class="panel"><p class="empty">${t('progress.empty')}</p></div>
      <div class="prog-actions"><span class="hint" style="margin-right:auto">${t('progress.lessons')}: ${t('progress.lessonsDone', { n: doneLessons, total: LESSONS.length })}</span></div>`;
    return;
  }

  const best = new Map();
  for (const s of sessions) {
    const key = `${s.L}:${s.R}`;
    const b = best.get(key) || { L: s.L, R: s.R, best: 0, n: 0, cpm: 0 };
    b.best = Math.max(b.best, s.acc);
    b.n++;
    if (s.acc >= 0.8) b.cpm = Math.max(b.cpm, s.cpm || 0);
    best.set(key, b);
  }
  const bestRows = [...best.values()].sort((a, b) => b.n - a.n).map((b) => `<tr>
    <td class="ratio">${ratioHtml(b.L, b.R)}</td><td class="num">${Math.round(b.best * 100)}%</td>
    <td class="num">${b.n}</td><td class="num">${b.cpm || '—'}</td></tr>`).join('');
  const recentRows = sessions.slice(-8).reverse().map((s) => `<tr>
    <td>${dtf.format(new Date(s.at))}</td><td class="ratio">${ratioHtml(s.L, s.R)}</td>
    <td>${modeName(s.mode)}</td><td class="num">${s.cpm ?? '—'}</td><td class="num">${Math.round(s.acc * 100)}%</td></tr>`).join('');

  body.innerHTML = `${tiles}
    <div class="prog-grid">
      <div class="panel">
        <div class="panel-title"><span>${t('progress.chart')}</span></div>
        <div class="chart-wrap"><canvas style="height:200px"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-title"><span>${t('progress.best')}</span></div>
        <table class="data"><thead><tr><th>${t('progress.col.rhythm')}</th><th class="num">${t('progress.col.best')}</th><th class="num">${t('progress.col.sessions')}</th><th class="num">${t('progress.col.fastestUnit')}</th></tr></thead><tbody>${bestRows}</tbody></table>
      </div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-title"><span>${t('progress.recent')}</span></div>
      <table class="data"><thead><tr><th>${t('progress.col.date')}</th><th>${t('progress.col.rhythm')}</th><th>${t('progress.col.mode')}</th><th class="num">${t('tempo.unit.cycle')}</th><th class="num">${t('progress.col.acc')}</th></tr></thead><tbody>${recentRows}</tbody></table>
    </div>
    <div class="prog-actions">
      <span class="hint" style="margin-right:auto">${t('progress.lessons')}: ${t('progress.lessonsDone', { n: doneLessons, total: LESSONS.length })}</span>
      <button class="btn btn-sm" type="button" id="btn-export"><svg><use href="#i-download"/></svg>${t('progress.export')}</button>
      <button class="btn btn-sm btn-ghost btn-danger" type="button" id="btn-clear">${t('progress.reset')}</button>
    </div>`;

  const pts = sessions.slice(-30).map((s) => ({
    acc: s.acc,
    label: `${dtf.format(new Date(s.at))}<br>${againstText(s.L, s.R)} · ${modeName(s.mode)} · ${s.cpm ?? '—'} ${t('tempo.unit.cycle')}<br><b>${Math.round(s.acc * 100)}%</b>`,
  }));
  requestAnimationFrame(() => drawTrend($('.chart-wrap', body), pts, { pal }));
  $('#btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `polyrhythm-progress-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#btn-clear').onclick = () => {
    if (!confirm(t('progress.confirmReset'))) return;
    clearProgress();
    progress = loadProgress();
    renderProgress();
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const pressed = new Map();                       // midi → { hand, t0, down, tUp }
const fingerPressed = { L: new Map(), R: new Map() };
const codeMap = new Map();                       // keyboard code / pointer id → { midi, hand, finger }
let pendingKeyMidi = null;

function nextNoteFor(hand) {
  if (!transport.playing) return null;
  const pos = transport.tl.posAt(audio.heardTime());
  let best = null, bestD = Infinity;
  for (let k = Math.max(0, Math.floor(pos) - 1); k <= Math.max(0, Math.floor(pos) + 1); k++) {
    const spec = transport.specAt(k);
    const n = hand === 'L' ? spec.L : spec.R;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(k + i / n - pos);
      if (d < bestD) { bestD = d; best = noteAt(S, posMap, hand, k, i, n); }
    }
  }
  return best;
}

function onPress(p) {
  if (cal) { calTap(p.time); return; }
  if (!audio.ctx) audio.ensure();
  if (audio.ctx && audio.ctx.state !== 'running') audio.resume();
  const hand = p.hand;
  let { finger, midi } = p;
  if (midi == null) {
    if (finger != null) midi = posMap[hand][finger];
    else {
      const nx = nextNoteFor(hand);
      midi = nx ? nx.midis[0] : posMap[hand][1];
      finger = nx ? nx.fingers[0] : 1;
    }
  } else if (finger == null) {
    const f = posMap[hand].indexOf(midi);
    finger = f >= 1 ? f : null;
  }
  if (S.inputSound && p.source !== 'midi' && audio.ctx) {
    audio.play(audio.now, [midi], { hand, inst: S.instrument, gain: hand === 'L' ? S.lhVol : S.rhVol, vel: 0.75, dur: 0.5, input: true });
  }
  const nowMs = performance.now();
  pressed.set(midi, { hand, t0: nowMs, down: true });
  if (finger) fingerPressed[hand].set(finger, { t0: nowMs, down: true });
  const id = p.code || p.pointerId;
  if (id != null) codeMap.set(id, { midi, hand, finger });
  else if (p.source === 'pointer' && p.lamp) codeMap.set(`lamp-${hand}`, { midi, hand, finger });

  if (transport.playing && playsHand(S.playMode, hand)) {
    const time = audio.perfToCtx(p.time) - S.latency / 1000;
    if (time < transport.tl.timeAt(0) - 0.25) return;
    const pos = transport.tl.posAt(time);
    pendingKeyMidi = midi;
    scorer.input(hand, time, { pos, finger: p.finger ?? null, midi: p.midi ?? null, strict: S.strict });
    pendingKeyMidi = null;
  }
}

function onRelease(p) {
  const id = p.code || p.pointerId;
  let rec = id != null ? codeMap.get(id) : null;
  if (id != null) codeMap.delete(id);
  if (!rec && p.midi != null) rec = { midi: p.midi, hand: p.hand, finger: posMap[p.hand]?.indexOf(p.midi) };
  if (!rec) return;
  const nowMs = performance.now();
  const k = pressed.get(rec.midi);
  if (k) { k.down = false; k.tUp = nowMs; }
  const f = rec.finger && fingerPressed[rec.hand].get(rec.finger);
  if (f) { f.down = false; f.tUp = nowMs; }
}

const input = new InputManager({
  onPress,
  onRelease,
  onShortcut,
  midiToHand: (midi) => handForMidi(midi),
  onMidiState: ({ status, names }) => {
    const st = $('#midi-status');
    const sel = $('#in-midi');
    if (status === 'ready') {
      st.textContent = t('midi.ready', { names: names.map((n) => n.name).join(', ') });
      sel.hidden = names.length < 2;
      sel.innerHTML = `<option value="all">${t('midi.all')}</option>` + names.map((n) => `<option value="${n.id}">${n.name}</option>`).join('');
      sel.value = input.midiInputId;
      if (S.inputSound) toast(t('toast.midiOn'));
    } else {
      st.textContent = t(`midi.${status}`);
      sel.hidden = true;
    }
  },
});

function bindPointerInputs() {
  const cv = $('#piano-canvas');
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const midi = piano.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (midi == null) return;
    const m = handForMidi(midi);
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    onPress({ hand: m.hand, finger: m.finger, midi, time: e.timeStamp, source: 'pointer', pointerId: `p${e.pointerId}` });
  });
  const up = (e) => onRelease({ pointerId: `p${e.pointerId}` });
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  for (const lamp of $$('.lamp')) {
    const hand = lamp.dataset.hand;
    lamp.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPress({ hand, finger: null, midi: null, time: e.timeStamp, source: 'pointer', pointerId: `lamp${e.pointerId}` });
    });
    lamp.addEventListener('pointerup', (e) => onRelease({ pointerId: `lamp${e.pointerId}` }));
    lamp.addEventListener('pointercancel', (e) => onRelease({ pointerId: `lamp${e.pointerId}` }));
    lamp.addEventListener('keydown', (e) => { if (e.code === 'Enter') e.preventDefault(); });
  }
}

function onShortcut(e) {
  if ($('#dlg-calibrate').open) {
    if (e.code === 'Escape' || e.code === 'Tab') return false;
    e.preventDefault();
    if (!e.repeat) calTap(e.timeStamp);
    return true;
  }
  const tag = e.target?.tagName;
  const isRange = tag === 'INPUT' && e.target.type === 'range';
  if (isRange && e.code.startsWith('Arrow')) return false;
  const shift = e.shiftKey;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (!e.repeat) { if (document.activeElement?.blur) document.activeElement.blur(); togglePlay(); }
      return true;
    case 'Escape': stop('user'); return true;
    case 'Digit0': case 'Numpad0': case 'Backquote': setMode('listen'); return true;
    case 'Digit1': case 'Numpad1': if (shift) { update('view', VIEWS[0]); return true; } setMode('left'); return true;
    case 'Digit2': case 'Numpad2': if (shift) { update('view', VIEWS[1]); return true; } setMode('both'); return true;
    case 'Digit3': case 'Numpad3': if (shift) { update('view', VIEWS[2]); return true; } setMode('right'); return true;
    case 'Digit4': if (shift) { update('view', VIEWS[3]); return true; } return false;
    case 'Digit5': if (shift) { update('view', VIEWS[4]); return true; } return false;
    case 'ArrowLeft': case 'ArrowRight': {
      e.preventDefault();
      const i = MODES.indexOf(S.playMode) + (e.code === 'ArrowLeft' ? -1 : 1);
      setMode(MODES[clamp(i, 0, MODES.length - 1)]);
      return true;
    }
    case 'ArrowUp': case 'ArrowDown':
      e.preventDefault();
      setTempo(displayedBpm() + (e.code === 'ArrowUp' ? 1 : -1) * (shift ? 5 : 1));
      return true;
    case 'BracketLeft': case 'BracketRight': {
      const i = (VIEWS.indexOf(S.view) + (e.code === 'BracketLeft' ? -1 : 1) + VIEWS.length) % VIEWS.length;
      update('view', VIEWS[i]);
      return true;
    }
    case 'Slash':
      if (shift) { openDialog('#dlg-help'); return true; }
      return false;
    case 'KeyM':
      if (shift) { update('metro.on', !S.metro.on); toast(t(S.metro.on ? 'metro.onToast' : 'metro.offToast')); return true; }
      return false;
    case 'KeyA':
      if (shift) { toggleAccomp(); return true; }
      return false;
    case 'KeyE':
      if (shift) { update('cue.on', !S.cue.on); toast(t(S.cue.on ? 'cue.onToast' : 'cue.offToast')); return true; }
      return false;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Hand lights
// ---------------------------------------------------------------------------

const lampTimers = { L: 0, R: 0 };
const lampAuto = { L: -1, R: -1 };

function resetLamps() {
  for (const hand of ['L', 'R']) {
    const el = $(`#lamp-${hand}`);
    el.dataset.state = '';
    el.style.setProperty('--glow', '0');
    el.style.setProperty('--acc', '0');
    $('.lamp-word', el).textContent = '—';
    $('.lamp-ms', el).textContent = '';
  }
}

function updateLamps() {
  for (const hand of ['L', 'R']) {
    const el = $(`#lamp-${hand}`);
    const mine = playsHand(S.playMode, hand);
    el.classList.toggle('is-active', mine);
    el.classList.toggle('is-idle', !mine && !transport.playing);
    const heard = S.playMode === 'listen' || S.accomp;
    $('.lamp-role', el).textContent = mine ? t('lamp.you') : heard ? t('lamp.auto') : t('lamp.shown');
    if (!mine && el.dataset.state && el.dataset.state !== 'auto') {
      el.dataset.state = '';
      $('.lamp-word', el).textContent = '—';
      $('.lamp-ms', el).textContent = '';
    }
    if (!transport.playing && !el.dataset.state) $('.lamp-word', el).textContent = mine ? t('lamp.idle') : '—';
  }
}

function flashLamp(hand, state, word, ms, glow = 1) {
  const el = $(`#lamp-${hand}`);
  el.dataset.state = state;
  $('.lamp-word', el).textContent = word;
  $('.lamp-ms', el).textContent = ms;
  el.style.setProperty('--glow', String(glow));
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  clearTimeout(lampTimers[hand]);
  lampTimers[hand] = setTimeout(() => el.style.setProperty('--glow', String(glow * 0.3)), 170);
}

scorer.onJudge = (j) => {
  j.keyMidi = pendingKeyMidi ?? (j.ev ? j.ev.midis[0] : null);
  j.label = t(`judge.${j.type}`);
  let ms = '';
  if (j.dt != null && HIT_TYPES.has(j.type)) {
    const v = Math.round(Math.abs(j.dt * 1000));
    ms = v < 3 ? t('judge.onTime') : j.dt < 0 ? t('judge.early', { ms: v }) : t('judge.late', { ms: v });
  }
  j.lampText = ms ? `${j.label} · ${ms}` : j.label;
  flashLamp(j.hand, j.type, j.label, ms);
  const acc = scorer.recentAccuracy(j.hand);
  $(`#lamp-${j.hand}`).style.setProperty('--acc', acc == null ? '0' : acc.toFixed(3));
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let lastSylIdx = -1;
let lastCycleSeen = -99;
let lastCount = null;
let lastHud = '';
let lastBadges = '';
let lastShownBpm = null;
const lastEdge = { L: -1, R: -1 };

const frame = {
  pal: null, cfg: S, playing: false, pos: 0, dur: 1, nowMs: 0, reduce: false,
  active: new Map(), pressed: new Map(),
  fingerOn: { L: new Map(), R: new Map() },
  fingerPressed: { L: new Map(), R: new Map() },
  next: { L: null, R: null },
  handEngaged: { L: true, R: true },
  handFlash: { L: 0, R: 0 },
  marks: [], kb: null, posMap,
  syl: null, sylList: [],
};
frame.spec = (k) => transport.specAt(k);
frame.isGap = (k) => transport.playing && transport.isGap(k);
frame.note = (hand, k, i, n) => noteAt(S, posMap, hand, k, i, n);
frame.noteLabel = (m) => noteName(m, usesFlats(S), S.noteNames);
frame.metroTicks = (k) => transport.metroItems(Math.max(0, k), transport.specAt(Math.max(0, k)), S);

function computeActive(fr) {
  fr.active.clear();
  fr.fingerOn.L.clear();
  fr.fingerOn.R.clear();
  fr.next.L = fr.next.R = null;
  fr.handFlash.L = fr.handFlash.R = 0;
  if (!fr.playing) return;
  const pos = fr.pos;
  const k = Math.floor(pos);
  for (const hand of ['L', 'R']) {
    for (let kk = k - 1; kk <= k; kk++) {
      if (kk < 0 || transport.isGap(kk)) continue;
      const spec = transport.specAt(kk);
      const n = hand === 'L' ? spec.L : spec.R;
      const dur = transport.tl.durAtPos(kk);
      const hold = Math.min(0.5, (dur / n) * 0.8);
      for (let i = 0; i < n; i++) {
        const age = (pos - (kk + i / n)) * dur;
        if (age >= 0) fr.handFlash[hand] = Math.max(fr.handFlash[hand], clamp(1 - age / Math.min(0.35, (dur / n) * 0.8), 0, 1));
        if (age < 0 || age > hold + 0.15) continue;
        const s = age < hold ? 1 - 0.3 * (age / hold) : 0.7 * (1 - (age - hold) / 0.15);
        const note = noteAt(S, posMap, hand, kk, i, n);
        note.midis.forEach((m, idx) => {
          const prev = fr.active.get(m);
          if (!prev || prev.s < s) fr.active.set(m, { hand, s });
          const f = note.fingers[idx];
          fr.fingerOn[hand].set(f, Math.max(fr.fingerOn[hand].get(f) || 0, s));
        });
      }
    }
    // Next note for anticipation
    outer: for (let kk = Math.max(0, k); kk <= Math.max(0, k) + 1; kk++) {
      const spec = transport.specAt(kk);
      const n = hand === 'L' ? spec.L : spec.R;
      for (let i = 0; i < n; i++) {
        const p = kk + i / n;
        if (p > pos + 1e-6) {
          const note = noteAt(S, posMap, hand, kk, i, n);
          fr.next[hand] = { ...note, eta: (p - pos) * transport.tl.durAtPos(p) };
          break outer;
        }
      }
    }
  }
}

function computePressed(fr, nowMs) {
  fr.pressed.clear();
  for (const [m, p] of pressed) {
    const s = p.down ? 1 : clamp(1 - (nowMs - p.tUp) / 260, 0, 1);
    if (s <= 0) { pressed.delete(m); continue; }
    fr.pressed.set(m, { hand: p.hand, s, down: p.down });
  }
  for (const hand of ['L', 'R']) {
    fr.fingerPressed[hand].clear();
    for (const [f, p] of fingerPressed[hand]) {
      const s = p.down ? 1 : clamp(1 - (nowMs - p.tUp) / 260, 0, 1);
      if (s <= 0) { fingerPressed[hand].delete(f); continue; }
      fr.fingerPressed[hand].set(f, s);
    }
  }
}

/** "Bar 2 · beat 3" for beat k (one beat = one group). */
function barBeat(k) {
  const n = S.metro.beats;
  return t('hud.barBeat', { bar: Math.floor(Math.max(0, k) / n) + 1, beat: (Math.max(0, k) % n) + 1 });
}

function updateHud(fr) {
  const k = Math.floor(fr.pos);
  // Composite syllable
  let idx = -1;
  if (fr.playing && fr.pos >= 0) {
    const phase = fr.pos - k;
    for (let i = 0; i < sylList.length; i++) if (sylList[i].phase <= phase + 1e-9) idx = i;
    const s = sylList[idx];
    fr.syl = s ? { current: s, since: (phase - s.phase) * fr.dur } : null;
  } else fr.syl = null;
  if (idx !== lastSylIdx) {
    $$('#mnemonic .syl').forEach((el, i) => el.classList.toggle('is-now', i === idx));
    lastSylIdx = idx;
  }

  // Count-in
  if (fr.playing && fr.pos < 0) {
    const remaining = transport.countIn - Math.floor(fr.pos + transport.countIn);
    if (remaining !== lastCount && remaining > 0) {
      const cd = $('#countdown');
      cd.textContent = remaining;
      cd.classList.remove('show');
      void cd.offsetWidth;
      cd.classList.add('show');
      lastCount = remaining;
    }
  }

  // Downbeat pulse on the play button
  if (fr.playing && k !== lastCycleSeen && fr.pos >= 0) {
    lastCycleSeen = k;
    if (S.metro.on && S.metro.vibrate && navigator.vibrate) navigator.vibrate(40);
    const b = $('#btn-play');
    b.classList.remove('beat');
    void b.offsetWidth;
    b.classList.add('beat');
  }

  // Auto-played hand lights blink with their notes
  if (fr.playing && fr.pos >= 0) {
    for (const hand of ['L', 'R']) {
      if (playsHand(S.playMode, hand)) continue;
      const spec = transport.specAt(k);
      const n = hand === 'L' ? spec.L : spec.R;
      const i = Math.floor((fr.pos - k) * n);
      const onset = k * 16 + i;
      if (onset !== lampAuto[hand]) {
        lampAuto[hand] = onset;
        if (!transport.isGap(k)) {
          const note = noteAt(S, posMap, hand, k, i, n);
          const names = note.midis.map((m) => noteName(m, usesFlats(S), S.noteNames)).join(' ');
          flashLamp(hand, 'auto', names, `${t('lamp.finger')} ${note.fingers.join('+')}`, S.playMode === 'listen' || S.accomp ? 0.6 : 0.3);
        }
      }
    }
  }

  // Text HUD
  const acc = scorer.accuracy;
  const sub = fr.playing
    ? (fr.pos < 0 ? t('hud.countIn') : `${barBeat(k)} · ${Math.round(transport.bpm)} ${t(`tempo.unit.${S.tempoRef}`)}`)
    : `${modeName(S.playMode)} · ${displayedBpm()} ${t(`tempo.unit.${S.tempoRef}`)}`;
  const hud = `${sub}|${acc == null ? '—' : Math.round(acc * 100)}|${scorer.combo}`;
  if (hud !== lastHud) {
    lastHud = hud;
    $('#hud-sub').textContent = sub;
    $('#hud-acc').textContent = acc == null ? '—' : `${Math.round(acc * 100)}%`;
    $('#hud-combo').textContent = scorer.combo;
  }

  const badges = [];
  if (fr.playing && fr.pos >= 0 && transport.isGap(k)) badges.push(`<span class="badge is-silent">${t('hud.silent')}</span>`);
  if (S.speed.on && !activeLesson) badges.push(`<span class="badge is-speed">${t('hud.speed', { now: displayedBpm(), target: S.speed.target })}</span>`);
  if (S.strict) badges.push(`<span class="badge">${t('hud.strict')}</span>`);
  const bh = badges.join('');
  if (bh !== lastBadges) { lastBadges = bh; $('#badges').innerHTML = bh; }

  const shown = displayedBpm();
  if (shown !== lastShownBpm) { lastShownBpm = shown; refreshTempo(); }
}

function render() {
  requestAnimationFrame(render);
  const nowMs = performance.now();
  const fr = frame;
  fr.pal = pal;
  fr.nowMs = nowMs;
  fr.reduce = S.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  fr.playing = transport.playing;
  fr.posMap = posMap;
  fr.kb = piano.kb;
  fr.marks = scorer.marks;
  fr.sylList = sylList;
  if (fr.playing) {
    const heard = audio.heardTime();
    fr.pos = transport.tl.posAt(heard);
    fr.dur = transport.tl.durAtPos(fr.pos);
    scorer.update(heard - S.latency / 1000);
    if (session) session.lastPos = Math.max(session.lastPos, fr.pos);
    if (transport.finishAt && audio.now >= transport.finishAt) stop('complete');
  } else {
    fr.pos = 0;
    fr.dur = cycleSeconds(S.tempoRef, displayedBpm(), S.left, S.right);
  }
  const listen = S.playMode === 'listen';
  fr.handEngaged.L = listen || playsHand(S.playMode, 'L');
  fr.handEngaged.R = listen || playsHand(S.playMode, 'R');
  fr.handLabel = { L: t('hand.left'), R: t('hand.right') };
  fr.handShort = { L: t('hand.leftShort'), R: t('hand.rightShort') };
  fr.compLabel = t('strip.composite');
  fr.scoreCaption = t('score.caption');
  fr.cycleLabel = barBeat(Math.floor(fr.pos));
  fr.fingerWord = t('lamp.finger');

  computeActive(fr);
  computePressed(fr, nowMs);
  updateHud(fr);
  highlightBeat(fr);
  drawPendulum(fr);

  (views[S.view] || views.pulse).draw(fr);
  for (const hand of ['L', 'R']) {
    const v = S.edgeFlash ? Math.round(fr.handFlash[hand] * 20) / 20 : 0;
    if (v !== lastEdge[hand]) { lastEdge[hand] = v; $(`#edge-${hand}`).style.opacity = v; }
  }
  piano.draw(fr);
  meter.draw(fr);
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

let cal = null;
let calResult = null;

async function startCalibration() {
  const ctx = await audio.resume();
  if (!ctx) return;
  if (transport.playing) stop('user');
  cancelCalibration();
  const interval = 0.6;
  const t0 = audio.now + 0.5;
  const clicks = [];
  const timers = [];
  for (let i = 0; i < 20; i++) {
    const tt = t0 + i * interval;
    audio.click(tt, i < 4 ? 'normal' : 'accent', 0.85);
    if (i >= 4) clicks.push(tt);
    timers.push(setTimeout(() => {
      const b = $('#cal-beat');
      b.classList.add('on');
      setTimeout(() => b.classList.remove('on'), 90);
    }, (tt - audio.now) * 1000));
  }
  cal = { clicks, taps: [], timers };
  calResult = null;
  $('#btn-cal-apply').disabled = true;
  $('#cal-result').textContent = t('cal.listening');
  timers.push(setTimeout(finishCalibration, (t0 + 20 * interval + 0.4 - audio.now) * 1000));
}

function calTap(perfMs) {
  if (!cal) return;
  cal.taps.push(audio.perfToCtx(perfMs));
  const pad = $('#cal-pad');
  pad.style.background = 'var(--card-hi-2)';
  setTimeout(() => { pad.style.background = ''; }, 90);
}

function finishCalibration() {
  if (!cal) return;
  const offs = [];
  for (const tap of cal.taps) {
    let best = null;
    for (const c of cal.clicks) if (best == null || Math.abs(tap - c) < Math.abs(tap - best)) best = c;
    if (best != null && Math.abs(tap - best) < 0.28) offs.push((tap - best) * 1000);
  }
  cal = null;
  if (offs.length < 6) { $('#cal-result').textContent = t('cal.notEnough'); return; }
  offs.sort((a, b) => a - b);
  const median = offs[Math.floor(offs.length / 2)];
  const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
  const sd = Math.sqrt(offs.reduce((a, b) => a + (b - mean) ** 2, 0) / offs.length);
  calResult = Math.round(median);
  $('#cal-result').textContent = t('cal.result', { ms: calResult, n: offs.length, sd: Math.round(sd) });
  $('#btn-cal-apply').disabled = false;
}

function cancelCalibration() {
  if (cal) for (const id of cal.timers) clearTimeout(id);
  cal = null;
}

function applyCalibration() {
  if (calResult == null) return;
  update('latency', clamp(calResult, -100, 300));
  toast(t('toast.applied'));
  $('#dlg-calibrate').close();
}

// ---------------------------------------------------------------------------
// Misc: share, focus, wake lock
// ---------------------------------------------------------------------------

async function shareLink() {
  const url = buildShareUrl(S);
  try {
    await navigator.clipboard.writeText(url);
    toast(t('toast.copied'));
  } catch {
    toast(t('toast.copyFail'));
  }
}

function toggleFocus() {
  const on = !document.body.classList.contains('focus');
  document.body.classList.toggle('focus', on);
  if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(relayout, 60);
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('focus')) {
    document.body.classList.remove('focus');
    setTimeout(relayout, 60);
  }
});

let wakeLock = null;
async function requestWake() {
  if (!S.wakeLock || !navigator.wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && transport.playing) requestWake();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  applyTheme();
  setLang(S.lang === 'auto' ? detectLang() : S.lang);
  applyI18n();
  buildSelects();
  buildPresets();
  bindControls();
  bindPointerInputs();
  rebuildRhythmUi();
  refreshControls();
  updateLamps();
  updateLessonBanner();
  scorer.setActive(S.playMode);
  relayout();
  new ResizeObserver(() => relayout()).observe($('.stage-center'));
  if (document.fonts?.ready) document.fonts.ready.then(() => { pal = readPalette(); relayout(); });
  if (!input.midiSupported) $('#btn-midi').disabled = true;
  requestAnimationFrame(render);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
