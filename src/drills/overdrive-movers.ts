/**
 * Overdrive moving targets (D2, D13): strafers, holds and peekers. Every position is a function of
 * song time and the song's beats only, so they move in time with the music and freeze on pause.
 *
 * T13 placeholders, clear and hittable rather than pretty (T15 replaces the movement and look):
 *  - strafer: a red figure that strafes across its lane at a steady speed and turns on every beat.
 *    The held stream drains its health; it pops when the health is gone.
 *  - hold: a green orb that waits on its first point, then glides along its path from its target
 *    beat, reaching path point i i beats later (a smooth curve through the points). Its path is drawn
 *    faintly so you can see where it will go. It can't be killed: you follow it to the end.
 *  - peeker: a red figure that drops in behind its wall, steps out on its target beat and is gone
 *    when its window ends. While it is behind the wall, shots hit the wall.
 */
import { BufferGeometry, Color, Line, LineBasicMaterial, Vector3 } from 'three';
import { hidePosition, peekPosition, STRAFE_LANE } from '../rhythm/generator';
import type { HoldTarget, PeekerTarget, StraferTarget, TargetPosition } from '../rhythm/types';
import type { Figure } from '../world/figure';
import { OW } from '../world/movement';
import { beatPosition } from '../world/synthwave';
import { flyInPoint, flyInProgress } from './overdrive-cues';
import {
  groundPoint,
  orbPoint,
  partIndex,
  placeFigure,
  removeParts,
  rightOf,
  spawnFigurePart,
  spawnOrbPart,
  type OverdriveTarget,
  type TargetEnv,
  type TargetEvent,
  type TargetPart,
} from './overdrive-targets';

const COLOR = {
  strafer: new Color('#ff3b5c'),
  hold: new Color('#3dffa8'),
  peeker: new Color('#ff3b5c'),
};

/** Hold orbs are a little bigger than flicks: you stay on them rather than snap to them. */
const HOLD_SCALE = 1.15;
/** Seconds a peeker takes to step out from behind its wall. */
const PEEK_STEP_TIME = 0.1;

export function createMover(env: TargetEnv, data: StraferTarget | HoldTarget | PeekerTarget): OverdriveTarget {
  switch (data.kind) {
    case 'strafer':
      return new StraferView(env, data);
    case 'hold':
      return new HoldView(env, data);
    case 'peeker':
      return new PeekerView(env, data);
  }
}

/** Triangle wave on beats: -1 on even beats, +1 on odd ones, straight lines between (so it turns on every beat). */
const beatZigzag = (u: number): number => 1 - 2 * Math.abs(1 - (((u % 2) + 2) % 2));

/** Seconds per beat around [from, to], measured along the song's beats (60 / 120 if it has none). */
function beatLength(beats: readonly number[], from: number, to: number): number {
  const span = beatPosition(beats, to) - beatPosition(beats, from);
  return span > 0 ? (to - from) / span : 0.5;
}

class StraferView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly at: Vector3;
  private readonly right: Vector3;
  /** Strafe half-width in metres: how far a beat at its speed carries it, kept inside the lane. */
  private readonly amp: number;
  /** +1 starts on the right edge (moving left), -1 on the left: always from the outside in. */
  private readonly side: number;
  private readonly startBeat: number;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: StraferTarget,
  ) {
    this.at = groundPoint(data.position);
    this.right = rightOf(data.position.bearing);
    const beat = beatLength(env.beats, data.landTime, data.windowEnd);
    this.amp = Math.min(STRAFE_LANE, (OW.speed * data.speed * beat) / 2);
    this.side = data.position.bearing >= 0 ? 1 : -1;
    this.startBeat = beatPosition(env.beats, data.landTime);
  }

  spawn(t: number): void {
    this.parts = [{ figure: spawnFigurePart(this.env, this.at, COLOR.strafer, this.data.health), time: this.data.targetTime }];
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f || !f.alive) return;
    const u = Math.max(0, beatPosition(this.env.beats, t) - this.startBeat);
    const to = this.p.copy(this.at).addScaledVector(this.right, -this.side * this.amp * beatZigzag(u));
    placeFigure(f, flyInPoint(to, flyInProgress(t, this.data), this.p));
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(_e: TargetEvent): void {}

  dispose(): void {
    removeParts(this.env, this.parts);
  }
}

