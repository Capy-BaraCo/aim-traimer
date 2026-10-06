/** Overdrive's Level table and independent Difficulty bands (D7, D9, D10, D17). */
import type { DrillProgress } from '../core/progress';
import type { Difficulty, Preset } from './types';

export interface LevelParams {
  /** Beats from landing to the Target beat. */
  leadBeats: number;
  /** Beats from the Target beat to the Hit window end. */
  afterBeats: number;
  /** Milliseconds on either side of the Target beat for Perfect. */
  perfectMs: number;
  /** Multiplier on a Style preset's Targets per Bar. */
  density: number;
  /** Maximum simultaneous Targets. */
  maxConcurrent: number;
  /** Base Target radius in metres. */
  targetRadius: number;
  /** Multiplier on targetRadius for diamond Flick shapes. */
  diamondScale: number;
  /** Strafer StyleTuning.speed multiplier. */
  straferSpeed: number;
  /** Strafer health points. */
  straferHealth: number;
  /** Beats a Strafer lives. */
  straferLifeBeats: number;
  /** Beats a Hold lasts after its Target beat. */
  holdBeats: number;
  /** Beats a Peeker shows after its Target beat. */
  peekerBeats: number;
  /** Beats from launch to landing. */
  flyInBeats: number;
}

const L1: LevelParams = {
  leadBeats: 2, afterBeats: 1.5, perfectMs: 90, density: 0.5,
  maxConcurrent: 2, targetRadius: 0.40, diamondScale: 0.6,
  straferSpeed: 0.6, straferHealth: 60, straferLifeBeats: 8,
  holdBeats: 4, peekerBeats: 1, flyInBeats: 1,
};

const L10: LevelParams = {
  leadBeats: 1, afterBeats: 0.5, perfectMs: 45, density: 1.25,
  maxConcurrent: 5, targetRadius: 0.24, diamondScale: 0.6,
  straferSpeed: 1, straferHealth: 160, straferLifeBeats: 8,
  holdBeats: 2, peekerBeats: 1, flyInBeats: 1,
};

const interpolate = (from: number, to: number, fraction: number): number =>
  fraction === 1 ? to : from + (to - from) * fraction;

/** Ten Level rows, indexed by 1..10; index 0 is absent. */
export const LEVELS: Record<number, LevelParams> = Object.fromEntries(
  Array.from({ length: 10 }, (_, index) => {
    const level = index + 1;
    const fraction = index / 9;
    const values = Object.fromEntries(
      (Object.keys(L1) as (keyof LevelParams)[]).map((key) => [key, interpolate(L1[key], L10[key], fraction)]),
    ) as unknown as LevelParams;
    values.maxConcurrent = Math.round(values.maxConcurrent);
    values.holdBeats = Math.round(values.holdBeats);
    return [level, values];
  }),
);

/** Return a clamped Level's parameters with optional Style preset multipliers applied. */
export function levelParams(level: number, preset?: Preset): LevelParams {
  const base = LEVELS[Math.min(10, Math.max(1, Math.trunc(level)))];
  const params = preset?.params;
  return {
    ...base,
    density: base.density * (params?.density ?? 1),
    targetRadius: base.targetRadius * (params?.targetRadius ?? 1),
    leadBeats: base.leadBeats * (params?.window ?? 1),
    afterBeats: base.afterBeats * (params?.window ?? 1),
    straferSpeed: base.straferSpeed * (params?.straferSpeed ?? 1),
    straferHealth: base.straferHealth * (params?.straferHealth ?? 1),
    holdBeats: base.holdBeats * (params?.holdBeats ?? 1),
  };
}

/** Inclusive Level bounds for each Difficulty. */
export const DIFFICULTY_BANDS: Record<Difficulty, { from: number; to: number }> = {
  easy: { from: 1, to: 3 },
  normal: { from: 4, to: 6 },
  hard: { from: 7, to: 8 },
  expert: { from: 9, to: 10 },
};

/** Highest Level unlocked by consecutive starred Levels within a Difficulty band. */
export function unlockedInBand(progress: DrillProgress | undefined, difficulty: Difficulty): number {
  const band = DIFFICULTY_BANDS[difficulty];
  let level = band.from;
  while (level < band.to && (progress?.levels[level]?.stars ?? 0) >= 1) level++;
  return level;
}

/** Resolve a Difficulty to its highest unlocked Level in that band. */
export function levelFor(difficulty: Difficulty, progress: DrillProgress | undefined): number {
  return unlockedInBand(progress, difficulty);
}
