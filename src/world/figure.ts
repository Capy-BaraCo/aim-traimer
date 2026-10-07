import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  LatheGeometry,
  MeshStandardMaterial,
  Vector2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  SplineCurve,
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
  /** Arms (body damage, like Overwatch): shoulder → paw, either side of the body as you see it. */
  armTop: [0.37, 1.22] as const,
  armBot: [0.465, 0.905] as const,
  armR: 0.095,
  crouchScale: 0.7,
};

// ------------------------------------------------------------------ the bear
// A chunky bear built to fill the hitbox (capsule body + head sphere) without being a capsule:
// a pear-shaped body, round head with ears and muzzle, stubby arms and legs, and a target emblem.
// Hit detection never looks at these meshes — only at HB above. Arms count as body (as in Overwatch);
// ears and feet are cosmetic.

const FUR = new Color('#4a3123');
const FUR_LIGHT = new Color('#c99a6b');
const FUR_BELLY = new Color('#8a5f40');

/** Body silhouette as (radius, height) pairs, smoothed and spun round the vertical axis. */
const torsoGeo = new LatheGeometry(
  new SplineCurve(
    [
      [0, 0.14],
      [0.24, 0.16],
      [0.33, 0.28],
      [0.38, 0.5],
      [0.39, 0.7],
      [0.37, 0.9],
      [0.34, 1.1],
      [0.3, 1.3],
      [0.22, 1.45],
      [0.13, 1.53],
      [0, 1.55],
    ].map(([r, y]) => new Vector2(r, y)),
  ).getPoints(48),
  64,
);
paintTummy(torsoGeo);

/** Vertex colours: dark fur with a soft, lighter oval on the front (+z faces the camera). */
function paintTummy(geo: LatheGeometry): void {
  const pos = geo.attributes.position;
  const out = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = z > 0 ? Math.hypot(x / 0.21, (y - 0.74) / 0.27) : 2;
    const w = 1 - Math.min(1, Math.max(0, (d - 0.72) / 0.28));
    c.copy(FUR).lerp(FUR_BELLY, w * w * (3 - 2 * w));
    c.toArray(out, i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(out, 3));
}

const headGeo = new SphereGeometry(0.215, 28, 18);
const earGeo = new SphereGeometry(0.075, 14, 10);
const earInGeo = new CircleGeometry(0.045, 16);
const snoutGeo = new SphereGeometry(0.1, 18, 12);
const noseGeo = new SphereGeometry(0.036, 12, 8);
const eyeGeo = new SphereGeometry(0.026, 10, 8);
const armGeo = new CapsuleGeometry(0.085, 0.3, 6, 12);
const legGeo = new CapsuleGeometry(0.11, 0.14, 6, 12);
const footGeo = new SphereGeometry(0.12, 14, 10);
const emblemRingGeo = new RingGeometry(0.075, 0.105, 32);
const emblemDotGeo = new CircleGeometry(0.045, 24);

