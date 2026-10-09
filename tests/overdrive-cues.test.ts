import { describe, expect, it } from 'vitest';
import {
  flashAt,
  multiplierProgress,
  RING_HUG,
  RING_SPREAD,
  ringProgress,
  ringScale,
  STRIP_HIT_AT,
  stripEntries,
  stripX,
} from '../src/drills/overdrive-cues';
import { testBeats, testChart } from '../src/drills/overdrive-dev';
import { beatFlash } from '../src/world/synthwave';

describe('Overdrive cues (pure parts)', () => {
  it('the ring touches its target exactly on the target beat, and not before', () => {
    const from = 3.0;
    const to = 4.0;
    expect(ringScale(ringProgress(from, from, to))).toBeCloseTo(RING_HUG + RING_SPREAD, 9);
    expect(ringScale(ringProgress(to, from, to))).toBe(RING_HUG);
    // One frame (60 fps) early it is still just outside; a frame late it has stopped at the target.
    expect(ringScale(ringProgress(to - 1 / 60, from, to))).toBeGreaterThan(RING_HUG);
    expect(ringScale(ringProgress(to + 1 / 60, from, to))).toBe(RING_HUG);
    // It closes at a steady speed.
    const mid = ringScale(ringProgress(3.5, from, to));
    expect(mid).toBeCloseTo(RING_HUG + RING_SPREAD / 2, 9);
  });

  it('the strip puts a beat that is now on the hit line and later beats to its right', () => {
    expect(stripX(0)).toBe(STRIP_HIT_AT);
    expect(stripX(2)).toBeGreaterThan(stripX(1));
    expect(stripX(4)).toBeLessThanOrEqual(1);
    expect(stripX(-0.5)).toBeLessThan(STRIP_HIT_AT);
  });

  it('the beat flash from a beat position matches beatFlash on the beat list', () => {
    const beats = testBeats();
    for (const t of [0, 0.1, 0.3, 0.5, 1.2, 7.77]) {
      expect(flashAt(t / 0.5)).toBeCloseTo(beatFlash(beats, t), 9);
    }
  });

  it('the multiplier bar fills toward the next step and is full at the top', () => {
    expect(multiplierProgress(0, 1)).toBe(0);
    expect(multiplierProgress(4, 1)).toBe(0.5);
    expect(multiplierProgress(8, 2)).toBe(0);
    expect(multiplierProgress(30, 4)).toBe(1);
  });

  it('strip entries carry their role when roles are given', () => {
    const chart = testChart(5);
    const beats = testBeats();
    const roles = chart.targets.map((_, i) => (i === 0 ? ('drop' as const) : ('pattern' as const)));
    const entries = stripEntries(chart, beats, chart.targets[0].targetTime - 1, 4, 0.5, roles);
    expect(entries[0].index).toBe(0);
    expect(entries[0].role).toBe('drop');
    expect(stripEntries(chart, beats, chart.targets[0].targetTime - 1)[0].role).toBeUndefined();
  });
});
