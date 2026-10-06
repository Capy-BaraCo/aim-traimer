import { describe, expect, it } from 'vitest';
import type { DrillProgress } from '../src/core/progress';
import { DIFFICULTY_BANDS, LEVELS, levelFor, levelParams, unlockedInBand } from '../src/rhythm/levels';
import { MIXED, PRESETS, presetById } from '../src/rhythm/presets';
import { DIFFICULTIES, FLICK_SHAPES, SECTION_KINDS, TARGET_KINDS } from '../src/rhythm/types';

const progressWithStars = (...levels: number[]): DrillProgress => ({
  levels: Object.fromEntries(levels.map((level) => [level, { best: 0, stars: 1, runs: 1 }])),
  runs: levels.length,
  lastLevel: levels.at(-1) ?? 1,
});

describe('Mixed Style preset', () => {
  it('has all six Target types and normalized weights in every Section row', () => {
    for (const kind of SECTION_KINDS) {
      const weights = MIXED.rows[kind].weights;
      expect(Object.keys(weights).sort()).toEqual([...TARGET_KINDS].sort());
      expect(TARGET_KINDS.reduce((sum, target) => sum + weights[target], 0)).toBeCloseTo(1);
    }
    expect(Object.keys(MIXED.flickShapes).sort()).toEqual([...FLICK_SHAPES].sort());
    expect(FLICK_SHAPES.reduce((sum, shape) => sum + MIXED.flickShapes[shape], 0)).toBeCloseTo(1);
  });

  it('matches the V5 weights and Targets per Bar', () => {
    const v5 = Object.fromEntries(SECTION_KINDS.map((kind) => [kind, { weights: MIXED.rows[kind].weights, perBar: MIXED.rows[kind].perBar }]));
    expect(v5).toEqual({
      intro: { weights: { flick: 0.50, burst: 0, strafer: 0.20, hold: 0.30, peeker: 0, decoy: 0 }, perBar: { from: 1, to: 1 } },
      calm: { weights: { flick: 0.30, burst: 0, strafer: 0.20, hold: 0.30, peeker: 0.20, decoy: 0 }, perBar: { from: 2, to: 2 } },
      build: { weights: { flick: 0.35, burst: 0.20, strafer: 0.15, hold: 0, peeker: 0.20, decoy: 0.10 }, perBar: { from: 2, to: 4 } },
      peak: { weights: { flick: 0.30, burst: 0.25, strafer: 0.20, hold: 0.05, peeker: 0.10, decoy: 0.10 }, perBar: { from: 4, to: 4 } },
      outro: { weights: { flick: 0.30, burst: 0, strafer: 0.30, hold: 0.40, peeker: 0, decoy: 0 }, perBar: { from: 1, to: 1 } },
    });
    expect(MIXED.flickShapes).toEqual({ circle: 0.50, diamond: 0.25, triangle: 0.25 });
    for (const kind of ['intro', 'calm', 'outro'] as const) {
      expect(MIXED.rows[kind].weights.burst).toBe(0);
      expect(MIXED.rows[kind].weights.decoy).toBe(0);
    }
  });

  it('has D18\'s rhythmic feel: steady calm sections, driving builds and peaks, fills into peaks', () => {
    const grids = Object.fromEntries(SECTION_KINDS.map((kind) => [kind, [MIXED.rows[kind].landGrid, MIXED.rows[kind].slotGrid]]));
    expect(grids).toEqual({ intro: [1, 1], calm: [1, 1], build: [0.5, 1], peak: [0.5, 0.5], outro: [1, 1] });
    expect(MIXED.fills).toBe(true);
  });

  it('offers only Mixed', () => {
    expect(PRESETS).toEqual([MIXED]);
    expect(presetById('mixed')).toBe(MIXED);
    expect(MIXED.params).toBeUndefined();
  });
});

