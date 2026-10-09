/**
 * Overdrive tap targets (D2, D14): flick shapes, bursts and decoys. One click each (a burst: one per
 * orb); the held stream passes through them (D13). This file owns how they look, sound and break;
 * the closing ring, pulse and flash around them are T16's (overdrive-cues.ts).
 *
 *  - circle (magenta): a neon orb, the plain on-screen flick.
 *  - diamond (gold): a small cut gem that rocks gently; a crisp, sparkly break and a glassy chime.
 *  - triangle (orange): a flat plate off screen to the side, apex pointing the way to turn. It pings
 *    from where it is when it launches and again when it lands, and a small arrow at the edge of the
 *    screen shows the turn while it is out of sight.
 *  - burst (violet): 3–5 small orbs on a thread. The orb whose turn it is swells; each pop plays the
 *    next note of a rising scale, so a burst is a little melody on the eighths.
 *  - decoy (blue): a friendly figure with a halo, so it can't be mistaken for an enemy. Shoot it and
 *    it breaks with a dull thunk; leave it alone and it dissolves into a soft sparkle.
 *
 * Every hit volume is exactly what is drawn: the sphere, the diamond solid, the triangle plate
 * (Figure.setOrbShape) or the figure's own body. Effects scale with the FX level setting.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { store } from '../core/store';
import type { Judgement } from '../rhythm/scoring';
import type { BurstTarget, DecoyTarget, FlickTarget } from '../rhythm/types';
import type { Figure } from '../world/figure';
import { beatPosition } from '../world/synthwave';
import { flyInPoint, flyInProgress } from './overdrive-cues';
import {
  groundPoint,
  orbPoint,
  partIndex,
  placeFigure,
  removeParts,
  spawnFigurePart,
  spawnOrbPart,
  type OverdriveTarget,
  type TargetEnv,
  type TargetEvent,
  type TargetPart,
} from './overdrive-targets';

const COLOR = {
  circle: new Color('#ff2bd6'),
  diamond: new Color('#ffd23f'),
  triangle: new Color('#ff7a1a'),
  burst: new Color('#b05cff'),
  decoy: new Color('#46b4ff'),
};
const WHITE = new Color('#ffffff');
const DUST = new Color('#b9ae9a');

/** A triangle plate is drawn this much bigger than a circle's radius: it is a wide flick, so it should be fair to find. */
const TRIANGLE_SCALE = 1.4;
/** Burst orbs are smaller than flicks, and smaller still until their turn. */
const ORB_SCALE = 0.75;
const WAITING_SCALE = 0.55;
/** An orb swells from waiting to full size over this long (song seconds) when its turn comes. */
const SWELL = 0.12;
/** A decoy can't be killed: shooting it only breaks your combo. */
const DECOY_HP = 1e9;

/** Pitches (Hz) of the notes the effects play: a major pentatonic, so any run of them sounds fine over any song. */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];

const DEG = 180 / Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Angle in degrees wrapped to (-180, 180]. */
const wrap180 = (a: number) => a - 360 * Math.round(a / 360);

export function createTap(env: TargetEnv, data: FlickTarget | BurstTarget | DecoyTarget): OverdriveTarget {
  switch (data.kind) {
    case 'flick':
      return new FlickView(env, data);
    case 'burst':
      return new BurstView(env, data);
    case 'decoy':
      return new DecoyView(env, data);
  }
}

// ------------------------------------------------------------------------------------------ effects

/** How much of the particle effects to show: the FX level setting. */
function fxScale(): number {
  const level = store.settings.fx;
  return level === 'off' ? 0 : level === 'lite' ? 0.5 : 1;
}

/** Where a figure's effects go: an orb's centre, a person's chest. */
function centreOf(f: Figure, out = new Vector3()): Vector3 {
  return f.aimPoint(out);
}

/** Sparks read small at 12 m or more, so Overdrive draws them bigger than the Game's own. */
const SPARK = 6;

/**
 * The hit pop. The Game has already played its generic kill burst; this adds the colour: a ring that
 * flares round the target and a spray of sparks. A Perfect is bigger and brighter than an Early or a
 * Late (a wider ring, white sparks, the full burst).
 */
function pop(env: TargetEnv, f: Figure, color: Color, j: Judgement, size = 1): void {
  const s = fxScale();
  if (!s) return;
  const fx = env.g.fx;
  const at = centreOf(f);
  const r = f.kind === 'orb' ? f.orbRadius : 0.6;
  const eye = env.g.engine.camera.position;
  if (j === 'perfect') {
    fx.shockwave(at, color, r * 3.2 * size, eye);
    if (s >= 1) fx.burst(at, color);
    fx.sparks(at, color, Math.round(22 * s * size), 6, SPARK);
    fx.sparks(at, WHITE, Math.round(16 * s * size), 8, SPARK * 0.9);
  } else {
    fx.shockwave(at, color, r * 2 * size, eye);
    fx.sparks(at, color, Math.round(12 * s * size), 4, SPARK * 0.8);
  }
}

