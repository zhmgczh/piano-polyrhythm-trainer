// Step-by-step curriculum. Each lesson is a configuration plus a goal.

export const LESSON_GROUPS = [
  { L: 2, R: 3, level: 1, bpm: 40 },
  { L: 3, R: 2, level: 1, bpm: 40 },
  { L: 3, R: 4, level: 2, bpm: 30 },
  { L: 4, R: 3, level: 2, bpm: 30 },
  { L: 2, R: 5, level: 3, bpm: 30 },
  { L: 3, R: 5, level: 3, bpm: 24 },
  { L: 4, R: 5, level: 3, bpm: 20 },
];

// step id, play mode, tempo factor, LH pattern, RH pattern, cycles, goal %, extra settings
const STEPS = [
  ['listen', 'listen', 1, 'f3', 'f3', 6, 0],
  ['rh', 'right', 1, 'f3', 'f3', 12, 80],
  ['lh', 'left', 1, 'f3', 'f3', 12, 80],
  ['both', 'both', 0.85, 'f3', 'f3', 16, 75],
  ['fingers', 'both', 0.9, 'up', 'up', 20, 75],
  ['tempo', 'both', 1.35, 'down', 'updown', 20, 80],
  ['silent', 'both', 1, 'triad', 'up', 16, 70, { gap: { on: true, play: 3, mute: 1 } }],
];

export const LESSONS = [];
for (const g of LESSON_GROUPS) {
  const steps = g.level === 3 ? STEPS.slice(0, 6) : STEPS;
  for (const [step, mode, factor, lp, rp, cycles, goal, extra] of steps) {
    LESSONS.push({
      id: `${g.L}-${g.R}-${step}`,
      group: `${g.L}:${g.R}`,
      L: g.L, R: g.R, level: g.level, step, cycles, goal,
      cfg: {
        left: g.L, right: g.R,
        tempoRef: 'cycle',
        bpm: Math.max(10, Math.round(g.bpm * factor)),
        playMode: mode,
        lhPattern: lp, rhPattern: rp,
        countIn: 1,
        strict: false,
        gap: { on: false, play: 3, mute: 1, ...(extra?.gap || {}) },
      },
    });
  }
}

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null;

export function nextLesson(id) {
  const i = LESSONS.findIndex((l) => l.id === id);
  return i >= 0 && i < LESSONS.length - 1 ? LESSONS[i + 1] : null;
}

/** 0–3 stars for an accuracy (0..1) against a lesson goal. */
export function starsFor(lesson, acc) {
  if (!lesson.goal) return 3;
  const pct = acc * 100;
  if (pct >= 95) return 3;
  if (pct >= Math.min(94, lesson.goal + 10)) return 2;
  if (pct >= lesson.goal) return 1;
  return 0;
}

/** Keys a lesson may change; everything else is left untouched. */
export const LESSON_KEYS = ['left', 'right', 'bpm', 'tempoRef', 'playMode', 'lhPattern', 'rhPattern', 'countIn', 'strict', 'gap', 'speed', 'limit'];