describe('Overdrive Levels', () => {
  it('uses the specified endpoints and has exactly ten rows', () => {
    expect(Object.keys(LEVELS).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(LEVELS[1]).toEqual({
      leadBeats: 2, afterBeats: 1.5, perfectMs: 90, density: 0.5,
      maxConcurrent: 2, targetRadius: 0.40, diamondScale: 0.6,
      straferSpeed: 0.6, straferHealth: 60, straferLifeBeats: 8,
      holdBeats: 4, peekerBeats: 1, flyInBeats: 1,
    });
    expect(LEVELS[10]).toEqual({
      leadBeats: 1, afterBeats: 0.5, perfectMs: 45, density: 1.25,
      maxConcurrent: 5, targetRadius: 0.24, diamondScale: 0.6,
      straferSpeed: 1, straferHealth: 160, straferLifeBeats: 8,
      holdBeats: 2, peekerBeats: 1, flyInBeats: 1,
    });
  });

  it('interpolates each Level and rounds counted targets and beats', () => {
    for (let level = 1; level <= 10; level++) {
      const fraction = (level - 1) / 9;
      const expected = (from: number, to: number) => from + (to - from) * fraction;
      const row = LEVELS[level];
      expect(row.leadBeats).toBeCloseTo(expected(2, 1));
      expect(row.afterBeats).toBeCloseTo(expected(1.5, 0.5));
      expect(row.perfectMs).toBeCloseTo(expected(90, 45));
      expect(row.density).toBeCloseTo(expected(0.5, 1.25));
      expect(row.maxConcurrent).toBe(Math.round(expected(2, 5)));
      expect(row.targetRadius).toBeCloseTo(expected(0.40, 0.24));
      expect(row.straferSpeed).toBeCloseTo(expected(0.6, 1));
      expect(row.straferHealth).toBeCloseTo(expected(60, 160));
      expect(row.holdBeats).toBe(Math.round(expected(4, 2)));
      expect(row.diamondScale).toBe(0.6);
      expect(row.straferLifeBeats).toBe(8);
      expect(row.peekerBeats).toBe(1);
      expect(row.flyInBeats).toBe(1);
    }
  });

  it('tightens Hit windows and Perfect widths while density rises', () => {
    for (let level = 2; level <= 10; level++) {
      expect(LEVELS[level].leadBeats).toBeLessThanOrEqual(LEVELS[level - 1].leadBeats);
      expect(LEVELS[level].afterBeats).toBeLessThanOrEqual(LEVELS[level - 1].afterBeats);
      expect(LEVELS[level].perfectMs).toBeLessThanOrEqual(LEVELS[level - 1].perfectMs);
      expect(LEVELS[level].density).toBeGreaterThanOrEqual(LEVELS[level - 1].density);
    }
  });

  it('clamps Levels and applies only the named Style preset multipliers', () => {
    expect(levelParams(0)).toEqual(LEVELS[1]);
    expect(levelParams(11)).toEqual(LEVELS[10]);
    expect(levelParams(5, MIXED)).toEqual(LEVELS[5]);
    const preset = { ...MIXED, params: { density: 2, targetRadius: 0.5, window: 1.5, straferSpeed: 2, straferHealth: 1.5, holdBeats: 0.5 } };
    const actual = levelParams(5, preset);
    const base = LEVELS[5];
    expect(actual).toEqual({
      ...base,
      density: base.density * 2,
      targetRadius: base.targetRadius * 0.5,
      leadBeats: base.leadBeats * 1.5,
      afterBeats: base.afterBeats * 1.5,
      straferSpeed: base.straferSpeed * 2,
      straferHealth: base.straferHealth * 1.5,
      holdBeats: base.holdBeats * 0.5,
    });
    expect(LEVELS[5]).toEqual(base);
  });

  it('unlocks consecutive starred Levels inside each Difficulty band', () => {
    expect(levelFor('easy', undefined)).toBe(1);
    expect(levelFor('hard', undefined)).toBe(7);
    expect(levelFor('hard', progressWithStars(7))).toBe(8);
    expect(levelFor('hard', progressWithStars(7, 8))).toBe(8);
    expect(levelFor('hard', progressWithStars(5))).toBe(7);
    expect(levelFor('normal', progressWithStars(5))).toBe(4);
    expect(levelFor('normal', progressWithStars(4, 5))).toBe(6);
    for (const difficulty of DIFFICULTIES) {
      const band = DIFFICULTY_BANDS[difficulty];
      for (let mask = 0; mask < 1 << 10; mask++) {
        const starred = Array.from({ length: 10 }, (_, index) => index + 1)
          .filter((level) => (mask & (1 << (level - 1))) !== 0);
        const progress = progressWithStars(...starred);
        const level = levelFor(difficulty, progress);
        expect(level).toBeGreaterThanOrEqual(band.from);
        expect(level).toBeLessThanOrEqual(band.to);
        expect(unlockedInBand(progress, difficulty)).toBe(level);
      }
    }
  });
});
