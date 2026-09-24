import { Vector3 } from 'three';
import type { Game } from '../core/game';
import { analyseFlick, TrackingMeter, type AimSample, type FlickAnalysis } from '../core/metrics';
import { angularRadiusDeg } from '../core/sens';
import type { Figure } from '../world/figure';

const _p = new Vector3();

/** Feeds a TrackingMeter and the oscilloscope for one frame. */
export class TrackingProbe {
  readonly meter = new TrackingMeter();
  private prevYaw: number | null = null;
  private prevTarget: Figure | null = null;

  sample(g: Game, f: Figure | null, dt: number): void {
    if (!f || !f.alive) {
      this.prevYaw = null;
      return;
    }
    const aim = g.aimAngles();
    const a = g.anglesTo(f.aimPoint(_p));
    const yawErr = a.yaw - aim.yaw;
    const pitchErr = a.pitch - aim.pitch;
    let rate = 0;
    if (this.prevYaw !== null && this.prevTarget === f && dt > 0) rate = (a.yaw - this.prevYaw) / dt;
    this.prevYaw = a.yaw;
    this.prevTarget = f;
    const on = g.crosshairTarget().figure === f;
    this.meter.add(dt, on, g.input.fireHeld, yawErr, pitchErr, rate);
    g.hud.pushScope(g.clock, yawErr, pitchErr, angularRadiusDeg(f.aimRadius, a.dist), on);
  }
}

/** Records the aim trajectory from the moment a flick target appears until it is resolved. */
export class FlickRecorder {
  private samples: AimSample[] = [];
  private start = { yaw: 0, pitch: 0 };
  private target = { yaw: 0, pitch: 0 };
  private radius = 1;
  private t0 = 0;
  active = false;

  begin(g: Game, f: Figure): void {
    this.samples = [];
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

  /** Scope feedback: error to the live target. */
  scope(g: Game, f: Figure): void {
    const aim = g.aimAngles();
    const a = g.anglesTo(f.position);
    const on = g.crosshairTarget().figure === f;
    g.hud.pushScope(g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, angularRadiusDeg(f.headRadius, a.dist), on);
  }

  finish(): FlickAnalysis {
    this.active = false;
    return analyseFlick(this.samples, this.start, this.target, this.radius);
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
 * at a comfortable pitch, visible and above ground.
 */
export function spawnFlickOrb(g: Game, minDeg: number, maxDeg: number, minDist: number, maxDist: number, radius: number): Figure {
  const eye = g.eye();
  const aim = g.aimAngles();
  const pos = new Vector3();
  for (let tries = 0; tries < 30; tries++) {
    const off = minDeg + Math.random() * (maxDeg - minDeg);
    const pitch = -6 + Math.random() * 22;
    const dp = pitch - aim.pitch;
    const dYaw = Math.sqrt(Math.max(off * off - dp * dp, (off * 0.4) ** 2));
    const bearing = aim.yaw + (Math.random() < 0.5 ? -1 : 1) * dYaw;
    const dist = minDist + Math.random() * (maxDist - minDist);
    pos.copy(eye).addScaledVector(dirFrom(bearing, pitch), dist);
    if (pos.y < radius + 0.3) continue;
    if (Math.hypot(pos.x, pos.z) > 48) continue;
    if (g.canSee(pos)) break;
  }
  return g.spawnOrb(pos, radius);
}
