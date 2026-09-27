/**
 * A "take" is one flick you can play back: a timed path plus the numbers the coach uses.
 * Positions are normalised like the analytics: `along` 1 = the target, `perp` = sideways,
 * both as a fraction of the flick's distance.
 */

import type { FlickRecord } from '../core/analytics';

export interface Shot {
  t: number;
  along: number;
  perp: number;
  hit: boolean;
}

export interface Take {
  /** Degrees from where you aimed to the target. */
  distance: number;
  /** Direction of the target on screen: 0 = right, 90 = up. */
  dirDeg: number;
  /** Target angular radius, degrees. */
  radius: number;
  /** [ms since the target appeared, along, perp] */
  trace: [number, number, number][];
  shots: Shot[];
  reactionMs: number;
  ballisticMs: number;
  totalMs: number;
  endAlong: number;
  endPerp: number;
  peakAt: number;
  curve: number;
  hit: boolean;
  clickSpeed: number;
  flickThrough: boolean;
}

export type Phase = 'wait' | 'throw' | 'fix' | 'done';

export function takeOf(r: FlickRecord): Take | null {
  if (!r.trace || r.trace.length < 4) return null;
  return {
    distance: r.distance,
    dirDeg: r.dirDeg,
    radius: r.radius,
    trace: r.trace,
    shots: r.shots ?? [],
    reactionMs: r.reactionMs,
    ballisticMs: r.ballisticMs,
    totalMs: r.totalMs,
    endAlong: r.endAlong,
    endPerp: r.endPerp,
    peakAt: r.peakAt,
    curve: r.curve,
    hit: r.hit,
    clickSpeed: r.clickSpeed,
    flickThrough: r.flickThrough,
  };
}

/** Where the crosshair was at `t` ms (linear between samples; holds before the start and after the end). */
export function posAt(take: Take, t: number): { along: number; perp: number } {
  const tr = take.trace;
  if (t <= tr[0][0]) return { along: tr[0][1], perp: tr[0][2] };
  for (let i = 1; i < tr.length; i++) {
    const [t1, a1, p1] = tr[i];
    if (t <= t1) {
      const [t0, a0, p0] = tr[i - 1];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return { along: a0 + (a1 - a0) * k, perp: p0 + (p1 - p0) * k };
    }
  }
  const last = tr[tr.length - 1];
  return { along: last[1], perp: last[2] };
}

export function phaseAt(take: Take, t: number): Phase {
  if (t < take.reactionMs) return 'wait';
  if (t < take.reactionMs + take.ballisticMs) return 'throw';
  if (t < take.totalMs) return 'fix';
  return 'done';
}

/** Crosshair speed in degrees per second, sampled every `step` ms and lightly smoothed. */
export function speedSeries(take: Take, step = 10, until = take.totalMs + 150): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  const d = take.distance;
  for (let t = 0; t <= until; t += step) {
    const a = posAt(take, t - step);
    const b = posAt(take, t + step);
    out.push({ t, v: (Math.hypot(b.along - a.along, b.perp - a.perp) * d) / ((2 * step) / 1000) });
  }
  return out.map((p, i) => {
    const lo = out[Math.max(0, i - 1)].v;
    const hi = out[Math.min(out.length - 1, i + 1)].v;
    return { t: p.t, v: (lo + 2 * p.v + hi) / 4 };
  });
}

/** Minimum-jerk position curve: how a smooth, well-planned human movement travels (0..1 → 0..1). */
export const minJerk = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (10 - 15 * u + 6 * u * u);
};

/**
 * The corrected version of a flick: same target, same distance, a straight path, speed that rises and
 * falls evenly (peak halfway), landing at ~97% so the last bit is one small nudge, then a click once
 * stopped. `reactionMs` lets a lesson fix a slow start too.
 */
export function idealOf(you: Take, o: { reactionMs?: number; land?: number } = {}): Take {
  const reaction = Math.round(o.reactionMs ?? you.reactionMs);
  // Braking earlier takes a little longer than slamming past; never slower than a calm flick.
  const throwMs = Math.round(Math.min(480, Math.max(130, you.ballisticMs * (you.endAlong > 1.05 ? 1.12 : 1))));
  const land = o.land ?? 0.97;
  const fixMs = 70;
  const settleMs = 30;
  const click = reaction + throwMs + fixMs + settleMs;
  const trace: [number, number, number][] = [];
  const push = (t: number, along: number) => trace.push([Math.round(t), Math.round(along * 1000) / 1000, 0]);
  push(0, 0);
  push(reaction, 0);
  for (let k = 1; k <= 24; k++) push(reaction + (throwMs * k) / 24, land * minJerk(k / 24));
  for (let k = 1; k <= 8; k++) push(reaction + throwMs + (fixMs * k) / 8, land + (1 - land) * minJerk(k / 8));
  push(click, 1);
  return {
    distance: you.distance,
    dirDeg: you.dirDeg,
    radius: you.radius,
    trace,
    shots: [{ t: click, along: 1, perp: 0, hit: true }],
    reactionMs: reaction,
    ballisticMs: throwMs,
    totalMs: click,
    endAlong: land,
    endPerp: 0,
    peakAt: 0.5,
    curve: 0,
    hit: true,
    clickSpeed: 0,
    flickThrough: false,
  };
}