/** A target nobody hit: it fizzles out in dust. The figure shrinks away on its own (as a kill does). */
function fizzle(env: TargetEnv, f: Figure, size = 1): void {
  const s = fxScale();
  if (s) env.g.fx.sparks(centreOf(f), DUST, Math.round(6 * s * size), 1.8, SPARK * 0.7);
  f.damage(f.hp);
  env.g.audio.miss();
}

// ------------------------------------------------------------------------------------------ flicks

const turnArrowGeo = (() => {
  const dart = new Shape();
  dart.moveTo(0.55, 0);
  dart.lineTo(-0.35, 0.5);
  dart.lineTo(-0.1, 0);
  dart.lineTo(-0.35, -0.5);
  dart.closePath();
  return new ShapeGeometry(dart);
})();

/**
 * A triangle is off screen, so its shape can't show you the turn: this small arrow at the screen edge
 * does, on the side to turn to and at the height of the target. It fades out as the target comes into
 * view and breathes with the beat. Placed from the camera each frame; its pulse reads song time.
 */
class TurnArrow {
  private readonly fill = new Mesh(turnArrowGeo, new MeshBasicMaterial({ color: COLOR.triangle, transparent: true, side: DoubleSide, depthTest: false, depthWrite: false }));
  private readonly edge = new Mesh(turnArrowGeo, new MeshBasicMaterial({ color: WHITE, transparent: true, side: DoubleSide, depthTest: false, depthWrite: false }));
  private readonly p = new Vector3();
  private readonly fwd = new Vector3();

  constructor(private readonly env: TargetEnv, private readonly bearing: number, private readonly pitch: number) {
    this.edge.renderOrder = 20;
    this.fill.renderOrder = 21;
    this.edge.visible = this.fill.visible = false;
    env.g.engine.scene.add(this.edge, this.fill);
  }

  update(t: number, appear: number): void {
    const cam = this.env.g.engine.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(this.fwd);
    const rel = wrap180(this.bearing - Math.atan2(this.fwd.x, -this.fwd.z) * DEG);
    const relPitch = this.pitch - Math.asin(clamp(this.fwd.y, -1, 1)) * DEG;
    const halfV = Math.tan((cam.fov * Math.PI) / 360);
    const halfH = Math.atan(halfV * cam.aspect) * DEG;
    // Fully shown once it is off screen, gone once it is nearly in view.
    const away = clamp((Math.abs(rel) - (halfH - 14)) / 14, 0, 1);
    const visible = away > 0.02 && appear > 0;
    this.edge.visible = this.fill.visible = visible;
    if (!visible) return;
    const D = 4;
    const right = rel >= 0 ? 1 : -1;
    const x = right * (D * halfV * cam.aspect - 0.5);
    const y = clamp(Math.tan(relPitch / DEG) * D * 0.8, -halfV * D * 0.55, halfV * D * 0.55);
    cam.localToWorld(this.p.set(x, y, -D));
    const f = beatPosition(this.env.beats, t);
    const breathe = 1 + 0.22 * (1 - (f - Math.floor(f))) ** 2;
    for (const [m, size, opacity] of [
      [this.edge, 0.42, 0.9],
      [this.fill, 0.32, 1],
    ] as const) {
      m.position.copy(this.p);
      m.quaternion.copy(cam.quaternion);
      m.scale.set(right * size * breathe, size * breathe, 1);
      (m.material as MeshBasicMaterial).opacity = opacity * away * appear;
    }
  }

  dispose(): void {
    for (const m of [this.edge, this.fill]) {
      m.removeFromParent();
      (m.material as MeshBasicMaterial).dispose();
    }
  }
}

