import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Camera,
} from 'three';
import { raySphere, rayCapsule, type Box } from './collide';
import { hardLightMaterial } from './materials';
import { Mover, OW } from './movement';
import { PALETTE } from './palette';

export type HitPart = 'head' | 'body';

export interface FigureHit {
  t: number;
  part: HitPart;
  point: Vector3;
}

/** Humanoid hitbox proportions (standing). Visual meshes are built from the same numbers. */
export const HB = {
  bodyA: 0.5,
  bodyB: 1.12,
  bodyR: 0.36,
  headY: 1.7,
  headR: 0.2,
  crouchScale: 0.7,
};

const capsuleGeo = new CapsuleGeometry(HB.bodyR, HB.bodyB - HB.bodyA, 8, 20);
const headGeo = new SphereGeometry(HB.headR, 24, 16);
const ringGeo = new RingGeometry(0.46, 0.54, 48);
const barGeo = new PlaneGeometry(0.9, 0.07);
const orbGeo = new SphereGeometry(1, 28, 18);
const gyroGeo = new TorusGeometry(1.45, 0.035, 6, 64);

function barMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uFill: { value: 1 }, uColor: { value: PALETTE.signal.clone() }, uBack: { value: PALETTE.ink.clone() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFill;
      uniform vec3 uColor;
      uniform vec3 uBack;
      varying vec2 vUv;
      void main() {
        float seg = step(0.12, fract(vUv.x * 10.0));
        vec3 c = vUv.x < uFill ? uColor : uBack;
        float a = vUv.x < uFill ? 0.95 * seg + 0.3 : 0.45;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

let nextId = 1;

export class Figure {
  readonly id = nextId++;
  readonly group = new Group();
  readonly mover: Mover;
  readonly kind: 'humanoid' | 'orb';
  alive = true;
  hp = 200;
  maxHp = 200;
  /** Radius used when kind === 'orb'. */
  orbRadius = 0.3;
  showBar = true;
  /** Seconds since spawn. */
  age = 0;

  private readonly mats: ShaderMaterial[] = [];
  private readonly body?: Mesh;
  private readonly head: Mesh;
  private readonly ring: Mesh;
  private readonly bar?: Mesh;
  private readonly gyro?: Mesh;
  private flash = 0;
  private dying = -1;
  private readonly lastPos = new Vector3();
  readonly velocity = new Vector3();

  constructor(kind: 'humanoid' | 'orb', colliders: readonly Box[], bounds: number, color?: Color) {
    this.kind = kind;
    this.mover = new Mover(colliders, bounds);
    const core = color ?? PALETTE.targetCore;
    const mat = hardLightMaterial(core);
    this.mats.push(mat);

    if (kind === 'humanoid') {
      this.body = new Mesh(capsuleGeo, mat);
      this.body.castShadow = true;
      const headMat = hardLightMaterial(core.clone().lerp(new Color('#ffffff'), 0.28));
      this.mats.push(headMat);
      this.head = new Mesh(headGeo, headMat);
      this.head.castShadow = true;
      this.group.add(this.body, this.head);
      this.bar = new Mesh(barGeo, barMaterial());
      this.bar.renderOrder = 5;
      this.group.add(this.bar);
    } else {
      this.head = new Mesh(orbGeo, mat);
      this.head.castShadow = true;
      this.gyro = new Mesh(gyroGeo, new MeshBasicMaterial({ color: PALETTE.targetRim, transparent: true, opacity: 0.7 }));
      this.head.add(this.gyro);
      this.group.add(this.head);
    }

    this.ring = new Mesh(
      ringGeo,
      new MeshBasicMaterial({
        color: core,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
  }

  get position(): Vector3 {
    return this.mover.pos;
  }

  private get crouchK(): number {
    return 1 + (HB.crouchScale - 1) * this.mover.crouchT;
  }

  headCenter(out = new Vector3()): Vector3 {
    if (this.kind === 'orb') return out.copy(this.mover.pos);
    return out.set(this.mover.pos.x, this.mover.pos.y + HB.headY * this.crouchK, this.mover.pos.z);
  }

  get headRadius(): number {
    return this.kind === 'orb' ? this.orbRadius : HB.headR;
  }

  /** Point a coach would call "centre mass" — where tracking error is measured. */
  aimPoint(out = new Vector3()): Vector3 {
    if (this.kind === 'orb') return out.copy(this.mover.pos);
    const k = this.crouchK;
    return out.set(this.mover.pos.x, this.mover.pos.y + ((HB.bodyA + HB.bodyB) / 2 + 0.18) * k, this.mover.pos.z);
  }

  /** Angular size proxy: radius of the part we measure tracking against. */
  get aimRadius(): number {
    return this.kind === 'orb' ? this.orbRadius : HB.bodyR;
  }

  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _h = new Vector3();

  ray(o: Vector3, d: Vector3): FigureHit | null {
    if (!this.alive) return null;
    this.headCenter(this._h);
    const th = raySphere(o, d, this._h, this.headRadius);
    let t = th;
    let part: HitPart = 'head';
    if (this.kind === 'humanoid') {
      const k = this.crouchK;
      const p = this.mover.pos;
      this._a.set(p.x, p.y + HB.bodyA * k, p.z);
      this._b.set(p.x, p.y + HB.bodyB * k, p.z);
      const tb = rayCapsule(o, d, this._a, this._b, HB.bodyR);
      if (tb < t) {
        t = tb;
        part = 'body';
      }
    } else {
      part = 'head';
    }
    if (t === Infinity) return null;
    return { t, part, point: o.clone().addScaledVector(d, t) };
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = 0;
      return true;
    }
    return false;
  }

  pulse(): void {
    this.flash = Math.max(this.flash, 0.6);
  }

  get removable(): boolean {
    return this.dying >= 0.16;
  }

  update(dt: number, time: number, camera: Camera): void {
    this.age += dt;
    this.velocity.copy(this.mover.pos).sub(this.lastPos).divideScalar(Math.max(dt, 1e-4));
    this.lastPos.copy(this.mover.pos);

    this.flash = Math.max(0, this.flash - dt * 7);
    const spawn = Math.min(1, this.age / 0.12);
    let scale = spawn * (2 - spawn);
    if (this.dying >= 0) {
      this.dying += dt;
      scale *= Math.max(0, 1 - this.dying / 0.16);
    }
    for (const m of this.mats) {
      m.uniforms.uHit.value = this.flash;
      m.uniforms.uTime.value = time + this.id;
    }

    const p = this.mover.pos;
    this.group.position.set(p.x, 0, p.z);
    const k = this.crouchK;
    if (this.kind === 'humanoid' && this.body) {
      this.body.position.y = p.y + ((HB.bodyA + HB.bodyB) / 2) * k;
      this.body.scale.set(scale, k * scale, scale);
      this.head.position.y = p.y + HB.headY * k;
      this.head.scale.setScalar(scale);
      if (this.bar) {
        this.bar.visible = this.showBar && this.alive && this.hp < this.maxHp;
        this.bar.position.y = p.y + (HB.headY + 0.42) * k;
        this.bar.quaternion.copy(camera.quaternion);
        (this.bar.material as ShaderMaterial).uniforms.uFill.value = this.hp / this.maxHp;
      }
    } else {
      this.head.position.y = p.y;
      this.head.scale.setScalar(this.orbRadius * scale);
      if (this.gyro) {
        this.gyro.rotation.x = time * 1.3 + this.id;
        this.gyro.rotation.y = time * 0.7;
      }
    }
    this.ring.position.y = 0.025;
    this.ring.scale.setScalar(this.kind === 'orb' ? 0.7 : 1);
    this.ring.visible = this.kind === 'humanoid' || p.y < 3.5;
  }

  dispose(): void {
    this.group.removeFromParent();
    // Geometries are shared module-wide; materials are per figure.
    this.group.traverse((o) => {
      const mat = (o as Mesh).material;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
    });
  }
}

export { OW };
