import { describe, expect, it } from 'vitest';
import { estimateDelay, recordFlick, sectorOf, summariseFlicks, TrackingTrace, type ClickSample } from '../src/core/analytics';
import type { AimSample } from '../src/core/metrics';

const HZ = 240;

/** Synthetic flick: wait `react` s, minimum-jerk throw to `end` × target over `T` s, then correct. */
function flick(opts: { tx: number; ty?: number; end: number; react?: number; T?: number; bend?: number; clickAt?: 'settled' | 'moving' }) {
  const { tx, ty = 0, end, react = 0.2, T = 0.25, bend = 0 } = opts;
  const s: AimSample[] = [];
  let t = 0;
  for (; t < react; t += 1 / HZ) s.push({ t, yaw: 0, pitch: 0 });
  const t0 = t;
  for (; t <= t0 + T; t += 1 / HZ) {
    const x = (t - t0) / T;
    const k = 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5;
    const bulge = Math.sin(Math.PI * x) * bend;
    // bulge perpendicular to the path
    const len = Math.hypot(tx, ty);
    s.push({ t, yaw: tx * end * k + (-ty / len) * bulge, pitch: ty * end * k + (tx / len) * bulge });
  }
  const from = { yaw: tx * end, pitch: ty * end };
  for (let i = 0; i < 12; i++) s.push({ t: (t += 1 / HZ), ...from });
  for (let i = 1; i <= 36; i++) {
    const f = i / 36;
    s.push({ t: (t += 1 / HZ), yaw: from.yaw + (tx - from.yaw) * f, pitch: from.pitch + (ty - from.pitch) * f });
  }
  const clicks: ClickSample[] = [{ t, yaw: tx, pitch: ty, hit: true }];
  return { s, clicks, t };
}

describe('flick records', () => {
  it('splits reaction, throw and correction and measures the landing point', () => {
    const f = flick({ tx: 40, end: 1.2 });
    const r = recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: 40, pitch: 0 }, 1, f.clicks, true, f.t);
    expect(r.cls).toBe('overshoot');
    expect(r.endAlong).toBeGreaterThan(1.15);
    expect(r.endAlong).toBeLessThan(1.25);
    expect(r.reactionMs).toBeGreaterThan(170);
    expect(r.reactionMs).toBeLessThan(260);
    expect(r.ballisticMs).toBeGreaterThan(150);
    expect(r.ballisticMs).toBeLessThan(300);
    expect(r.correctionMs).toBeGreaterThan(100);
    expect(r.peakAt).toBeGreaterThan(0.3);
    expect(r.peakAt).toBeLessThan(0.7);
    expect(r.flickThrough).toBe(false);
    expect(r.bucket).toBe('mid');
    expect(r.dir).toBe('right');
  });

  it('knows direction and range', () => {
    const f = flick({ tx: -10, ty: 12, end: 0.85 });
    const r = recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: -10, pitch: 12 }, 0.5, f.clicks, true, f.t);
    expect(r.bucket).toBe('short');
    expect(r.dir).toBe('up');
    expect(r.cls).toBe('undershoot');
    expect(sectorOf(180)).toBe('left');
    expect(sectorOf(-90)).toBe('down');
  });

  it('measures a curved path', () => {
    const f = flick({ tx: 60, end: 1, bend: 9 });
    const r = recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: 60, pitch: 0 }, 1, f.clicks, true, f.t);
    expect(r.curve).toBeGreaterThan(0.12);
  });

  it('places missed clicks relative to the target', () => {
    const f = flick({ tx: 30, end: 1 });
    const clicks: ClickSample[] = [{ t: 0.3, yaw: 27, pitch: 0, hit: false }, ...f.clicks];
    const r = recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: 30, pitch: 0 }, 1, clicks, true, f.t);
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0].along).toBeCloseTo(-3, 5);
  });
});

describe('flick summary', () => {
  it('detects the range effect: short flicks long, wide flicks short', () => {
    const recs = [];
    for (const tx of [10, 14, 18, 22]) {
      const f = flick({ tx, end: 1.15 });
      recs.push(recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: tx, pitch: 0 }, 0.5, f.clicks, true, f.t));
    }
    for (const tx of [90, 100, 110]) {
      const f = flick({ tx, end: 0.85, T: 0.35 });
      recs.push(recordFlick(f.s, { yaw: 0, pitch: 0 }, { yaw: tx, pitch: 0 }, 1, f.clicks, true, f.t));
    }
    const s = summariseFlicks(recs);
    expect(s.buckets.short.bias).toBe(1);
    expect(s.buckets.wide.bias).toBe(-1);
    expect(s.rangeEffect).toBeGreaterThan(0.25);
    expect(s.hits).toBe(7);
    expect(s.profile.some((v) => v > 0.8)).toBe(true);
  });
});

describe('tracking delay', () => {
  it('recovers a 180 ms reaction delay from ADAD strafing', () => {
    const trace = new TrackingTrace();
    // Piecewise strafe at 30°/s whose direction flips on an irregular schedule.
    const flips = [0.4, 0.7, 1.3, 1.55, 2.2, 2.6, 3.1, 3.4, 4.0, 4.5, 5.1, 5.4, 6.0];
    const tgtAt = (t: number) => {
      let y = 0;
      let dir = 1;
      let last = 0;
      for (const f of flips) {
        if (f > t) break;
        y += dir * 30 * (f - last);
        last = f;
        dir = -dir;
      }
      return y + dir * 30 * (t - last);
    };
    for (let t = 0.5; t < 6; t += 1 / 144) {
      trace.push(t, tgtAt(t - 0.18), tgtAt(t), 0, { t, e: 0, p: 0, r: 1, on: true });
    }
    const s = trace.summary();
    expect(s.delayMs).not.toBeNull();
    expect(Math.abs((s.delayMs ?? 0) - 180)).toBeLessThan(20);
    expect(s.jitter).toBeLessThan(0.5);
  });

  it('returns null without enough movement', () => {
    expect(estimateDelay([])).toBeNull();
  });
});
