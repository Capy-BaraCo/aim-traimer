/**
 * Overdrive tap targets (D2, D14): flick shapes, bursts and decoys. One click each (a burst: one per
 * orb); the held stream passes through them (D13).
 *
 * T13 placeholders, clear and hittable rather than pretty (T14 replaces the look):
 *  - circle: a neon orb; diamond: a smaller gold orb in a wire diamond; triangle: an orange orb in a
 *    triangle frame, with a positional ping when it launches so you can hear where to turn.
 *  - burst: a line of small violet orbs, each drawn small until its turn comes (its window opens).
 *  - decoy: a blue (friendly) figure.
 * The orb or figure is the hit volume, so a target is hit exactly where its orb is drawn.
 */
import {
  Color,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type Material,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { store } from '../core/store';
import type { BurstTarget, DecoyTarget, FlickTarget } from '../rhythm/types';
import type { Figure } from '../world/figure';
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
  decoy: new Color('#2f9bff'),
};

/** Burst orbs are smaller than flicks, and smaller still until their turn. */
const ORB_SCALE = 0.75;
const WAITING_SCALE = 0.55;
/** A decoy can't be killed: shooting it only breaks your combo. */
const DECOY_HP = 1e9;

const diamondGeo = new EdgesGeometry(new OctahedronGeometry(1, 0));
const triangleGeo = new RingGeometry(1.25, 1.45, 3, 1, Math.PI / 2);

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

class FlickView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3;
  private readonly radius: number;
  private frame: Object3D | null = null;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: FlickTarget,
  ) {
    this.at = orbPoint(data.position);
    const { targetRadius, diamondScale } = env.params;
    this.radius = data.shape === 'diamond' ? targetRadius * diamondScale : targetRadius;
  }

  spawn(t: number): void {
    const color = COLOR[this.data.shape];
    const f = spawnOrbPart(this.env, flyInPoint(this.at, 0, this.p), this.radius, color);
    this.parts = [{ figure: f, time: this.data.targetTime }];
    if (this.data.shape === 'diamond') {
      this.frame = new LineSegments(diamondGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    } else if (this.data.shape === 'triangle') {
      this.frame = new Mesh(triangleGeo, new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.9 }));
      // Wide flick (D14): you hear where it is before you see it, as in Snap.
      if (store.settings.targetSounds) this.env.g.audio.spawn(this.at);
    }
    if (this.frame) {
      this.frame.scale.setScalar(this.radius * 1.7);
      this.env.g.engine.scene.add(this.frame);
    }
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f) return;
    placeFigure(f, flyInPoint(this.at, flyInProgress(t, this.data), this.p));
    if (this.frame) {
      this.frame.position.copy(this.p);
      // Face the player (who stands at the origin and never moves in Overdrive).
      this.frame.lookAt(0, this.p.y, 0);
      if (this.data.shape === 'diamond') this.frame.rotateY(t * 1.6);
    }
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(_e: TargetEvent): void {}

  dispose(): void {
    removeParts(this.env, this.parts);
    if (this.frame) {
      this.frame.removeFromParent();
      ((this.frame as Mesh).material as Material).dispose();
      this.frame = null;
    }
  }
}

class BurstView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3[];
  private readonly radius: number;
  private readonly opensAt: number[];
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: BurstTarget,
  ) {
    this.at = data.orbs.map((o) => orbPoint(o.position));
    this.radius = env.params.targetRadius * ORB_SCALE;
    // Orb k's turn starts when its window opens: at landing for the first, on the previous orb's beat after that.
    this.opensAt = data.orbs.map((_, k) => (k === 0 ? data.landTime : data.orbs[k - 1].time));
  }

  spawn(t: number): void {
    this.parts = this.data.orbs.map((o, k) => ({
      figure: spawnOrbPart(this.env, flyInPoint(this.at[k], 0, this.p), this.radius, COLOR.burst),
      time: o.time,
    }));
    this.update(t);
  }

  update(t: number): void {
    const k = flyInProgress(t, this.data);
    this.parts.forEach((part, i) => {
      placeFigure(part.figure, flyInPoint(this.at[i], k, this.p));
      part.figure.orbRadius = this.radius * (t >= this.opensAt[i] ? 1 : WAITING_SCALE);
    });
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(_e: TargetEvent): void {}

  dispose(): void {
    removeParts(this.env, this.parts);
  }
}

class DecoyView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: DecoyTarget,
  ) {
    this.at = groundPoint(data.position);
  }

  spawn(t: number): void {
    const f = spawnFigurePart(this.env, flyInPoint(this.at, 0, this.p), COLOR.decoy, DECOY_HP);
    f.showBar = false;
    this.parts = [{ figure: f, time: this.data.targetTime }];
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (f) placeFigure(f, flyInPoint(this.at, flyInProgress(t, this.data), this.p));
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(e: TargetEvent): void {
    if (e.type === 'friendly') this.env.g.audio.miss();
  }

  dispose(): void {
    removeParts(this.env, this.parts);
  }
}
