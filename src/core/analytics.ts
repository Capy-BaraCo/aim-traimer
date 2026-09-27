/**
 * Deep aim analytics.
 *
 * A flick is broken into four phases, the way motor-control research describes aimed movements:
 *   reaction  – target appeared, hand hasn't moved yet
 *   ballistic – the one big "throw" of the mouse
 *   correction – the small fixes after the throw lands
 *   click
 * Where the ballistic throw lands (relative to the target) is the single most useful number for
 * sensitivity work: land past it and you overshoot, land short and you undershoot.
 *
 * All angles in degrees. Aim space: +x = right (yaw), +y = up (pitch).
 */

import type { AimSample, FlickClass, FlickTally } from './metrics';

export type RangeBucket = 'short' | 'mid' | 'wide';
export type DirSector = 'right' | 'left' | 'up' | 'down';

export const BUCKETS: readonly RangeBucket[] = ['short', 'mid', 'wide'];
export const BUCKET_LABEL: Record<RangeBucket, string> = { short: 'Short · under 30°', mid: 'Medium · 30–70°', wide: 'Wide · over 70°' };
export const SECTORS: readonly DirSector[] = ['right', 'left', 'up', 'down'];

export const bucketOf = (deg: number): RangeBucket => (deg < 30 ? 'short' : deg < 70 ? 'mid' : 'wide');

export function sectorOf(dirDeg: number): DirSector {
  const a = ((dirDeg % 360) + 360) % 360;
  if (a < 45 || a >= 315) return 'right';
  if (a < 135) return 'up';
  if (a < 225) return 'left';
  return 'down';
}

export interface ClickSample {
  t: number;
  yaw: number;
  pitch: number;
  hit: boolean;
}

export interface FlickRecord {
  distance: number;
  radius: number;
  bucket: RangeBucket;
  dir: DirSector;
  dirDeg: number;
  cls: FlickClass;
  hit: boolean;
  reactionMs: number;
  ballisticMs: number;
  correctionMs: number;
  totalMs: number;
  /** Where the throw stopped along the line to the target: 1 = dead centre, 0.9 = 10% short. */
  endAlong: number;
  /** Sideways miss of the throw as a fraction of the distance (+ = anticlockwise of the path). */
  endPerp: number;
  /** Largest sideways bulge of the path during the throw, as a fraction of the distance. */
  curve: number;
  peakSpeed: number;
  /** When peak speed happened within the throw (0..1). 0.5 = a symmetrical, well-planned movement. */
  peakAt: number;
  corrections: number;
  /** Crosshair speed (°/s) at the moment of the hitting click. */
  clickSpeed: number;
  /** Clicked while still moving fast (a "drive-by" rather than a stop-and-shoot). */
  flickThrough: boolean;
  /** Missed clicks relative to the target centre, in target radii (along + = past it). */
  misses: { along: number; perp: number }[];
  /** Normalised path (along, perp) for plotting, target at (1, 0). */
  path: [number, number][];
  /** Speed during the throw, 16 bins, normalised to the peak. */
  profile: number[];
}

const MIN_PEAK = 25; // °/s: slower than this and there was no real throw

