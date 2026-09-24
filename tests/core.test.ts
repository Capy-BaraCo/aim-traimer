import { describe, expect, it } from 'vitest';
import {
  cmPer360,
  edpi,
  GAMES,
  gameToOw,
  mmForDegrees,
  owToGame,
  sensForCmPer360,
  sensForNewDpi,
  verticalFovFromOw,
} from '../src/core/sens';
import { createPsa, currentStep, estimate, isDone, pick, sensOf, undo } from '../src/core/psa';
import { analyseFlick, flickBias, tallyFlicks, trialScore, type AimSample } from '../src/core/metrics';

const game = (id: string) => GAMES.find((g) => g.id === id)!;

describe('sensitivity maths', () => {
  it('matches the well-known 5 @ 800 DPI ≈ 34.6 cm/360', () => {
    expect(cmPer360(5, 800)).toBeCloseTo(34.64, 2);
    expect(edpi(5, 800)).toBe(4000);
  });

  it('round-trips cm/360 and sensitivity', () => {
    expect(sensForCmPer360(cmPer360(6.35, 1600), 1600)).toBeCloseTo(6.35, 10);
  });

  it('keeps cm/360 constant across a DPI change', () => {
    const s = sensForNewDpi(5, 800, 1600);
    expect(s).toBe(2.5);
    expect(cmPer360(s, 1600)).toBeCloseTo(cmPer360(5, 800), 10);
  });

  it('converts between games through the yaw constant', () => {
    expect(owToGame(5, game('cs2'))).toBeCloseTo(1.5, 10);
    expect(gameToOw(1.5, game('cs2'))).toBeCloseTo(5, 10);
    expect(owToGame(10.6061, game('valorant'))).toBeCloseTo(1, 3);
  });

  it('turns 103° horizontal (16:9) into ~70.5° vertical', () => {
    expect(verticalFovFromOw(103)).toBeCloseTo(70.53, 1);
  });

  it('expresses angles as physical mouse travel', () => {
    // 360° at 5 @ 800 = 34.64 cm = 346.4 mm
    expect(mmForDegrees(360, 5, 800)).toBeCloseTo(346.4, 0);
  });
});

describe('PSA binary search', () => {
  const always = (v: number) => () => v;

  it('starts at ±50% of the base', () => {
    const s = createPsa(4, 7, 0.5, always(0));
    expect(s.low).toBe(2);
    expect(s.high).toBe(6);
    expect(currentStep(s).alpha).toBe('low');
  });

  it('replaces the rejected side with the midpoint each round', () => {
    let s = createPsa(4, 7);
    s = pick(s, 'high'); // keep 6 → pair becomes 4 vs 6
    expect([s.low, s.high]).toEqual([4, 6]);
    s = pick(s, 'low'); // keep 4 → pair becomes 4 vs 5
    expect([s.low, s.high]).toEqual([4, 5]);
  });

  it('converges to base/128 after 7 rounds and stops', () => {
    let s = createPsa(5, 7);
    const picks: ('low' | 'high')[] = ['high', 'low', 'low', 'high', 'high', 'low', 'high'];
    for (const p of picks) s = pick(s, p);
    expect(isDone(s)).toBe(true);
    expect(s.steps).toHaveLength(7);
    expect(s.high - s.low).toBeCloseTo(5 / 128, 10);
    const frozen = pick(s, 'low');
    expect(frozen).toBe(s);
  });

  it('finds a hidden preference when choices follow it', () => {
    const truth = 3.37;
    let s = createPsa(5, 9);
    while (!isDone(s)) {
      const st = currentStep(s);
      s = pick(s, Math.abs(st.low - truth) < Math.abs(st.high - truth) ? 'low' : 'high');
    }
    expect(Math.abs(estimate(s) - truth)).toBeLessThan(0.05);
  });

  it('maps blind samples to the right side', () => {
    const s = createPsa(4, 7, 0.5, always(0.9)); // alpha = high
    const st = currentStep(s);
    expect(sensOf(st, 'alpha')).toBe(6);
    expect(sensOf(st, 'beta')).toBe(2);
  });

  it('undoes the last decision', () => {
    let s = createPsa(4, 7);
    s = pick(s, 'high');
    s = undo(s);
    expect(s.steps).toHaveLength(1);
    expect(currentStep(s).picked).toBeUndefined();
    expect([s.low, s.high]).toEqual([2, 6]);
  });
});

describe('flick analysis', () => {
  // Minimum-jerk profile to a given endpoint, sampled at 144 Hz, then an optional correction.
  function flick(endpoint: number, target = 60, correction = true): AimSample[] {
    const out: AimSample[] = [];
    const T = 0.25;
    let t = 0;
    for (; t <= T; t += 1 / 144) {
      const x = t / T;
      const s = 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5;
      out.push({ t, yaw: endpoint * s, pitch: 0 });
    }
    for (let i = 0; i < 20; i++) {
      t += 1 / 144;
      out.push({ t, yaw: endpoint, pitch: 0 }); // dwell
    }
    if (correction) {
      const from = endpoint;
      for (let i = 1; i <= 30; i++) {
        t += 1 / 144;
        out.push({ t, yaw: from + ((target - from) * i) / 30, pitch: 0 });
      }
    }
    return out;
  }

  const start = { yaw: 0, pitch: 0 };
  const target = { yaw: 60, pitch: 0 };

  it('detects an overshoot', () => {
    const a = analyseFlick(flick(72), start, target, 1);
    expect(a.cls).toBe('overshoot');
    expect(a.endProgress).toBeGreaterThan(1.1);
  });

  it('detects an undershoot', () => {
    const a = analyseFlick(flick(48), start, target, 1);
    expect(a.cls).toBe('undershoot');
  });

  it('accepts a clean flick', () => {
    const a = analyseFlick(flick(60.3, 60, false), start, target, 1);
    expect(a.cls).toBe('clean');
  });

  it('ignores tiny adjustments', () => {
    expect(analyseFlick(flick(1.5, 1.5), start, { yaw: 1.5, pitch: 0 }, 1).cls).toBe('micro');
  });

  it('summarises bias', () => {
    const list = [flick(72), flick(70), flick(48)].map((f) => analyseFlick(f, start, target, 1));
    const t = tallyFlicks(list);
    expect(t).toMatchObject({ overshoot: 2, undershoot: 1, total: 3 });
    expect(flickBias(t)).toBeCloseTo(1 / 3, 10);
  });
});

describe('trial score', () => {
  it('rewards better tracking under a tracking focus', () => {
    const base = {
      trackErr: 1,
      trackTrail: 0,
      flickTimeMs: 700,
      flickHitRate: 1,
      flickAcc: 0.8,
      tally: { overshoot: 0, undershoot: 0, clean: 0, total: 0 },
    };
    const good = trialScore({ ...base, trackAcc: 0.6 }, 'tracking');
    const bad = trialScore({ ...base, trackAcc: 0.4 }, 'tracking');
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(100);
  });
});
