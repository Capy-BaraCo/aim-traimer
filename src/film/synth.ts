/**
 * Example flicks for the Field Manual, built as real 120 Hz aim samples and run through the same
 * analyser as your own flicks — so the demo numbers are measured, not typed in.
 */

import { recordFlick, type ClickSample, type FlickRecord } from '../core/analytics';
import type { AimSample } from '../core/metrics';
import { minJerk } from './take';

export type DemoKind = 'overshoot' | 'undershoot' | 'curve' | 'driveby' | 'slowstart' | 'slowfix' | 'clean';

interface Move {
  /** When this movement starts and how long it takes, ms. */
  at: number;
  dur: number;
  /** Where it ends (along, perp as fractions of the distance). */
  to: [number, number];
  /** <1 pushes the peak speed earlier (a hard, early throw). */
  skew?: number;
  /** Sideways bow in the middle of the move, fraction of the distance. */
  bow?: number;
}

interface Script {
  distance: number;
  dirDeg: number;
  radius: number;
  moves: Move[];
  /** Clicks: ms and whether they hit. */
  clicks: [number, boolean][];
}

const SCRIPTS: Record<DemoKind, Script> = {
  overshoot: {
    distance: 36,
    dirDeg: 8,
    radius: 1.2,
    moves: [
      { at: 230, dur: 185, to: [1.24, 0.02], skew: 0.72 },
      { at: 430, dur: 120, to: [0.975, 0.0] },
      { at: 560, dur: 70, to: [1, 0] },
    ],
    clicks: [[665, true]],
  },
  undershoot: {
    distance: 36,
    dirDeg: 172,
    radius: 1.2,
    moves: [
      { at: 240, dur: 200, to: [0.79, -0.01] },
      { at: 470, dur: 110, to: [0.9, -0.005] },
      { at: 600, dur: 150, to: [1, 0] },
    ],
    clicks: [[790, true]],
  },
  curve: {
    distance: 48,
    dirDeg: 4,
    radius: 1.3,
    moves: [
      { at: 225, dur: 230, to: [1.0, 0.09], bow: 0.2 },
      { at: 490, dur: 140, to: [1, 0] },
    ],
    clicks: [[665, true]],
  },
  driveby: {
    distance: 28,
    dirDeg: -6,
    radius: 1.1,
    moves: [
      { at: 220, dur: 175, to: [1.14, 0.0], skew: 0.85 },
      { at: 420, dur: 110, to: [1, 0] },
    ],
    clicks: [[351, true]],
  },
  slowstart: {
    distance: 32,
    dirDeg: 186,
    radius: 1.2,
    moves: [
      { at: 430, dur: 200, to: [0.98, 0] },
      { at: 650, dur: 60, to: [1, 0] },
    ],
    clicks: [[740, true]],
  },
  slowfix: {
    distance: 40,
    dirDeg: 10,
    radius: 1.1,
    moves: [
      { at: 225, dur: 210, to: [0.93, 0.06] },
      { at: 470, dur: 90, to: [1.03, 0.03] },
      { at: 600, dur: 90, to: [0.99, -0.01] },
      { at: 730, dur: 80, to: [1, 0] },
    ],
    clicks: [[860, true]],
  },
  clean: {
    distance: 34,
    dirDeg: 6,
    radius: 1.2,
    moves: [
      { at: 215, dur: 205, to: [0.975, 0.005] },
      { at: 435, dur: 60, to: [1, 0] },
    ],
    clicks: [[525, true]],
  },
};

/** A skewed minimum-jerk: same start and end, but the fast part can come early. */
const shaped = (x: number, skew = 1) => minJerk(Math.pow(Math.min(1, Math.max(0, x)), skew));

export function demoRecord(kind: DemoKind): FlickRecord {
  const sc = SCRIPTS[kind];
  const rad = (sc.dirDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const toAim = (along: number, perp: number) => ({
    yaw: sc.distance * (along * ux - perp * uy),
    pitch: sc.distance * (along * uy + perp * ux),
  });
  const end = Math.max(...sc.clicks.map((c) => c[0])) + 40;
  const pos = (t: number): [number, number] => {
    let cur: [number, number] = [0, 0];
    for (const m of sc.moves) {
      if (t <= m.at) break;
      const k = (t - m.at) / m.dur;
      const s = shaped(k, m.skew);
      const bow = m.bow ? m.bow * Math.sin(Math.PI * Math.min(1, k)) : 0;
      cur = [cur[0] + (m.to[0] - cur[0]) * s, cur[1] + (m.to[1] - cur[1]) * s + bow];
      if (k < 1) break;
      cur = [m.to[0], m.to[1]];
    }
    return cur;
  };
  const samples: AimSample[] = [];
  const clicks: ClickSample[] = [];
  const step = 1000 / 120;
  for (let t = 0; t <= end; t += step) {
    // Clicks land between frames; keep samples in time order.
    for (const [ct, hit] of sc.clicks)
      if (ct > t - step && ct < t) {
        const [ca, cp] = pos(ct);
        const aim = toAim(ca, cp);
        samples.push({ t: ct / 1000, ...aim });
        clicks.push({ t: ct / 1000, ...aim, hit });
      }
    const [a, p] = pos(t);
    samples.push({ t: t / 1000, ...toAim(a, p) });
  }
  const lastClick = sc.clicks[sc.clicks.length - 1];
  return recordFlick(samples, { yaw: 0, pitch: 0 }, toAim(1, 0), sc.radius, clicks, lastClick[1], lastClick[0] / 1000);
}