class FlickView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3;
  private readonly radius: number;
  /** Yaw that turns a flat shape to face the player at the origin. */
  private readonly face: number;
  /** Triangle only: +1 to turn right, -1 to turn left. */
  private readonly turn: number;
  private arrow: TurnArrow | null = null;
  private landed = false;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: FlickTarget,
  ) {
    this.at = orbPoint(data.position);
    const { targetRadius, diamondScale } = env.params;
    this.radius = data.shape === 'diamond' ? targetRadius * diamondScale : data.shape === 'triangle' ? targetRadius * TRIANGLE_SCALE : targetRadius;
    this.face = Math.atan2(-this.at.x, -this.at.z);
    this.turn = data.position.bearing >= 0 ? 1 : -1;
  }

  spawn(t: number): void {
    const { shape } = this.data;
    const f = spawnOrbPart(this.env, flyInPoint(this.at, 0, this.p), this.radius, COLOR[shape]);
    if (shape !== 'circle') f.setOrbShape(shape);
    this.parts = [{ figure: f, time: this.data.targetTime }];
    if (shape === 'triangle') {
      // Wide flick (D14): you hear where it is before you see it, as in Snap.
      if (store.settings.targetSounds) this.env.g.audio.spawn(this.at);
      this.arrow = new TurnArrow(this.env, this.data.position.bearing, this.data.position.pitch);
    }
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f) return;
    placeFigure(f, flyInPoint(this.at, flyInProgress(t, this.data), this.p));
    const { shape } = this.data;
    if (shape === 'diamond') {
      // A gentle rock, a function of song time (the hit volume follows the same pose).
      f.setOrbPose(this.face + Math.sin(t * 2) * 0.45);
    } else if (shape === 'triangle') {
      f.setOrbPose(this.face, (-this.turn * Math.PI) / 2);
      // A second, softer ping as it lands: it is still out there, and now it can be hit.
      if (!this.landed && t >= this.data.landTime) {
        this.landed = true;
        if (store.settings.targetSounds) this.env.g.audio.beacon(this.at);
      }
      this.arrow?.update(t, flyInProgress(t, this.data) > 0 ? 1 : 0);
    }
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(e: TargetEvent): void {
    if (e.type !== 'judged') return;
    const f = this.parts[0]?.figure;
    if (!f) return;
    if (e.judgement === 'miss') {
      fizzle(this.env, f);
      return;
    }
    const { shape } = this.data;
    const perfect = e.judgement === 'perfect';
    pop(this.env, f, COLOR[shape], e.judgement, shape === 'diamond' ? 1.4 : 1);
    const audio = this.env.g.audio;
    if (shape === 'diamond') {
      // Glassy: a little rising arpeggio, longer and brighter on a Perfect.
      const notes = perfect ? [1568, 2093, 2637, 3136] : [2093, 2637];
      notes.forEach((hz, i) => audio.chime(hz, 0.12 + 0.03 * i, perfect ? 0.075 : 0.05, i * 0.035, 'sine'));
    } else if (shape === 'triangle') {
      // A swoosh up into a ting: it was a big turn.
      audio.chime(330, 0.12, 0.07, 0, 'triangle', 990);
      audio.chime(perfect ? 1318.5 : 987.8, 0.18, perfect ? 0.09 : 0.06, 0.07);
    } else {
      audio.chime(SCALE[2], 0.14, perfect ? 0.09 : 0.06);
      if (perfect) audio.chime(SCALE[2] * 1.5, 0.2, 0.07, 0.045);
    }
  }

  dispose(): void {
    removeParts(this.env, this.parts);
    this.arrow?.dispose();
    this.arrow = null;
  }
}

// ------------------------------------------------------------------------------------------ bursts