const DARK = new Color('#140d09');
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
  /** Bear parts that flash white when hit. */
  private readonly fur: MeshStandardMaterial[] = [];
  private readonly rig = new Group();
  private readonly torso = new Group();
  private readonly headRig = new Group();
  private readonly limbs: { arms: Group[]; legs: Group[] } = { arms: [], legs: [] };
  private walk = 0;
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
      this.head = this.buildBear(core);
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

  /** Builds the bear into `rig`; returns the head mesh. */
  private buildBear(core: Color): Mesh {
    const furMat = () => {
      const m = new MeshStandardMaterial({ color: FUR, roughness: 0.92, metalness: 0 });
      this.fur.push(m);
      return m;
    };
    const fur = furMat();
    const light = new MeshStandardMaterial({ color: FUR_LIGHT, roughness: 0.85 });
    const body = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const dark = new MeshStandardMaterial({ color: DARK, roughness: 0.4 });
    this.fur.push(light, body);
    // Overwatch draws enemies with a coloured outline; an inverted shell in the target colour does
    // the same, so the bear reads from across the map and at night.
    const outline = new MeshBasicMaterial({ color: core, side: BackSide });
    const shell = (geo: SphereGeometry | LatheGeometry, k: number) => {
      const m = new Mesh(geo, outline);
      m.scale.setScalar(k);
      return m;
    };
    const mesh = <G extends ConstructorParameters<typeof Mesh>[0]>(geo: G, mat: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // Body
    // The lighter tummy is painted into the body's vertex colours, so its edge stays soft.
    const torso = mesh(torsoGeo, body);
    const torsoShell = shell(torsoGeo, 1.045);
    torsoShell.scale.y = 1.012;
    const emblemMat = hardLightMaterial(core);
    this.mats.push(emblemMat);
    const ring = new Mesh(emblemRingGeo, emblemMat);
    const dot = new Mesh(emblemDotGeo, emblemMat);
    ring.position.set(0, 1.08, 0.345);
    dot.position.copy(ring.position);
    ring.rotation.x = dot.rotation.x = -0.16;
    this.torso.add(torso, torsoShell, ring, dot);

    // Arms and legs hang from pivots so they can swing.
    for (const side of [-1, 1]) {
      const arm = new Group();
      arm.position.set(side * 0.36, 1.27, 0.02);
      arm.rotation.z = side * 0.28;
      const a = mesh(armGeo, fur, 0, -0.2, 0);
      const paw = mesh(footGeo, fur, 0, -0.38, 0.01);
      paw.scale.setScalar(0.72);
      arm.add(a, paw);
      this.torso.add(arm);
      this.limbs.arms.push(arm);
      const leg = new Group();
      leg.position.set(side * 0.17, 0.3, 0);
      const l = mesh(legGeo, fur, 0, -0.1, 0);
      const foot = mesh(footGeo, light, 0, -0.24, 0.05);
      foot.scale.set(1, 0.55, 1.3);
      leg.add(l, foot);
      this.rig.add(leg);
      this.limbs.legs.push(leg);
    }

    // Head: round, with ears, a pale muzzle, nose and eyes.
    const head = mesh(headGeo, fur);
    const headShell = shell(headGeo, 1.06);
    this.headRig.add(head, headShell);
    for (const side of [-1, 1]) {
      const ear = mesh(earGeo, fur, side * 0.15, 0.16, -0.02);
      const inner = new Mesh(earInGeo, light);
      inner.position.set(side * 0.15, 0.16, 0.05);
      this.headRig.add(ear, inner, shell(earGeo, 1).translateX(side * 0.15).translateY(0.16).translateZ(-0.02));
      (this.headRig.children.at(-1) as Mesh).scale.setScalar(1.12);
      this.headRig.add(mesh(eyeGeo, dark, side * 0.075, 0.05, 0.185));
    }
    const snout = mesh(snoutGeo, light, 0, -0.05, 0.16);
    snout.scale.set(1.15, 0.8, 0.85);
    this.headRig.add(snout, mesh(noseGeo, dark, 0, -0.005, 0.245));

    this.rig.add(this.torso, this.headRig);
    this.group.add(this.rig);
    return head;
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
      let tb = rayCapsule(o, d, this._a, this._b, HB.bodyR);
      // The bear always faces the shooter, so its arms sit left and right of the body from `o`.
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const rx = (side * dz) / len;
        const rz = (-side * dx) / len;
        this._a.set(p.x + rx * HB.armTop[0], p.y + HB.armTop[1] * k, p.z + rz * HB.armTop[0]);
        this._b.set(p.x + rx * HB.armBot[0], p.y + HB.armBot[1] * k, p.z + rz * HB.armBot[0]);
        tb = Math.min(tb, rayCapsule(o, d, this._a, this._b, HB.armR));
      }
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
    for (const m of this.fur) m.emissive.setScalar(this.flash * 0.55);

    const p = this.mover.pos;
    this.group.position.set(p.x, 0, p.z);
    const k = this.crouchK;
    if (this.kind === 'humanoid') {
      this.rig.position.y = p.y;
      this.rig.scale.setScalar(scale);
      // Always face you, like an enemy in a duel.
      this.rig.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      // Crouching squashes the body; the head rides down with the hitbox.
      this.torso.scale.y = k;
      this.headRig.position.y = HB.headY * k;
      // Waddle: legs and arms swing with ground speed; strafing reads as side-steps.
      const v = Math.hypot(this.velocity.x, this.velocity.z);
      const amt = Math.min(1, v / 4);
      this.walk += dt * (4 + v * 1.6) * (amt > 0.05 ? 1 : 0);
      const sw = Math.sin(this.walk) * amt;
      const yaw = this.rig.rotation.y;
      const side = (this.velocity.x * Math.cos(yaw) - this.velocity.z * Math.sin(yaw)) / Math.max(v, 1e-3);
      const fwd = Math.sqrt(Math.max(0, 1 - side * side));
      this.limbs.legs.forEach((l, i) => {
        const s2 = i ? -sw : sw;
        l.rotation.x = s2 * 0.55 * fwd;
        l.rotation.z = s2 * 0.35 * Math.abs(side);
      });
      this.limbs.arms.forEach((a, i) => (a.rotation.x = (i ? sw : -sw) * 0.5));
      this.torso.rotation.z = Math.sin(this.walk * 2) * 0.05 * amt;
      this.torso.position.y = Math.abs(Math.sin(this.walk)) * 0.035 * amt + Math.sin(time * 2 + this.id) * 0.006;
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