/** Pull a detailed record out of a sampled aim trajectory. */
export function recordFlick(
  samples: readonly AimSample[],
  start: { yaw: number; pitch: number },
  target: { yaw: number; pitch: number },
  radiusDeg: number,
  clicks: readonly ClickSample[],
  hit: boolean,
  resolvedAt?: number,
): FlickRecord {
  const dy = target.yaw - start.yaw;
  const dp = target.pitch - start.pitch;
  const dist = Math.hypot(dy, dp) || 1e-6;
  const ux = dy / dist;
  const uy = dp / dist;
  const nx = -uy;
  const ny = ux;
  const dirDeg = (Math.atan2(dp, dy) * 180) / Math.PI;
  const n = samples.length;
  const along = samples.map((s) => (s.yaw - start.yaw) * ux + (s.pitch - start.pitch) * uy);
  const perp = samples.map((s) => (s.yaw - start.yaw) * nx + (s.pitch - start.pitch) * ny);

  const vel: number[] = new Array(n).fill(0);
  const speed: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const j = Math.max(0, i - 2);
    const dt = samples[i].t - samples[j].t;
    if (dt > 1e-6) {
      vel[i] = (along[i] - along[j]) / dt;
      speed[i] = Math.hypot(samples[i].yaw - samples[j].yaw, samples[i].pitch - samples[j].pitch) / dt;
    } else {
      vel[i] = vel[i - 1];
      speed[i] = speed[i - 1];
    }
  }

  let peak = 0;
  let peakIdx = 0;
  let endIdx = -1;
  for (let i = 1; i < n; i++) {
    if (vel[i] > peak) {
      peak = vel[i];
      peakIdx = i;
    }
    if (peak >= MIN_PEAK && (vel[i] < peak * 0.15 || vel[i] <= 0)) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) endIdx = Math.max(0, n - 1);

  let onsetIdx = 0;
  if (peak >= MIN_PEAK) {
    const thr = Math.max(8, peak * 0.1);
    onsetIdx = peakIdx;
    while (onsetIdx > 0 && vel[onsetIdx - 1] >= thr) onsetIdx--;
  } else {
    onsetIdx = speed.findIndex((v) => v > 8);
    if (onsetIdx < 0) onsetIdx = 0;
  }

  const t = (i: number) => (n ? samples[Math.min(n - 1, Math.max(0, i))].t : 0);
  const tResolve = resolvedAt ?? t(n - 1);
  const reactionMs = t(onsetIdx) * 1000;
  const ballisticMs = Math.max(0, t(endIdx) - t(onsetIdx)) * 1000;
  const totalMs = tResolve * 1000;
  const correctionMs = Math.max(0, totalMs - reactionMs - ballisticMs);

  const endAlong = n ? along[endIdx] / dist : 0;
  const endPerp = n ? perp[endIdx] / dist : 0;
  let curve = 0;
  for (let i = 0; i <= endIdx && i < n; i++) curve = Math.max(curve, Math.abs(perp[i]) / dist);

  const span = Math.max(1e-6, t(endIdx) - t(onsetIdx));
  const peakAt = peak >= MIN_PEAK ? Math.min(1, Math.max(0, (t(peakIdx) - t(onsetIdx)) / span)) : 0.5;

  const profile: number[] = [];
  for (let b = 0; b < 16; b++) {
    const tt = t(onsetIdx) + ((b + 0.5) / 16) * span;
    let k = onsetIdx;
    while (k < endIdx && t(k + 1) < tt) k++;
    const v = peak > 0 ? Math.max(0, vel[Math.min(k + 1, n - 1)] / peak) : 0;
    profile.push(Math.min(1.2, v));
  }

  let corrections = 0;
  let lastSign = 0;
  for (let i = endIdx + 1; i < n; i++) {
    const v = vel[i];
    if (Math.abs(v) < 4) continue;
    const s = Math.sign(v);
    if (lastSign !== 0 && s !== lastSign) corrections++;
    lastSign = s;
  }

  const speedAt = (tc: number): number => {
    if (!n) return 0;
    let k = 0;
    while (k < n - 1 && samples[k + 1].t <= tc) k++;
    return speed[Math.min(n - 1, k + 1)] ?? 0;
  };
  const misses: { along: number; perp: number }[] = [];
  let clickSpeed = 0;
  for (const c of clicks) {
    const a = (c.yaw - start.yaw) * ux + (c.pitch - start.pitch) * uy - dist;
    const p = (c.yaw - start.yaw) * nx + (c.pitch - start.pitch) * ny;
    if (c.hit) clickSpeed = speedAt(c.t);
    else misses.push({ along: a / Math.max(radiusDeg, 1e-3), perp: p / Math.max(radiusDeg, 1e-3) });
  }
  const flickThrough = hit && peak >= MIN_PEAK && clickSpeed > Math.max(40, peak * 0.3);

  const step = Math.max(1, Math.ceil(n / 28));
  const path: [number, number][] = [];
  for (let i = 0; i < n; i += step) path.push([round3(along[i] / dist), round3(perp[i] / dist)]);
  if (n && (n - 1) % step !== 0) path.push([round3(along[n - 1] / dist), round3(perp[n - 1] / dist)]);

  const tol = radiusDeg / dist;
  const cls: FlickClass =
    dist < radiusDeg * 2.5 || peak < MIN_PEAK
      ? 'micro'
      : endAlong > 1 + tol
        ? 'overshoot'
        : endAlong < 1 - tol
          ? 'undershoot'
          : 'clean';

  return {
    distance: dist,
    radius: radiusDeg,
    bucket: bucketOf(dist),
    dir: sectorOf(dirDeg),
    dirDeg,
    cls,
    hit,
    reactionMs,
    ballisticMs,
    correctionMs,
    totalMs,
    endAlong,
    endPerp,
    curve,
    peakSpeed: peak,
    peakAt,
    corrections,
    clickSpeed,
    flickThrough,
    misses,
    path,
    profile,
  };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export const median = (xs: readonly number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface BucketStat {
  n: number;
  landing: number;
  bias: number;
  totalMs: number;
}

export interface FlickSummary {
  shown: number;
  hits: number;
  /** Flicks big enough to judge over/under (not micro adjustments). */
  n: number;
  tally: FlickTally;
  bias: number;
  landing: number;
  /** How much the landing point varies (robust SD of endAlong). Lower = more consistent. */
  spread: number;
  sideBias: number;
  curve: number;
  reactionMs: number;
  ballisticMs: number;
  correctionMs: number;
  totalMs: number;
  corrections: number;
  flickThrough: number;
  clickSpeed: number;
  miss: { early: number; late: number; side: number; total: number };
  buckets: Record<RangeBucket, BucketStat>;
  dirs: Record<DirSector, { n: number; landing: number }>;
  /** landing(short) − landing(longer): + = short flicks go further than long ones (the "range effect"). */
  rangeEffect: number | null;
  profile: number[];
  peakAt: number;
}

export function summariseFlicks(records: readonly FlickRecord[]): FlickSummary {
  const judged = records.filter((r) => r.cls !== 'micro');
  const hits = records.filter((r) => r.hit);
  const tally: FlickTally = { overshoot: 0, undershoot: 0, clean: 0, total: 0 };
  for (const r of judged) {
    tally[r.cls as 'overshoot' | 'undershoot' | 'clean']++;
    tally.total++;
  }
  const ends = judged.map((r) => r.endAlong);
  const landing = median(ends);
  const mad = median(ends.map((e) => Math.abs(e - landing)));

  const bucketStat = (b: RangeBucket): BucketStat => {
    const rs = judged.filter((r) => r.bucket === b);
    const hs = records.filter((r) => r.bucket === b && r.hit);
    const over = rs.filter((r) => r.cls === 'overshoot').length;
    const under = rs.filter((r) => r.cls === 'undershoot').length;
    return {
      n: rs.length,
      landing: median(rs.map((r) => r.endAlong)),
      bias: rs.length ? (over - under) / rs.length : 0,
      totalMs: median(hs.map((r) => r.totalMs)),
    };
  };
  const buckets = { short: bucketStat('short'), mid: bucketStat('mid'), wide: bucketStat('wide') };
  const dirs = Object.fromEntries(
    SECTORS.map((s) => {
      const rs = judged.filter((r) => r.dir === s);
      return [s, { n: rs.length, landing: median(rs.map((r) => r.endAlong)) }];
    }),
  ) as Record<DirSector, { n: number; landing: number }>;

  let rangeEffect: number | null = null;
  const far = buckets.wide.n >= 3 ? buckets.wide : buckets.mid.n >= 3 ? buckets.mid : null;
  if (buckets.short.n >= 3 && far) rangeEffect = buckets.short.landing - far.landing;

  const profile = new Array(16).fill(0);
  const withProfile = judged.filter((r) => r.profile.length === 16);
  for (const r of withProfile) r.profile.forEach((v, i) => (profile[i] += v / withProfile.length));

  const miss = { early: 0, late: 0, side: 0, total: 0 };
  for (const r of records)
    for (const m of r.misses) {
      miss.total++;
      if (Math.abs(m.perp) > Math.abs(m.along)) miss.side++;
      else if (m.along < 0) miss.early++;
      else miss.late++;
    }

  return {
    shown: records.length,
    hits: hits.length,
    n: judged.length,
    tally,
    bias: tally.total ? (tally.overshoot - tally.undershoot) / tally.total : 0,
    landing,
    spread: Number.isFinite(mad) ? mad * 1.4826 : NaN,
    sideBias: avg(judged.map((r) => r.endPerp)),
    curve: median(judged.map((r) => r.curve)),
    reactionMs: median(records.map((r) => r.reactionMs)),
    ballisticMs: median(judged.map((r) => r.ballisticMs)),
    correctionMs: median(hits.map((r) => r.correctionMs)),
    totalMs: median(hits.map((r) => r.totalMs)),
    corrections: avg(judged.map((r) => r.corrections)),
    flickThrough: hits.length ? hits.filter((r) => r.flickThrough).length / hits.length : 0,
    clickSpeed: median(hits.map((r) => r.clickSpeed)),
    miss,
    buckets,
    dirs,
    rangeEffect,
    profile,
    peakAt: avg(judged.map((r) => r.peakAt)),
  };
}

// ------------------------------------------------------------------------------------------------
// Tracking

export interface TrackingPoint {
  t: number;
  /** Horizontal / vertical error to the aim point (target − crosshair), degrees. */
  e: number;
  p: number;
  /** Target's angular radius. */
  r: number;
  on: boolean;
}

export interface TrackingSummary {
  /** How far behind the target your hand moves, from cross-correlating their movement with yours. */
  delayMs: number | null;
  /** Your direction changes per second vs the target's. Extra ones are corrections / shakiness. */
  aimReversals: number;
  targetReversals: number;
  jitter: number;
  series: TrackingPoint[];
}

/** Records aim and target yaw over time so we can measure reaction delay and smoothness. */
export class TrackingTrace {
  private readonly t: number[] = [];
  private readonly aim: number[] = [];
  private readonly tgt: number[] = [];
  private readonly seg: number[] = [];
  private readonly points: TrackingPoint[] = [];

  push(t: number, aimYaw: number, targetYaw: number, segment: number, point: TrackingPoint): void {
    this.t.push(t);
    this.aim.push(aimYaw);
    this.tgt.push(targetYaw);
    this.seg.push(segment);
    this.points.push(point);
  }

  get length(): number {
    return this.t.length;
  }

  summary(): TrackingSummary {
    const segs = this.segments();
    const delayMs = estimateDelay(segs);
    const dur = segs.reduce((s, g) => s + (g.t.length ? g.t[g.t.length - 1] - g.t[0] : 0), 0);
    let aimRev = 0;
    let tgtRev = 0;
    for (const g of segs) {
      aimRev += reversals(velocities(g.t, g.aim));
      tgtRev += reversals(velocities(g.t, g.tgt));
    }
    const aimReversals = dur > 0 ? aimRev / dur : 0;
    const targetReversals = dur > 0 ? tgtRev / dur : 0;
    const step = Math.max(1, Math.ceil(this.points.length / 160));
    return {
      delayMs,
      aimReversals,
      targetReversals,
      jitter: Math.max(0, aimReversals - targetReversals),
      series: this.points.filter((_, i) => i % step === 0),
    };
  }

  private segments(): { t: number[]; aim: number[]; tgt: number[] }[] {
    const out: { t: number[]; aim: number[]; tgt: number[] }[] = [];
    let cur: { t: number[]; aim: number[]; tgt: number[] } | null = null;
    let last = NaN;
    for (let i = 0; i < this.t.length; i++) {
      if (!cur || this.seg[i] !== last) {
        cur = { t: [], aim: [], tgt: [] };
        out.push(cur);
        last = this.seg[i];
      }
      cur.t.push(this.t[i]);
      cur.aim.push(this.aim[i]);
      cur.tgt.push(this.tgt[i]);
    }
    return out.filter((s) => s.t.length > 12);
  }
}

const GRID = 1 / 120;

function resample(t: readonly number[], v: readonly number[]): number[] {
  const out: number[] = [];
  if (t.length < 2) return out;
  let k = 0;
  for (let x = t[0]; x <= t[t.length - 1]; x += GRID) {
    while (k < t.length - 2 && t[k + 1] < x) k++;
    const span = t[k + 1] - t[k] || 1e-6;
    const f = Math.min(1, Math.max(0, (x - t[k]) / span));
    out.push(v[k] + (v[k + 1] - v[k]) * f);
  }
  return out;
}

function velocities(t: readonly number[], v: readonly number[]): number[] {
  const r = resample(t, v);
  const out: number[] = [];
  for (let i = 1; i < r.length - 1; i++) out.push((r[i + 1] - r[i - 1]) / (2 * GRID));
  return out;
}

/** Direction changes with a small dead-zone so sensor noise doesn't count. */
function reversals(vel: readonly number[], dead = 6): number {
  let last = 0;
  let count = 0;
  for (const v of vel) {
    if (Math.abs(v) < dead) continue;
    const s = Math.sign(v);
    if (last && s !== last) count++;
    last = s;
  }
  return count;
}

/**
 * Cross-correlate target and aim angular velocity; the lag with the strongest match is how long
 * your hand takes to respond to what the target does.
 */
export function estimateDelay(segs: readonly { t: number[]; aim: number[]; tgt: number[] }[], maxMs = 450): number | null {
  const maxLag = Math.round(maxMs / 1000 / GRID);
  const pairs = segs.map((g) => ({ a: velocities(g.t, g.aim), b: velocities(g.t, g.tgt) })).filter((p) => p.a.length > maxLag + 20);
  if (!pairs.length) return null;
  let best = -Infinity;
  let bestLag = 0;
  for (let L = 0; L <= maxLag; L++) {
    let num = 0;
    let da = 0;
    let db = 0;
    for (const { a, b } of pairs) {
      for (let i = 0; i + L < a.length; i++) {
        num += b[i] * a[i + L];
        db += b[i] * b[i];
        da += a[i + L] * a[i + L];
      }
    }
    const c = num / Math.sqrt(Math.max(1e-9, da * db));
    if (c > best) {
      best = c;
      bestLag = L;
    }
  }
  return best > 0.3 ? bestLag * GRID * 1000 : null;
}
