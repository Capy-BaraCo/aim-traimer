import { describe, expect, it } from 'vitest';
import type { FlickRecord } from '../src/core/analytics';
import { buildLesson, demoLesson, examplesFor, LESSON_KINDS, lessonKindFor } from '../src/film/lessons';
import { demoRecord } from '../src/film/synth';
import { idealOf, posAt, speedSeries, takeOf } from '../src/film/take';

describe('demo flicks show the mistake they are named after', () => {
  it('is measured by the real analyser, not typed in', () => {
    expect(demoRecord('overshoot').cls).toBe('overshoot');
    expect(demoRecord('undershoot').cls).toBe('undershoot');
    expect(demoRecord('curve').curve).toBeGreaterThan(0.1);
    expect(demoRecord('driveby').flickThrough).toBe(true);
    expect(demoRecord('slowstart').reactionMs).toBeGreaterThan(300);
    const sf = demoRecord('slowfix');
    expect(sf.correctionMs).toBeGreaterThan(sf.ballisticMs * 1.2);
    const c = demoRecord('clean');
    expect(c.cls).toBe('clean');
    expect(c.flickThrough).toBe(false);
  });

  it('records a timed trace that passes through the landing point', () => {
    const r = demoRecord('overshoot');
    const land = r.reactionMs + r.ballisticMs;
    const p = r.trace!.find((q) => Math.abs(q[0] - land) <= 1);
    expect(p).toBeDefined();
    expect(p![1]).toBeCloseTo(r.endAlong, 2);
    expect(r.shots!.at(-1)!.hit).toBe(true);
  });
});

describe('the right way', () => {
  const you = takeOf(demoRecord('overshoot'))!;
  const fix = idealOf(you);

  it('ends on the target and clicks once, stopped', () => {
    expect(posAt(fix, fix.totalMs)).toEqual({ along: 1, perp: 0 });
    expect(fix.shots).toHaveLength(1);
    expect(fix.shots[0]).toMatchObject({ t: fix.totalMs, hit: true });
  });

  it('lands short of the target so the last bit is a small nudge', () => {
    expect(posAt(fix, fix.reactionMs + fix.ballisticMs).along).toBeCloseTo(0.97, 3);
  });

  it('peaks in speed halfway through the flick', () => {
    const s = speedSeries(fix, 5).filter((p) => p.t <= fix.reactionMs + fix.ballisticMs);
    const peak = s.reduce((a, b) => (b.v > a.v ? b : a));
    expect(Math.abs(peak.t - (fix.reactionMs + fix.ballisticMs / 2))).toBeLessThan(fix.ballisticMs * 0.12);
  });

  it('is faster overall than an overshoot and its long fix-up', () => {
    expect(fix.totalMs).toBeLessThan(you.totalMs);
  });

  it('can also fix a slow start', () => {
    const slow = takeOf(demoRecord('slowstart'))!;
    expect(idealOf(slow, { reactionMs: 220 }).reactionMs).toBe(220);
  });
});

describe('lessons', () => {
  it('maps coach findings to replays', () => {
    expect(lessonKindFor('overshoot')).toBe('overshoot');
    expect(lessonKindFor('dir-left')).toBe('undershoot');
    expect(lessonKindFor('late-click')).toBe('driveby');
    expect(lessonKindFor('consistent')).toBe('clean');
    expect(lessonKindFor('track-delay')).toBeNull();
  });

  it('picks your most typical example, not your worst', () => {
    const base = demoRecord('overshoot');
    const at = (endAlong: number): FlickRecord => ({ ...base, endAlong });
    const pool = [at(1.12), at(1.45), at(1.2), at(1.18), at(1.9)];
    expect(examplesFor(pool, 'overshoot')[0].endAlong).toBe(1.2);
  });

  it('prefers the direction the coach flagged', () => {
    const base = demoRecord('undershoot');
    const pool: FlickRecord[] = [
      { ...base, dir: 'right', endAlong: 0.8 },
      { ...base, dir: 'left', endAlong: 0.7 },
    ];
    expect(examplesFor(pool, 'undershoot', 'left')[0].dir).toBe('left');
  });

  it('skips flicks recorded before replays existed', () => {
    const old = { ...demoRecord('overshoot'), trace: undefined };
    expect(examplesFor([old], 'overshoot')).toHaveLength(0);
    expect(buildLesson('overshoot', old, { sens: 5, dpi: 800, source: 'x' })).toBeNull();
  });

  it('scripts every lesson with real numbers and sane beats', () => {
    for (const kind of LESSON_KINDS) {
      const l = demoLesson(kind, 5, 800);
      expect(l.beats.length).toBeGreaterThanOrEqual(3);
      for (const b of l.beats) {
        expect(b.to).toBeGreaterThan(b.from);
        expect(b.rate).toBeGreaterThan(0);
        expect(b.rate).toBeLessThanOrEqual(1);
        expect(`${b.title} ${b.text}`).not.toMatch(/NaN|undefined|Infinity/);
      }
      expect(l.tip.length).toBeGreaterThan(10);
    }
  });
});