/** Catmull-Rom through path points (in bearing / pitch / distance), at `u` points along (0 = first). */
function pathAt(path: readonly TargetPosition[], u: number): TargetPosition {
  const n = path.length;
  if (n === 1) return path[0];
  const i = Math.min(n - 2, Math.max(0, Math.floor(u)));
  const f = Math.min(1, Math.max(0, u - i));
  const P = (k: number) => path[Math.min(n - 1, Math.max(0, k))];
  const [a, b, c, d] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
  const cr = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  return {
    bearing: cr(a.bearing, b.bearing, c.bearing, d.bearing),
    pitch: cr(a.pitch, b.pitch, c.pitch, d.pitch),
    distance: cr(a.distance, b.distance, c.distance, d.distance),
  };
}

class HoldView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly start: Vector3;
  private readonly from: number;
  private readonly to: number;
  private trail: Line | null = null;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: HoldTarget,
  ) {
    this.start = orbPoint(data.path[0]);
    this.from = beatPosition(env.beats, data.targetTime);
    this.to = beatPosition(env.beats, data.windowEnd);
  }

  spawn(t: number): void {
    const f = spawnOrbPart(this.env, this.start, this.env.params.targetRadius * HOLD_SCALE, COLOR.hold);
    f.hp = f.maxHp = Infinity;
    this.parts = [{ figure: f, time: this.data.targetTime }];
    const n = this.data.path.length - 1;
    const pts = Array.from({ length: n * 12 + 1 }, (_, i) => orbPoint(pathAt(this.data.path, i / 12)));
    this.trail = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: COLOR.hold, transparent: true, opacity: 0.3 }));
    this.env.g.engine.scene.add(this.trail);
    this.update(t);
  }

  /**
   * Point i of the path is reached i beats after the target beat (a hold lands HOLD_LEAD beats before it, T6),
   * measured along the song's beats and stretched so the last point lands exactly on windowEnd.
   */
  private progress(t: number): number {
    const span = this.to - this.from;
    const k = span > 0 ? (beatPosition(this.env.beats, t) - this.from) / span : t >= this.data.windowEnd ? 1 : 0;
    return (this.data.path.length - 1) * Math.min(1, Math.max(0, k));
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f) return;
    const at = t < this.data.targetTime ? this.p.copy(this.start) : orbPoint(pathAt(this.data.path, this.progress(t)), this.p);
    placeFigure(f, flyInPoint(at, flyInProgress(t, this.data), this.p));
    if (this.trail) (this.trail.material as LineBasicMaterial).opacity = t < this.data.landTime ? 0.12 : 0.3;
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(_e: TargetEvent): void {}

  dispose(): void {
    removeParts(this.env, this.parts);
    if (this.trail) {
      this.trail.removeFromParent();
      this.trail.geometry.dispose();
      (this.trail.material as LineBasicMaterial).dispose();
      this.trail = null;
    }
  }
}

class PeekerView implements OverdriveTarget {
  parts: TargetPart[] = [];
  private readonly hide: Vector3;
  private readonly peek: Vector3;
  private readonly p = new Vector3();

  constructor(
    private readonly env: TargetEnv,
    readonly data: PeekerTarget,
  ) {
    const wall = env.chart.walls[data.wall];
    this.hide = groundPoint(wall ? hidePosition(wall) : data.position);
    this.peek = groundPoint(wall ? peekPosition(wall, data.side) : data.position);
  }

  spawn(t: number): void {
    this.parts = [{ figure: spawnFigurePart(this.env, this.hide, COLOR.peeker, 1), time: this.data.targetTime }];
    this.update(t);
  }

  update(t: number): void {
    const f = this.parts[0]?.figure;
    if (!f || !f.alive) return;
    // Hidden behind the wall until its target beat, then a quick step out past the edge.
    const k = Math.min(1, Math.max(0, (t - this.data.targetTime) / PEEK_STEP_TIME));
    const to = this.p.copy(this.hide).lerp(this.peek, 1 - (1 - k) ** 2);
    placeFigure(f, flyInPoint(to, flyInProgress(t, this.data), this.p));
  }

  partHit(figure: Figure | null): number {
    return partIndex(this.parts, figure);
  }

  react(_e: TargetEvent): void {}

  dispose(): void {
    removeParts(this.env, this.parts);
  }
}
