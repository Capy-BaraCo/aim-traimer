/**
 * Pure aim analytics. Angles are in degrees; yaw is unwrapped (it can exceed ±180).
 */

export interface AimSample {
  t: number;
  yaw: number;
  pitch: number;
}

export type FlickClass = 'overshoot' | 'undershoot' | 'clean' | 'micro';

export interface FlickAnalysis {
  cls: FlickClass;
  /** Where the primary (ballistic) movement stopped, as a fraction of the distance to the target centre. */
  endProgress: number;
  /** Peak angular speed along the flick axis, °/s. */
  peakSpeed: number;
  /** Direction reversals after the primary movement: a proxy for how much correcting happened. */
  corrections: number;
  distanceDeg: number;
}

/**
 * Split a flick into its ballistic primary movement and the corrections that follow.
 *
 * Motor-control research models a fast aimed movement as one big ballistic sub-movement followed by
 * small corrective ones. The primary movement ends when along-axis speed falls below 15% of its
 * peak or reverses. If it stops past the target's far edge the flick overshot; short of the near
 * edge, it undershot.
 */
export function analyseFlick(
  samples: readonly AimSample[],
  start: { yaw: number; pitch: number },
  target: { yaw: number; pitch: number },
  radiusDeg: number,
): FlickAnalysis {
  const dy = target.yaw - start.yaw;
  const dp = target.pitch - start.pitch;
  const dist = Math.hypot(dy, dp);
  const base: FlickAnalysis = { cls: 'micro', endProgress: 1, peakSpeed: 0, corrections: 0, distanceDeg: dist };
  if (dist < radiusDeg * 2.5 || samples.length < 3) return base;

  const ux = dy / dist;
  const uy = dp / dist;
  const along = samples.map((s) => (s.yaw - start.yaw) * ux + (s.pitch - start.pitch) * uy);

  // Smoothed along-axis velocity (two-sample window keeps frame jitter out of the peak).
  const vel: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    const j = Math.max(0, i - 2);
    const dt = samples[i].t - samples[j].t;
    vel.push(dt > 1e-6 ? (along[i] - along[j]) / dt : vel[i - 1]);
  }

  let peak = 0;
  let endIdx = -1;
  const MIN_PEAK = 25; // °/s — below this there was no real flick yet
  for (let i = 1; i < vel.length; i++) {
    if (vel[i] > peak) peak = vel[i];
    if (peak >= MIN_PEAK && (vel[i] < peak * 0.15 || vel[i] <= 0)) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) endIdx = samples.length - 1;
  const endProgress = along[endIdx] / dist;

  let corrections = 0;
  let lastSign = 0;
  for (let i = endIdx + 1; i < vel.length; i++) {
    const v = vel[i];
    if (Math.abs(v) < 4) continue;
    const sign = Math.sign(v);
    if (lastSign !== 0 && sign !== lastSign) corrections++;
    lastSign = sign;
  }

  const tol = radiusDeg / dist;
  const cls: FlickClass = endProgress > 1 + tol ? 'overshoot' : endProgress < 1 - tol ? 'undershoot' : 'clean';
  return { cls, endProgress, peakSpeed: peak, corrections, distanceDeg: dist };
}

export interface FlickTally {
  overshoot: number;
  undershoot: number;
  clean: number;
  total: number;
}

export function tallyFlicks(list: readonly FlickAnalysis[]): FlickTally {
  const t: FlickTally = { overshoot: 0, undershoot: 0, clean: 0, total: 0 };
  for (const f of list) {
    if (f.cls === 'micro') continue;
    t[f.cls]++;
    t.total++;
  }
  return t;
}

/** −1 = always undershoots, +1 = always overshoots, 0 = balanced. */
export const flickBias = (t: FlickTally): number => (t.total ? (t.overshoot - t.undershoot) / t.total : 0);

/** Running tracking statistics, fed once per frame. */
export class TrackingMeter {
  time = 0;
  onTime = 0;
  firingTime = 0;
  errSum = 0;
  /** Positive = crosshair trails the target, negative = leads it (°·s accumulated). */
  trailSum = 0;
  trailTime = 0;
  /** Signed vertical error (° · s): positive = crosshair sits below the aim point. */
  pitchSum = 0;

  add(dt: number, onTarget: boolean, firing: boolean, yawErr: number, pitchErr: number, targetYawRate: number): void {
    this.time += dt;
    if (firing) this.firingTime += dt;
    if (onTarget && firing) this.onTime += dt;
    this.errSum += Math.hypot(yawErr, pitchErr) * dt;
    this.pitchSum += pitchErr * dt;
    if (Math.abs(targetYawRate) > 8) {
      this.trailSum += yawErr * Math.sign(targetYawRate) * dt;
      this.trailTime += dt;
    }
  }

  get accuracy(): number {
    return this.time > 0 ? this.onTime / this.time : 0;
  }
  get meanError(): number {
    return this.time > 0 ? this.errSum / this.time : 0;
  }
  get trail(): number {
    return this.trailTime > 0 ? this.trailSum / this.trailTime : 0;
  }
  get verticalBias(): number {
    return this.time > 0 ? this.pitchSum / this.time : 0;
  }
}

export type Focus = 'balanced' | 'tracking' | 'flick';

export const FOCUS_WEIGHTS: Record<Focus, { track: number; speed: number; precision: number }> = {
  balanced: { track: 0.5, speed: 0.25, precision: 0.25 },
  tracking: { track: 0.7, speed: 0.15, precision: 0.15 },
  flick: { track: 0.3, speed: 0.35, precision: 0.35 },
};

export interface TrialMetrics {
  trackAcc: number; // 0..1
  trackErr: number; // mean deg
  trackTrail: number; // deg, + trailing
  flickTimeMs: number; // mean time-to-hit for hit targets
  flickHitRate: number; // targets hit / targets shown
  flickAcc: number; // hits / shots
  tally: FlickTally;
}

/** Map a mean time-to-hit to 0..1 (350 ms or faster = 1, 1400 ms or slower = 0). */
export const speedScore = (ms: number): number => Math.min(1, Math.max(0, (1400 - ms) / 1050));

export function trialScore(m: TrialMetrics, focus: Focus): number {
  const w = FOCUS_WEIGHTS[focus];
  const precision = m.flickAcc * 0.6 + m.flickHitRate * 0.4;
  const s = w.track * m.trackAcc + w.speed * speedScore(m.flickTimeMs) * m.flickHitRate + w.precision * precision;
  return Math.round(s * 1000) / 10;
}

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
