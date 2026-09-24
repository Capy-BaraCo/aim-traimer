import { Vector3 } from 'three';
import type { Figure } from './figure';
import type { MoveIntent } from './movement';

export type BotStyle = 'duel' | 'smooth' | 'idle' | 'static';

export interface StrafeOptions {
  style: BotStyle;
  /** Stay within this many metres of the anchor along the strafe axis. */
  lane: number;
  /** Keep between these distances from the player. */
  near: number;
  far: number;
  speedMul?: number;
}

const STYLE: Record<BotStyle, { min: number; max: number; flip: number; jump: number; crouch: number; speed: number }> = {
  // Ranked-duel ADAD: short, irregular strafes, the odd jump and crouch-spam.
  duel: { min: 0.16, max: 0.75, flip: 0.82, jump: 0.12, crouch: 0.1, speed: 1 },
  // Readable, longer strafes for learning to stay glued.
  smooth: { min: 0.7, max: 1.6, flip: 0.9, jump: 0.0, crouch: 0.0, speed: 0.8 },
  // Attract-mode wandering.
  idle: { min: 1.2, max: 3.2, flip: 0.6, jump: 0.05, crouch: 0, speed: 0.55 },
  static: { min: 99, max: 99, flip: 0, jump: 0, crouch: 0, speed: 0 },
};

export interface Brain {
  update(dt: number, player: Vector3): void;
}

/** Yaw that points a mover's "forward" at a world XZ target. */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** Express a world-space XZ direction as forward/right input for a given yaw. */
export function intentFor(dirX: number, dirZ: number, yaw: number): { forward: number; right: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { forward: dirX * -s + dirZ * -c, right: dirX * c + dirZ * -s };
}

export class StrafeBrain implements Brain {
  private dir = Math.random() < 0.5 ? -1 : 1;
  private timer = 0;
  private crouchFor = 0;
  private readonly anchor: Vector3;
  private readonly cfg: (typeof STYLE)[BotStyle];

  constructor(
    private readonly fig: Figure,
    private readonly opts: StrafeOptions,
  ) {
    this.anchor = fig.position.clone();
    this.cfg = STYLE[opts.style];
    this.timer = this.nextInterval();
    fig.mover.speedMul = this.cfg.speed * (opts.speedMul ?? 1);
  }

  private nextInterval(): number {
    // Skew toward short strafes: ADAD rhythm is mostly quick taps with occasional long runs.
    const u = Math.random() ** 1.6;
    return this.cfg.min + (this.cfg.max - this.cfg.min) * u;
  }

  update(dt: number, player: Vector3): void {
    const m = this.fig.mover;
    const intent: MoveIntent = { forward: 0, right: 0, jump: false, crouch: false, yaw: 0 };
    const dx = player.x - m.pos.x;
    const dz = player.z - m.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    intent.yaw = yawToward(dx, dz);

    if (this.opts.style !== 'static') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = this.nextInterval();
        if (Math.random() < this.cfg.flip) this.dir *= -1;
        if (m.onGround && Math.random() < this.cfg.jump) intent.jump = true;
        if (Math.random() < this.cfg.crouch) this.crouchFor = 0.2 + Math.random() * 0.35;
      }
      // Tangent to the player keeps the strafe purely lateral: maximum angular speed.
      const tx = -dz / dist;
      const tz = dx / dist;
      const off = (m.pos.x - this.anchor.x) * tx + (m.pos.z - this.anchor.z) * tz;
      if (off > this.opts.lane && this.dir > 0) this.dir = -1;
      if (off < -this.opts.lane && this.dir < 0) this.dir = 1;
      // Facing the player, the mover's right vector is exactly +tangent.
      intent.right = this.dir;
      if (dist > this.opts.far) intent.forward = 0.6;
      else if (dist < this.opts.near) intent.forward = -0.6;
    }
    this.crouchFor -= dt;
    intent.crouch = this.crouchFor > 0;
    m.step(dt, intent);
  }
}

/** Figure that hides behind a fin and peeks out left or right. */
export class PeekBrain implements Brain {
  phase: 'hidden' | 'out' | 'exposed' | 'back' = 'hidden';
  private t = 0;
  private wait: number;
  private side = 1;
  private readonly hide: Vector3;
  private readonly tangent: Vector3;
  private readonly reach: number;

  constructor(
    private readonly fig: Figure,
    hide: Vector3,
    tangent: Vector3,
    reach: number,
    firstWait = 0.6 + Math.random() * 1.6,
  ) {
    this.hide = hide.clone();
    this.tangent = tangent.clone().normalize();
    this.reach = reach;
    this.wait = firstWait;
    fig.mover.teleport(hide.x, 0, hide.z);
  }

  update(dt: number, player: Vector3): void {
    const m = this.fig.mover;
    this.t += dt;
    const dx = player.x - m.pos.x;
    const dz = player.z - m.pos.z;
    const yaw = yawToward(dx, dz);
    let dirX = 0;
    let dirZ = 0;
    const target = this.hide.clone();
    if (this.phase === 'hidden' && this.t >= this.wait) {
      this.phase = 'out';
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.t = 0;
    }
    if (this.phase === 'out' || this.phase === 'exposed') target.addScaledVector(this.tangent, this.side * this.reach);
    const ox = target.x - m.pos.x;
    const oz = target.z - m.pos.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.08) {
      dirX = ox / od;
      dirZ = oz / od;
    } else if (this.phase === 'out') {
      this.phase = 'exposed';
      this.t = 0;
      this.wait = 0.7 + Math.random() * 0.8;
    } else if (this.phase === 'back') {
      this.phase = 'hidden';
      this.t = 0;
      this.wait = 0.8 + Math.random() * 1.6;
    }
    if (this.phase === 'exposed' && this.t >= this.wait) {
      this.phase = 'back';
      this.t = 0;
    }
    // Don't overshoot the waypoint in one step.
    m.speedMul = od > 0.08 ? Math.min(1, od / (5.5 * Math.max(dt, 1e-3))) : 0;
    const { forward, right } = intentFor(dirX, dirZ, yaw);
    m.step(dt, { forward, right, jump: false, crouch: false, yaw });
  }
}
