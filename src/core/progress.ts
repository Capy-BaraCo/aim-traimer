/**
 * Progression: every drill has 10 levels, each worth up to 3 stars. One star unlocks the next level.
 * Stars add up to a rank. Pure functions here; persistence lives in the store.
 */

export interface LevelResult {
  best: number;
  stars: number;
  runs: number;
}

export interface DrillProgress {
  levels: Record<string, LevelResult>;
  runs: number;
  lastLevel: number;
}

export interface SessionRecord {
  at: string;
  drill: string;
  level: number;
  score: number;
  stars: number;
}

export type Thresholds = readonly [number, number, number];

export const MAX_LEVEL = 10;

export const RANKS = [
  { name: 'Recruit', stars: 0, blurb: 'Everyone starts here.' },
  { name: 'Spotter', stars: 8, blurb: 'You know what to look for.' },
  { name: 'Surveyor', stars: 20, blurb: 'Measuring, not guessing.' },
  { name: 'Navigator', stars: 40, blurb: 'Your hands go where your eyes go.' },
  { name: 'Cartographer', stars: 70, blurb: 'You map every angle before it happens.' },
  { name: 'Pathfinder', stars: 110, blurb: 'Clean, consistent, fast.' },
  { name: 'Azimuth', stars: 160, blurb: 'True north. Nothing left to calibrate.' },
] as const;

export function starsFor(score: number, t: Thresholds): number {
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}

export function totalStars(progress: Record<string, DrillProgress>): number {
  let n = 0;
  for (const p of Object.values(progress)) for (const l of Object.values(p.levels)) n += l.stars;
  return n;
}

export function rankFor(stars: number): {
  index: number;
  name: string;
  blurb: string;
  next: (typeof RANKS)[number] | null;
  /** 0..1 progress towards the next rank. */
  progress: number;
} {
  let i = 0;
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1].stars) i++;
  const cur = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  return {
    index: i,
    name: cur.name,
    blurb: cur.blurb,
    next,
    progress: next ? (stars - cur.stars) / (next.stars - cur.stars) : 1,
  };
}

/** Highest level you may play: level 1, plus one for every consecutive level with at least one star. */
export function unlockedLevel(p: DrillProgress | undefined, max = MAX_LEVEL): number {
  let lvl = 1;
  while (lvl < max && (p?.levels[lvl]?.stars ?? 0) >= 1) lvl++;
  return lvl;
}

export function drillStars(p: DrillProgress | undefined): number {
  return p ? Object.values(p.levels).reduce((s, l) => s + l.stars, 0) : 0;
}

export interface RunOutcome {
  stars: number;
  previousStars: number;
  newBest: boolean;
  previousBest: number | null;
  /** The level that just became playable because of this run, if any. */
  unlocked: number | null;
  starsGained: number;
}

/** Apply a run to a drill's progress (mutates `p`) and describe what changed. */
export function applyRun(p: DrillProgress, level: number, score: number, t: Thresholds, max = MAX_LEVEL): RunOutcome {
  const before = unlockedLevel(p, max);
  const cur = p.levels[level] ?? { best: 0, stars: 0, runs: 0 };
  const stars = starsFor(score, t);
  const outcome: RunOutcome = {
    stars,
    previousStars: cur.stars,
    newBest: score > cur.best || cur.runs === 0,
    previousBest: cur.runs ? cur.best : null,
    unlocked: null,
    starsGained: Math.max(0, stars - cur.stars),
  };
  p.levels[level] = { best: Math.max(cur.best, score), stars: Math.max(cur.stars, stars), runs: cur.runs + 1 };
  p.runs++;
  p.lastLevel = level;
  const after = unlockedLevel(p, max);
  if (after > before) outcome.unlocked = after;
  return outcome;
}

export const dayKey = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Consecutive practice days ending today (or yesterday, so an un-started today doesn't break it). */
export function streak(days: readonly string[], today = dayKey()): number {
  const set = new Set(days);
  const d = new Date(`${today}T12:00:00`);
  if (!set.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