class BurstView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3[];
  private readonly radius: number;
  private readonly opensAt: number[];
  private readonly resolved: boolean[];
  private readonly pts: Vector3[];
  private readonly thread: LineSegments;
  private readonly threadPos: Float32Array;
  private readonly p = new Vector3();
  private disposed = false;

  constructor(
    private readonly env: TargetEnv,
    readonly data: BurstTarget,
  ) {
    this.at = data.orbs.map((o) => orbPoint(o.position));
    this.radius = env.params.targetRadius * ORB_SCALE;
    // Orb k's turn starts when its window opens: at landing for the first, on the previous orb's beat after that.
    this.opensAt = data.orbs.map((_, k) => (k === 0 ? data.landTime : data.orbs[k - 1].time));
    this.resolved = data.orbs.map(() => false);
    this.pts = data.orbs.map(() => new Vector3());
    // A thread through the orbs shows the order. Each segment drops out once its orb is done.
    this.threadPos = new Float32Array(Math.max(0, data.orbs.length - 1) * 6);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.threadPos, 3));
    this.thread = new LineSegments(geo, new LineBasicMaterial({ color: COLOR.burst, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    this.thread.frustumCulled = false;
  }

  spawn(t: number): void {
    this.parts = this.data.orbs.map((o, k) => ({
      figure: spawnOrbPart(this.env, flyInPoint(this.at[k], 0, this.p), this.radius, COLOR.burst),
      time: o.time,
    }));
    this.env.g.engine.scene.add(this.thread);
    this.update(t);
  }

  update(t: number): void {
    const k = flyInProgress(t, this.data);
    this.parts.forEach((part, i) => {
      placeFigure(part.figure, flyInPoint(this.at[i], k, this.pts[i]));
      const swell = clamp((t - this.opensAt[i]) / SWELL, 0, 1);
      part.figure.orbRadius = this.radius * (WAITING_SCALE + (1 - WAITING_SCALE) * swell * (2 - swell));
    });
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.resolved[i] ? a : this.pts[i + 1];
      this.threadPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    }
    this.thread.geometry.attributes.position.needsUpdate = true;
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(e: TargetEvent): void {
    if (e.type !== 'judged') return;
    const f = this.parts[e.part]?.figure;
    if (!f) return;
    this.resolved[e.part] = true;
    if (e.judgement === 'miss') {
      fizzle(this.env, f, 0.6);
      return;
    }
    const perfect = e.judgement === 'perfect';
    pop(this.env, f, COLOR.burst, e.judgement, 0.8);
    // The chain climbs the scale one note per orb; the last orb of a clean run rounds it off.
    const audio = this.env.g.audio;
    const hz = SCALE[Math.min(e.part, SCALE.length - 1)];
    audio.chime(hz, 0.13, perfect ? 0.085 : 0.055);
    if (perfect) audio.chime(hz * 2, 0.1, 0.04, 0.02, 'sine');
    if (e.part === this.parts.length - 1 && this.resolved.every(Boolean)) {
      audio.chime(hz * 1.5, 0.28, 0.07, 0.07, 'sine');
      const s = fxScale();
      if (s) this.env.g.fx.sparks(centreOf(f), COLOR.burst, Math.round(20 * s), 6, SPARK);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    removeParts(this.env, this.parts);
    this.thread.removeFromParent();
    this.thread.geometry.dispose();
    (this.thread.material as LineBasicMaterial).dispose();
  }
}

// ------------------------------------------------------------------------------------------ decoys

const haloGeo = new RingGeometry(0.34, 0.4, 40);

class DecoyView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3;
  private readonly p = new Vector3();
  private halo: Mesh | null = null;

  constructor(
    private readonly env: TargetEnv,
    readonly data: DecoyTarget,
  ) {
    this.at = groundPoint(data.position);
  }

  spawn(t: number): void {
    const f = spawnFigurePart(this.env, flyInPoint(this.at, 0, this.p), COLOR.decoy, DECOY_HP);
    f.showBar = false;
    // A halo over the head: friendly things wear one, enemies don't. It lives in the figure's group, so it goes with it.
    this.halo = new Mesh(haloGeo, new MeshBasicMaterial({ color: COLOR.decoy.clone().lerp(WHITE, 0.5), transparent: true, opacity: 0.95, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 2.25;
    f.group.add(this.halo);
    this.parts = [{ figure: f, time: this.data.targetTime }];
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f) return;
    placeFigure(f, flyInPoint(this.at, flyInProgress(t, this.data), this.p));
    if (this.halo) {
      // Bobs and tilts a little, on song time.
      this.halo.position.y = 2.25 + Math.sin(t * 3) * 0.04;
      this.halo.rotation.set(-Math.PI / 2 + Math.sin(t * 2.1) * 0.18, 0, Math.cos(t * 1.7) * 0.18);
    }
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(e: TargetEvent): void {
    const f = this.parts[0]?.figure;
    if (!f) return;
    const s = fxScale();
    const fx = this.env.g.fx;
    const audio = this.env.g.audio;
    if (e.type === 'friendly') {
      // Shot a friend: a dull thunk and a blue shatter. It breaks, and so does your combo.
      if (s) {
        fx.shockwave(centreOf(f), COLOR.decoy, 1.6, this.env.g.engine.camera.position);
        fx.sparks(centreOf(f), COLOR.decoy, Math.round(26 * s), 5, SPARK);
        fx.sparks(centreOf(f), DUST, Math.round(8 * s), 3, SPARK * 0.7);
      }
      audio.chime(190, 0.16, 0.16, 0, 'sine', 70);
      audio.miss();
      f.damage(DECOY_HP * 2);
    } else if (e.type === 'spared') {
      // Left alone: it dissolves upwards in a soft sparkle with a kind little chime.
      if (s) {
        const at = this.p.copy(f.position);
        for (const y of [0.4, 1.0, 1.6]) fx.sparks(at.set(f.position.x, y, f.position.z), y > 1 ? WHITE : COLOR.decoy, Math.round(5 * s), 1.2, SPARK);
      }
      audio.chime(SCALE[4], 0.22, 0.04, 0, 'sine');
      audio.chime(SCALE[4] * 1.25, 0.26, 0.035, 0.07, 'sine');
      f.damage(DECOY_HP * 2);
    }
  }

  dispose(): void {
    removeParts(this.env, this.parts);
    this.halo = null;
  }
}
