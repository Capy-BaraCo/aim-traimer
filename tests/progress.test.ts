import { describe, expect, it } from 'vitest';
import { feedback, flickFindings, LiveCoach, trackingFindings } from '../src/core/coach';
import { applyRun, rankFor, starsFor, streak, unlockedLevel, type DrillProgress } from '../src/core/progress';
import type { FlickRecord, FlickSummary } from '../src/core/analytics';

describe('levels and stars', () => {
  const T = [40, 55, 70] as const;

  it('awards stars by threshold', () => {
    expect(starsFor(39, T)).toBe(0);
    expect(starsFor(40, T)).toBe(1);
    expect(starsFor(69.9, T)).toBe(2);
    expect(starsFor(90, T)).toBe(3);
  });

  it('unlocks the next level with one star and keeps the best result', () => {
    const p: DrillProgress = { levels: {}, runs: 0, lastLevel: 1 };
    expect(unlockedLevel(p)).toBe(1);
    const a = applyRun(p, 1, 30, T);
    expect(a.stars).toBe(0);
    expect(a.unlocked).toBeNull();
    const b = applyRun(p, 1, 58, T);
    expect(b.stars).toBe(2);
    expect(b.unlocked).toBe(2);
    expect(b.starsGained).toBe(2);
    const c = applyRun(p, 1, 45, T);
    expect(c.newBest).toBe(false);
    expect(p.levels[1]).toMatchObject({ best: 58, stars: 2, runs: 3 });
    expect(unlockedLevel(p)).toBe(2);
  });

  it('ranks by total stars', () => {
    expect(rankFor(0).name).toBe('Recruit');
    expect(rankFor(8).name).toBe('Spotter');
    const r = rankFor(30);
    expect(r.name).toBe('Surveyor');
    expect(r.progress).toBeCloseTo(0.5, 5);
    expect(rankFor(999).next).toBeNull();
  });

  it('counts a practice streak', () => {
    expect(streak(['2026-09-25', '2026-09-26', '2026-09-27'], '2026-09-27')).toBe(3);
    // Not practised yet today: yesterday's streak still counts.
    expect(streak(['2026-09-25', '2026-09-26'], '2026-09-27')).toBe(2);
    expect(streak(['2026-09-20'], '2026-09-27')).toBe(0);
  });
});

const summary = (over: Partial<FlickSummary>): FlickSummary => ({
  shown: 12,
  hits: 12,
  n: 12,
  tally: { overshoot: 9, undershoot: 1, clean: 2, total: 12 },
  bias: 8 / 12,
  landing: 1.12,
  spread: 0.1,
  sideBias: 0,
  curve: 0.05,
  reactionMs: 250,
  ballisticMs: 220,
  correctionMs: 150,
  totalMs: 620,
  corrections: 0.8,
  flickThrough: 0.1,
  clickSpeed: 10,
  miss: { early: 0, late: 0, side: 0, total: 0 },
  buckets: {
    short: { n: 6, landing: 1.15, bias: 0.8, totalMs: 500 },
    mid: { n: 0, landing: NaN, bias: 0, totalMs: NaN },
    wide: { n: 6, landing: 1.1, bias: 0.6, totalMs: 800 },
  },
  dirs: {
    right: { n: 6, landing: 1.0, bias: 0 } as { n: number; landing: number },
    left: { n: 6, landing: 1.2 },
    up: { n: 0, landing: NaN },
    down: { n: 0, landing: NaN },
  },
  rangeEffect: 0.05,
  profile: new Array(16).fill(0.5),
  peakAt: 0.5,
  ...over,
});

describe('coach', () => {
  it('explains an overshoot habit in plain words and points to a drill', () => {
    const f = flickFindings(summary({}), 'short');
    const over = f.find((x) => x.id === 'overshoot');
    expect(over?.title).toMatch(/fly past/i);
    expect(over?.drill).toBe('blink');
    expect(f.some((x) => x.id === 'dir-right')).toBe(true);
    const fb = feedback(f);
    expect(fb.fixes[0].id).toBe('overshoot');
    expect(fb.next).toBe('blink');
  });

  it('praises balanced flicks', () => {
    const f = flickFindings(summary({ bias: 0, tally: { overshoot: 3, undershoot: 3, clean: 6, total: 12 }, landing: 1.0 }));
    expect(f.some((x) => x.kind === 'good' && x.id === 'balanced')).toBe(true);
  });

  it('flags slow tracking reactions', () => {
    const f = trackingFindings({
      acc: 0.4,
      meanError: 1,
      trail: 0.1,
      vertical: 0,
      summary: { delayMs: 290, aimReversals: 3, targetReversals: 2.5, jitter: 0.5, series: [] },
    });
    expect(f[0].id).toBe('track-delay');
  });

  it('gives live cues only for patterns and rate-limits them', () => {
    const said: string[] = [];
    const coach = new LiveCoach((t) => said.push(t));
    coach.tick(5);
    const rec = { cls: 'overshoot', reactionMs: 200, curve: 0.02, flickThrough: false } as FlickRecord;
    coach.flick(rec);
    coach.flick(rec);
    expect(said).toHaveLength(0);
    coach.flick(rec);
    expect(said).toHaveLength(1);
    coach.flick(rec);
    coach.flick(rec);
    coach.flick(rec);
    expect(said).toHaveLength(1);
  });
});
