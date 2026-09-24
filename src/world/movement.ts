import { Vector3 } from 'three';
import type { Box } from './collide';

/**
 * Overwatch hero locomotion, from community-measured values:
 *  - 5.5 m/s forward/strafe, 90% of that moving straight backwards
 *  - 3.0 m/s crouch-walk
 *  - instant ground acceleration: tap A and you're at full speed, release and you stop dead
 *  - jump impulse 5.72 m/s (≈0.95 m apex), gravity 17.5 m/s² easing toward a 30 m/s fall cap
 *  - air steering is softer than ground but you keep the speed you jumped with
 *  - holding jump re-jumps the instant you land
 */
export const OW = {
  speed: 5.5,
  backMul: 0.9,
  crouchSpeed: 3.0,
  jumpVel: 5.72,
  gravity: 17.5,
  terminal: 30,
  airAccel: 22,
  eyeStand: 1.65,
  eyeCrouch: 1.08,
  heightStand: 1.9,
  heightCrouch: 1.3,
  radius: 0.36,
  crouchRate: 18,
} as const;

export interface MoveIntent {
  forward: number;
  right: number;
  jump: boolean;
  crouch: boolean;
  yaw: number;
}

const MAX_STEP = 1 / 120;

export class Mover {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  onGround = true;
  crouched = false;
  /** 0 = standing, 1 = fully crouched (smoothed). */
  crouchT = 0;
  speedMul = 1;
  /** One-frame event flags for animation/audio. */
  jumped = false;
  landed = 0;

  constructor(
    private readonly colliders: readonly Box[],
    private readonly boundsRadius: number,
  ) {}

  get height(): number {
    return OW.heightStand + (OW.heightCrouch - OW.heightStand) * this.crouchT;
  }

  get eyeHeight(): number {
    return OW.eyeStand + (OW.eyeCrouch - OW.eyeStand) * this.crouchT;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.onGround = y <= 0.001;
  }

  step(dt: number, intent: MoveIntent): void {
    this.jumped = false;
    this.landed = 0;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const h = Math.min(MAX_STEP, remaining);
      this.substep(h, intent);
      remaining -= h;
    }
  }

  private substep(dt: number, intent: MoveIntent): void {
    // Crouch is a state change plus a quick camera ease, like the game.
    this.crouched = intent.crouch;
    const target = this.crouched ? 1 : 0;
    this.crouchT += (target - this.crouchT) * (1 - Math.exp(-OW.crouchRate * dt));

    const sin = Math.sin(intent.yaw);
    const cos = Math.cos(intent.yaw);
    // Camera looks down -Z at yaw 0; positive yaw turns left.
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    let wx = fx * intent.forward + rx * intent.right;
    let wz = fz * intent.forward + rz * intent.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) {
      wx /= wl;
      wz /= wl;
    }
    const forwardness = wl > 1e-6 ? wx * fx + wz * fz : 0;
    const backPenalty = 1 - (1 - OW.backMul) * Math.max(0, -forwardness);
    const maxSpeed = (this.crouched ? OW.crouchSpeed : OW.speed) * backPenalty * this.speedMul;

    if (this.onGround) {
      this.vel.x = wx * maxSpeed;
      this.vel.z = wz * maxSpeed;
      if (intent.jump) {
        this.vel.y = OW.jumpVel;
        this.onGround = false;
        this.jumped = true;
      }
    } else {
      if (wl > 1e-6) {
        let dvx = wx * maxSpeed - this.vel.x;
        let dvz = wz * maxSpeed - this.vel.z;
        const dl = Math.hypot(dvx, dvz);
        const lim = OW.airAccel * dt;
        if (dl > lim) {
          dvx *= lim / dl;
          dvz *= lim / dl;
        }
        this.vel.x += dvx;
        this.vel.z += dvz;
      }
      const falling = this.vel.y < 0;
      const g = falling ? OW.gravity * (1 - Math.min(1, -this.vel.y / OW.terminal)) : OW.gravity;
      this.vel.y = Math.max(-OW.terminal, this.vel.y - g * dt);
    }

    this.moveHorizontal(dt);
    this.moveVertical(dt);
  }

  private moveHorizontal(dt: number): void {
    const r = OW.radius;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const height = this.height;
    for (const b of this.colliders) {
      if (this.pos.y >= b.top - 0.02 || this.pos.y + height <= b.bottom) continue;
      const push = b.pushCircle(this.pos.x, this.pos.z, r);
      if (!push) continue;
      this.pos.x += push[0];
      this.pos.z += push[1];
      const pl = Math.hypot(push[0], push[1]);
      if (pl > 1e-9) {
        const nx = push[0] / pl;
        const nz = push[1] / pl;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= nx * vn;
          this.vel.z -= nz * vn;
        }
      }
    }
    const d = Math.hypot(this.pos.x, this.pos.z);
    const lim = this.boundsRadius - r;
    if (d > lim) {
      const nx = this.pos.x / d;
      const nz = this.pos.z / d;
      this.pos.x = nx * lim;
      this.pos.z = nz * lim;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) {
        this.vel.x -= nx * vn;
        this.vel.z -= nz * vn;
      }
    }
  }

  private moveVertical(dt: number): void {
    const wasGround = this.onGround;
    const impact = this.vel.y;
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;
    const r = OW.radius * 0.92;
    let support = -Infinity;
    for (const b of this.colliders) {
      if (!b.overlapsCircleXZ(this.pos.x, this.pos.z, r)) continue;
      // Landing on top.
      if (prevY >= b.top - 0.05 && this.pos.y <= b.top + 0.001) support = Math.max(support, b.top);
      // Head bump.
      else if (this.vel.y > 0 && prevY + this.height <= b.bottom + 0.01 && this.pos.y + this.height > b.bottom) {
        this.pos.y = b.bottom - this.height;
        this.vel.y = 0;
      }
    }
    if (this.pos.y <= 0) support = Math.max(support, 0);
    if (support > -Infinity && this.vel.y <= 0 && this.pos.y <= support + 0.001) {
      this.pos.y = support;
      this.vel.y = 0;
      this.onGround = true;
      if (!wasGround) this.landed = Math.max(this.landed, -impact);
    } else {
      this.onGround = false;
    }
  }
}
