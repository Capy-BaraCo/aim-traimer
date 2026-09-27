import { Vector3 } from 'three';
import { recordFlick, TrackingTrace, type ClickSample, type FlickRecord } from '../core/analytics';
import type { LiveCoach, TrackingFacts } from '../core/coach';
import type { Game } from '../core/game';
import { TrackingMeter, type AimSample } from '../core/metrics';
import { angularRadiusDeg } from '../core/sens';
import type { Figure } from '../world/figure';

const _p = new Vector3();

/** Feeds a TrackingMeter, the tracking trace (delay/smoothness), the oscilloscope and the live coach. */
export class TrackingProbe {
  readonly meter = new TrackingMeter();
  readonly trace = new TrackingTrace();
  private prevYaw: number | null = null;
  private prevTarget: Figure | null = null;
  private segment = 0;
  private win = { t: 0, trail: 0, trailT: 0, vert: 0, on: 0 };

  constructor(private readonly coach?: LiveCoach) {}

  sample(g: Game, f: Figure | null, dt: number): void {
    if (!f || !f.alive) {
      this.prevYaw = null;
      return;
    }
    const aim = g.aimAngles();
    const a = g.anglesTo(f.aimPoint(_p));
    const yawErr = a.yaw - aim.yaw;
    const pitchErr = a.pitch - aim.pitch;
    if (this.prevTarget !== f) this.segment++;
    let rate = 0;
    if (this.prevYaw !== null && this.prevTarget === f && dt > 0) rate = (a.yaw - this.prevYaw) / dt;
    this.prevYaw = a.yaw;
    this.prevTarget = f;
    const on = g.crosshairTarget().figure === f;
    const r = angularRadiusDeg(f.aimRadius, a.dist);
    this.meter.add(dt, on, g.input.fireHeld, yawErr, pitchErr, rate);
    this.trace.push(g.clock, aim.yaw, a.yaw, this.segment, { t: g.clock, e: yawErr, p: pitchErr, r, on });
    g.hud.pushScope(g.clock, yawErr, pitchErr, r, on);

    // Rolling 4-second window for live coaching.
    const w = this.win;
    w.t += dt;
    w.vert += pitchErr * dt;
    if (on && g.input.fireHeld) w.on += dt;
    if (Math.abs(rate) > 8) {
      w.trail += yawErr * Math.sign(rate) * dt;
      w.trailT += dt;
    }
    if (w.t >= 4) {
      this.coach?.tracking({ trail: w.trailT ? w.trail / w.trailT : 0, vertical: w.vert / w.t, acc: w.on / w.t });
      this.win = { t: 0, trail: 0, trailT: 0, vert: 0, on: 0 };
    }
  }

  facts(): TrackingFacts {
    const m = this.meter;
    return { acc: m.accuracy, meanError: m.meanError, trail: m.trail, vertical: m.verticalBias, summary: this.trace.summary() };
  }
}

/** Records the aim trajectory and clicks from the moment a flick target appears until it is resolved. */
export class FlickRecorder {
  private samples: AimSample[] = [];
  private clicks: ClickSample[] = [];
  private start = { yaw: 0, pitch: 0 };
  private target = { yaw: 0, pitch: 0 };
  private radius = 1;
  private t0 = 0;
  active = false;

  begin(g: Game, f: Figure): void {
    this.samples = [];
    this.clicks = [];
    this.start = g.aimAngles();
    const a = g.anglesTo(f.position);
    this.target = { yaw: a.yaw, pitch: a.pitch };
    this.radius = angularRadiusDeg(f.headRadius, a.dist);
    this.t0 = g.clock;
    this.active = true;
    this.samples.push({ t: 0, ...this.start });
  }

  sample(g: Game): void {
    if (!this.active) return;
    const a = g.aimAngles();
    this.samples.push({ t: g.clock - this.t0, yaw: a.yaw, pitch: a.pitch });
  }

  /** Call for every shot fired while this flick is live (shots resolve at click time). */
  click(g: Game, hit: boolean): void {
    if (!this.active) return;
    const a = g.aimAngles();
    const t = g.clock - this.t0;
    this.samples.push({ t, yaw: a.yaw, pitch: a.pitch });
    this.clicks.push({ t, yaw: a.yaw, pitch: a.pitch, hit });
  }

  /** Scope feedback: error to the live target. */
  scope(g: Game, f: Figure): void {
    const aim = g.aimAngles();
    const a = g.anglesTo(f.position);
    const on = g.crosshairTarget().figure === f;
    g.hud.pushScope(g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, angularRadiusDeg(f.headRadius, a.dist), on);
  }

