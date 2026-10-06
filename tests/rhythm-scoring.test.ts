import { describe, expect, it } from 'vitest';
import { levelParams } from '../src/rhythm/levels';
import { judge, judgeAt, judgeOrb, ScoreTally } from '../src/rhythm/scoring';
import type {
  BurstTarget, Chart, ChartTarget, DecoyTarget, FlickShape, FlickTarget, HoldTarget,
  PeekerTarget, StraferTarget, TargetPosition,
} from '../src/rhythm/types';

const position: TargetPosition = { bearing: 0, pitch: 0, distance: 10 };
const base = (time: number) => ({
  launchTime: time - 2, landTime: time - 1, targetTime: time,
  windowEnd: time + 1, position,
});
const flick = (time: number, shape: FlickShape = 'circle'): FlickTarget =>
  ({ ...base(time), kind: 'flick', shape });
const peeker = (time: number): PeekerTarget =>
  ({ ...base(time), kind: 'peeker', wall: 0, side: 1 });
const burst = (time: number): BurstTarget => ({
  ...base(time), kind: 'burst', windowEnd: time + 1,
  orbs: [time, time + 0.5].map((orbTime) => ({ time: orbTime, position })),
});
const strafer = (time: number): StraferTarget =>
  ({ ...base(time), kind: 'strafer', speed: 1, health: 60 });
const hold = (time: number): HoldTarget =>
  ({ ...base(time), kind: 'hold', path: [position, { ...position, bearing: 10 }] });
const decoy = (time: number): DecoyTarget => ({ ...base(time), kind: 'decoy' });
const chart = (...targets: ChartTarget[]): Chart => ({
  songId: 'test', preset: 'mixed', difficulty: 'easy', level: 1,
  duration: 60, targets, walls: [],
});
const result = (judgement: 'perfect' | 'early' | 'late' | 'miss', offsetMs = 0) =>
  ({ judgement, offsetMs });

describe('Overdrive Judgement', () => {
  it('includes the Perfect boundaries and grades one millisecond beyond them', () => {
    const width = levelParams(1).perfectMs;
    expect(judgeAt(-width / 1000, 0, -1, 1, width)).toEqual(result('perfect', -width));
    expect(judgeAt(width / 1000, 0, -1, 1, width)).toEqual(result('perfect', width));
    expect(judgeAt(-(width + 1) / 1000, 0, -1, 1, width).judgement).toBe('early');
    expect(judgeAt((width + 1) / 1000, 0, -1, 1, width).judgement).toBe('late');
    expect(judge(0, flick(0), 1).judgement).toBe('perfect');
  });

  it('includes both Hit window endpoints and misses one millisecond outside', () => {
    const target = flick(0);
    expect(judge(target.landTime, target, 1).judgement).toBe('early');
    expect(judge(target.windowEnd, target, 1).judgement).toBe('late');
    expect(judge(target.landTime - 0.001, target, 1).judgement).toBe('miss');
    expect(judge(target.windowEnd + 0.001, target, 1).judgement).toBe('miss');
    expect(judge(target.landTime - 0.001, target, 1).offsetMs).toBeCloseTo(-1001);
  });

  it('judges burst orbs at their own beats in order', () => {
    const target = burst(4);
    expect(judgeOrb(4, target, 0, 1).judgement).toBe('perfect');
    expect(judgeOrb(4.5, target, 1, 1).judgement).toBe('perfect');
    expect(judgeOrb(3.99, target, 1, 1).judgement).toBe('miss');
    expect(judgeOrb(4, target, 1, 1).judgement).toBe('early');
    expect(judgeOrb(4.5, target, 0, 1).judgement).toBe('late');
    expect(() => judgeOrb(4, target, 2, 1)).toThrow(RangeError);
  });
});

