import { describe, expect, it } from 'vitest';
import type { ShotResult } from '../src/core/game';
import { shootingFindings } from '../src/core/coach';
import { falloffAt, LOADOUTS, spreadOffset, WEAPONS } from '../src/core/weapons';
import { efficiencyScore, ShotLedger } from '../src/drills/common';

const shot = (part: 'head' | 'body' | null, mode = WEAPONS.pulse): ShotResult =>
  ({
    figure: part ? ({} as ShotResult['figure']) : null,
    part,
    damage: part === 'head' ? mode.head : part === 'body' ? mode.body : 0,
    mode,
  }) as unknown as ShotResult;

describe('weapons', () => {
  it('drops damage linearly between fall-off start and end', () => {
    const m = WEAPONS.pistols;
    expect(falloffAt(m, 5)).toBe(1);
    expect(falloffAt(m, 15.5)).toBeCloseTo(0.65, 6);
    expect(falloffAt(m, 40)).toBe(0.3);
    expect(falloffAt(WEAPONS.rail, 200)).toBe(1);
  });

  it('spreads bullets uniformly inside the cone, never outside it', () => {
    let inner = 0;
    for (let i = 0; i < 4000; i++) {
      const [x, y] = spreadOffset(2.8);
      const r = Math.hypot(x, y);
      expect(r).toBeLessThanOrEqual(2.8 + 1e-9);
      if (r < 2.8 / Math.SQRT2) inner++;
    }
    // Half the area of the disc lies inside r/√2.
    expect(inner / 4000).toBeGreaterThan(0.45);
    expect(inner / 4000).toBeLessThan(0.55);
    expect(spreadOffset(0)).toEqual([0, 0]);
  });

  it('heads are worth double for every gun, and only Ashe scopes', () => {
    for (const w of Object.values(WEAPONS)) expect(w.head).toBe(w.body * 2);
    expect(Object.values(WEAPONS).filter((w) => w.scope).map((w) => w.id)).toEqual(['viper']);
  });

  it('every loadout lists real weapons', () => {
    for (const ids of Object.values(LOADOUTS)) for (const id of ids) expect(WEAPONS[id]).toBeDefined();
  });
});

describe('headshot scoring', () => {
  const run = (heads: number, bodies: number, misses: number) => {
    const l = new ShotLedger();
    for (let i = 0; i < heads; i++) l.add(shot('head'), 10);
    for (let i = 0; i < bodies; i++) l.add(shot('body'), 10);
    for (let i = 0; i < misses; i++) l.add(shot(null), 10);
    return l.facts();
  };

  it('all body shots score 1.0 efficiency; heads raise it; misses lower it', () => {
    expect(run(0, 10, 0).efficiency).toBeCloseTo(1, 9);
    expect(run(5, 5, 0).efficiency).toBeCloseTo(1.5, 9);
    expect(run(0, 5, 5).efficiency).toBeCloseTo(0.5, 9);
  });

  it('aiming at the head only pays if you keep hitting', () => {
    const safe = efficiencyScore(run(0, 7, 3).efficiency); // chest: 70% accuracy
    const greedyGood = efficiencyScore(run(3, 3, 4).efficiency); // heads, 60% accuracy
    const greedyBad = efficiencyScore(run(2, 1, 7).efficiency); // heads, 30% accuracy
    expect(greedyGood).toBeGreaterThan(safe);
    expect(greedyBad).toBeLessThan(safe);
  });

  it('caps at 100', () => {
    expect(efficiencyScore(2)).toBe(100);
    expect(efficiencyScore(0)).toBe(0);
  });

  it('coaches both sides of the trade-off', () => {
    expect(shootingFindings(run(10, 5, 35)).map((f) => f.id)).toContain('head-greed');
    expect(shootingFindings(run(1, 29, 10)).map((f) => f.id)).toContain('aim-higher');
    expect(shootingFindings(run(12, 12, 6)).map((f) => f.id)).toContain('heads-pay');
  });
});