  finish(g: Game, hit: boolean): FlickRecord {
    this.active = false;
    return recordFlick(this.samples, this.start, this.target, this.radius, this.clicks, hit, g.clock - this.t0);
  }

  get elapsed(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
  }
}

/** Direction from bearing/pitch (degrees) in world space. */
export function dirFrom(bearingDeg: number, pitchDeg: number, out = new Vector3()): Vector3 {
  const b = (bearingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  return out.set(Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p));
}

/**
 * Spawn an orb roughly `minDeg`–`maxDeg` away from the current aim (total angular distance),
 * at a comfortable pitch, visible and above ground. Used for wide flicks and turns.
 */
/** A proposed orb position: which way from the eye, and how far. */
interface Candidate {
  dir: Vector3;
  dist: number;
}

/** Keep orbs this far in front of any wall they would otherwise sit behind. */
const WALL_GAP = 1.2;

/**
 * Spawn an orb at the first proposal with a clear line of sight. If every proposal is blocked,
 * the least-blocked one is pulled in front of its wall and shrunk so it looks exactly the same size
 * from where you stand (difficulty is angular size), so a target is never hidden or unhittable.
 */
export function spawnOrbWhere(g: Game, radius: number, tries: number, propose: () => Candidate | null): Figure {
  const eye = g.eye();
  let fallback: { pos: Vector3; radius: number; kept: number } | null = null;
  for (let i = 0; i < tries; i++) {
    const c = propose();
    if (!c) continue;
    const d = Math.min(c.dist, g.wallDistance(c.dir) - WALL_GAP);
    if (d < 2) continue;
    const r = radius * (d / c.dist);
    const pos = eye.clone().addScaledVector(c.dir, d);
    if (pos.y < r + 0.3 || Math.hypot(pos.x, pos.z) > 48) continue;
    if (d >= c.dist) return g.spawnOrb(pos, radius);
    const kept = d / c.dist;
    if (!fallback || kept > fallback.kept) fallback = { pos, radius: r, kept };
  }
  if (fallback) return g.spawnOrb(fallback.pos, fallback.radius);
  // Nothing workable (you are hugging a wall): straight ahead, in front of whatever is there.
  const dir = g.aimDir(new Vector3());
  const d = Math.max(1.5, Math.min(10, g.wallDistance(dir) - WALL_GAP));
  return g.spawnOrb(eye.addScaledVector(dir, d), radius * (d / 10));
}

export function spawnFlickOrb(g: Game, minDeg: number, maxDeg: number, minDist: number, maxDist: number, radius: number): Figure {
  const aim = g.aimAngles();
  return spawnOrbWhere(g, radius, 30, () => {
    const off = minDeg + Math.random() * (maxDeg - minDeg);
    const pitch = -6 + Math.random() * 22;
    const dp = pitch - aim.pitch;
    const dYaw = Math.sqrt(Math.max(off * off - dp * dp, (off * 0.4) ** 2));
    const bearing = aim.yaw + (Math.random() < 0.5 ? -1 : 1) * dYaw;
    return { dir: dirFrom(bearing, pitch), dist: minDist + Math.random() * (maxDist - minDist) };
  });
}

/**
 * Spawn an orb that is already on screen, `minDeg`–`maxDeg` from the crosshair in any direction
 * (flatter than tall, like real fights). This is the short-range flick most Overwatch kills need.
 */
export function spawnScreenOrb(g: Game, minDeg: number, maxDeg: number, minDist: number, maxDist: number, radius: number): Figure {
  const cam = g.engine.camera;
  const vHalf = cam.fov / 2;
  const hHalf = (Math.atan(Math.tan((vHalf * Math.PI) / 180) * cam.aspect) * 180) / Math.PI;
  const aim = g.aimAngles();
  return spawnOrbWhere(g, radius, 40, () => {
    const off = minDeg + Math.random() * (maxDeg - minDeg);
    const ang = Math.random() * Math.PI * 2;
    let dx = Math.cos(ang);
    let dy = Math.sin(ang) * 0.6;
    const n = Math.hypot(dx, dy);
    dx = (dx / n) * off;
    dy = (dy / n) * off;
    const pitch = aim.pitch + dy;
    if (Math.abs(dx) > hHalf * 0.8 || Math.abs(dy) > vHalf * 0.75 || pitch < -10 || pitch > 30) return null;
    return { dir: dirFrom(aim.yaw + dx, pitch), dist: minDist + Math.random() * (maxDist - minDist) };
  });
}

/** Linear ramp across levels 1..10. */
export const ramp = (level: number, a: number, b: number): number => a + ((b - a) * (Math.min(10, Math.max(1, level)) - 1)) / 9;