describe('Overdrive score tally', () => {
  it('raises the multiplier faster for Perfect and caps it at ×4', () => {
    const target = flick(0);
    const perfects = new ScoreTally(chart(...Array.from({ length: 16 }, (_, i) => flick(i))));
    const others = new ScoreTally(chart(...Array.from({ length: 25 }, (_, i) => flick(i))));
    for (let i = 1; i <= 16; i++) {
      perfects.tap(target, result('perfect'));
      if (i === 4) expect(perfects.multiplier).toBe(2);
      if (i === 12) expect(perfects.multiplier).toBe(4);
    }
    for (let i = 1; i <= 25; i++) {
      others.tap(target, result(i % 2 ? 'early' : 'late'));
      if (i === 4) expect(others.multiplier).toBe(1);
      if (i === 8) expect(others.multiplier).toBe(2);
      if (i === 24) expect(others.multiplier).toBe(4);
    }
    expect(perfects.multiplier).toBe(4);
    expect(others.multiplier).toBe(4);
    expect(perfects.result().maxCombo).toBe(32);
    perfects.miss(target);
    expect(perfects.combo).toBe(0);
    expect(perfects.multiplier).toBe(1);
  });

  it('resets combo and costs points for a decoy hit while ignoring a decoy changes nothing', () => {
    const tap = flick(1);
    const friend = decoy(2);
    const tally = new ScoreTally(chart(tap, friend));
    tally.tap(tap, result('perfect'));
    const before = tally.result();
    const withoutDecoy = new ScoreTally(chart(tap));
    withoutDecoy.tap(tap, result('perfect'));
    expect(before).toEqual(withoutDecoy.result());
    tally.decoyHit(friend);
    expect(tally.combo).toBe(0);
    expect(tally.result().points).toBe(before.points - 150);
    expect(tally.result().decoysHit).toBe(1);
    expect(tally.result().hitRate).toEqual(before.hitRate);
    expect(tally.result().counts).toEqual(before.counts);
  });

  it('scores tracking fractions and treats 0.29 as a combo Miss but 0.3 as a hit', () => {
    const target = strafer(0);
    const missed = new ScoreTally(chart(target));
    missed.tap(flick(0), result('perfect'));
    missed.tracking(target, 0.29);
    expect(missed.combo).toBe(0);
    expect(missed.result().points).toBe(129);
    expect(missed.result().hitRate.strafer).toBe(0);
    const hit = new ScoreTally(chart(target));
    hit.tracking(target, 0.3);
    expect(hit.combo).toBe(1);
    expect(hit.result().hitRate.strafer).toBe(1);
    expect(hit.result().points).toBe(30);
  });

  it('gives a diamond more Perfect points and scores a perfect run at 100', () => {
    const circle = flick(1);
    const diamond = flick(2, 'diamond');
    const target = burst(3);
    const tracker = hold(5);
    const tally = new ScoreTally(chart(circle, diamond, target, tracker));
    tally.tap(circle, result('perfect'));
    const first = tally.result().points;
    tally.tap(diamond, result('perfect'));
    expect(tally.result().points - first).toBe(150);
    tally.orb(target, 0, result('perfect'));
    tally.orb(target, 1, result('perfect'));
    tally.tracking(tracker, 1);
    expect(tally.result().score).toBe(100);
    expect(tally.result().points).toBe(tally.result().maxPoints);
    const misses = new ScoreTally(chart(circle, diamond, target, tracker));
    misses.miss(circle);
    misses.miss(diamond);
    misses.miss(target, 0);
    misses.miss(target, 1);
    misses.tracking(tracker, 0);
    expect(misses.result().score).toBe(0);
  });

  it('returns signed offsets, per-orb hit rates and flick shape rates', () => {
    const circle = flick(1);
    const diamond = flick(2, 'diamond');
    const target = burst(3);
    const peek = peeker(5);
    const tally = new ScoreTally(chart(circle, diamond, target, peek, hold(6)));
    tally.tap(circle, result('early', -40));
    tally.miss(diamond);
    tally.orb(target, 0, result('late', 20));
    tally.miss(target, 1);
    tally.tap(peek, result('perfect', 5));
    tally.tracking(hold(6), 0.3);
    expect(tally.result().offsets).toEqual([-40, 20, 5]);
    expect(tally.result().meanOffsetMs).toBe(-5);
    expect(tally.result().counts).toEqual({ perfect: 1, early: 1, late: 1, miss: 2 });
    expect(tally.result().hitRate).toEqual({ flick: 0.5, burst: 0.5, peeker: 1, hold: 1 });
    expect(tally.result().hitRateByShape).toEqual({ circle: 1, diamond: 0 });
  });

  it('handles a Chart with no scoreable targets', () => {
    const friend = decoy(1);
    const tally = new ScoreTally(chart(friend));
    expect(tally.result().score).toBe(100);
    expect(tally.result().hitRate).toEqual({});
    tally.decoyHit(friend);
    expect(tally.result().score).toBe(0);
  });

  it('keeps score in 0–100 and never lowers it when a miss becomes a hit across seeded runs', () => {
    let seed = 71231;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let run = 0; run < 60; run++) {
      const targets = Array.from({ length: 20 }, (_, i) => {
        const choice = Math.floor(random() * 5);
        return choice === 0 ? flick(i, random() < 0.3 ? 'diamond' : 'circle')
          : choice === 1 ? peeker(i) : choice === 2 ? burst(i)
            : choice === 3 ? strafer(i) : hold(i);
      });
      const outcomes = targets.map((target) => target.kind === 'burst'
        ? [random() < 0.5, random() < 0.5] : [random() < 0.5]);
      const chosen = Math.floor(random() * targets.length);
      const scoreFor = (improve: boolean) => {
        const tally = new ScoreTally(chart(...targets));
        targets.forEach((target, i) => {
          const hit = improve && i === chosen ? true : outcomes[i][0];
          if (target.kind === 'burst') {
            tally.orb(target, 0, result(hit ? 'perfect' : 'miss'));
            tally.orb(target, 1, result(outcomes[i][1] ? 'late' : 'miss'));
          } else if (target.kind === 'strafer' || target.kind === 'hold') {
            tally.tracking(target, hit ? 0.3 : 0.29);
          } else {
            tally.tap(target, result(hit ? 'early' : 'miss'));
          }
        });
        return tally.result().score;
      };
      const original = scoreFor(false);
      const improved = scoreFor(true);
      expect(original).toBeGreaterThanOrEqual(0);
      expect(original).toBeLessThanOrEqual(100);
      expect(improved).toBeGreaterThanOrEqual(original);
      expect(improved).toBeLessThanOrEqual(100);
    }
  });
});
