/**
 * Overdrive's on-screen targets (T13): the runtime interface every target implements, a factory that
 * picks the implementation by kind, and a few shared helpers. Split by kind so the look and movement
 * of each type can be built in parallel:
 *  - overdrive-tap.ts: flick shapes (circle, diamond, triangle), bursts and decoys (T14).
 *  - overdrive-movers.ts: strafers, holds and peekers (T15).
 *  - overdrive-cues.ts: the beat cues (fly-in, closing ring, pulse, flash) and the HUD hooks (T16).
 *
 * A target owns its look and its movement, both placed from song time only (R1): give it the same
 * song time and it draws the same frame, so pausing freezes it and it never drifts from the music.
 * The rules (when it opens, what a shot counts as, judging, scoring) are not its business: they live
 * in src/rhythm/run.ts and the drill (overdrive.ts), which tell it what happened through react().
 *
 * Hit volumes are Figures (src/world/figure.ts) registered with the Game, so shots, walls and the
 * crosshair test them like any other drill's targets. A target lists them as `parts`.
 *
 * Import rule: the kind files import from this file and this file imports them (for the factory).
 * Keep this file's runtime exports to function declarations, and never use them at the top level
 * of a kind file (no `extends`, no top-level constants built from them), or the cycle breaks.
 */
import { Color, Vector3 } from 'three';
import type { Game } from '../core/game';
import type { LevelParams } from '../rhythm/levels';
import type { Judgement } from '../rhythm/scoring';
import type { Chart, ChartTarget, TargetPosition } from '../rhythm/types';
import { bearingXZ } from '../world/arena';
import type { Figure } from '../world/figure';
import { OW } from '../world/movement';
import { dirFrom } from './common';
import { createMover } from './overdrive-movers';
import { createTap } from './overdrive-tap';

/** What every target gets to work with. */
export interface TargetEnv {
  readonly g: Game;
  readonly chart: Chart;
  /** The level's parameters (target radius, diamond scale, strafer speed…), from levelParams(chart.level). */
  readonly params: LevelParams;
  /** The song's beat times in song time, ascending (Analysis.beats). Use beatPosition() from world/synthwave to read it. */
  readonly beats: readonly number[];
}

/** One hittable part of a target: a burst has one per orb, every other kind has one. */
export interface TargetPart {
  /** The hit volume. Where it is drawn is where it is hit. */
  readonly figure: Figure;
  /** The part's own beat in song time: the target's targetTime, or a burst orb's time. */
  readonly time: number;
}

/** What the drill tells a target about itself. `part` is the burst orb (0 for every other kind). */
export type TargetEvent =
  /** A click judged it (or the window ended unhit: judgement 'miss'). */
  | { type: 'judged'; part: number; judgement: Judgement; offsetMs: number }
  /** Strafers and holds: the crosshair came onto it (or left it) while firing. Sent on changes only. */
  | { type: 'contact'; on: boolean }
  /** Strafers and holds are over: the share of their life you tracked; `killed` if a strafer's health ran out. */
  | { type: 'tracked'; fraction: number; hit: boolean; killed: boolean }
  /** A decoy was shot. */
  | { type: 'friendly' }
  /** A decoy's window ended and you left it alone. */
  | { type: 'spared' };

/**
 * The runtime side of one ChartTarget. The drill calls, in order: spawn() at launchTime (the fly-in
 * starts), update() every frame until it is resolved, react() for everything that happens to it,
 * then dispose() once it is resolved (hit, killed or its window ended). A figure that a shot killed
 * plays its own death pop and is removed by the Game.
 */
export interface OverdriveTarget {
  readonly data: ChartTarget;
  /** Hittable parts, in order. Filled by spawn(). */
  readonly parts: readonly TargetPart[];
  /** Build the figures and meshes. `t` is the song time now (at or just after launchTime). */
  spawn(t: number): void;
  /** Place everything for song time `t`. */
  update(t: number): void;
  /** Which part a shot struck: an index into `parts`, or -1 if it isn't this target. */
  partHit(figure: Figure | null): number;
  react(e: TargetEvent): void;
  /** Remove everything this target added to the scene. Safe to call twice. */
  dispose(): void;
}

/** Build the runtime target for a chart entry. */
export function createTarget(env: TargetEnv, data: ChartTarget): OverdriveTarget {
  switch (data.kind) {
    case 'flick':
    case 'burst':
    case 'decoy':
      return createTap(env, data);
    case 'strafer':
    case 'hold':
    case 'peeker':
      return createMover(env, data);
  }
}

// ------------------------------------------------------------------------------------------ helpers

/**
 * World point of an orb's centre. Chart positions are seen from the player's start point, standing
 * at the origin with OW's standing eye height (types.ts TargetPosition).
 */
export function orbPoint(p: TargetPosition, out = new Vector3()): Vector3 {
  dirFrom(p.bearing, p.pitch, out).multiplyScalar(p.distance);
  out.y += OW.eyeStand;
  return out;
}

/** World point of a figure's feet: the ground point at the position's bearing and distance (pitch is ignored). */
export function groundPoint(p: TargetPosition, out = new Vector3()): Vector3 {
  const { x, z } = bearingXZ(p.bearing, p.distance);
  return out.set(x, 0, z);
}

/** Unit vector along the ground to the player's right at a bearing (as they face it). */
export function rightOf(bearingDeg: number, out = new Vector3()): Vector3 {
  const b = (bearingDeg * Math.PI) / 180;
  return out.set(Math.cos(b), 0, Math.sin(b));
}

/** An orb hit volume at `at`, in the given colour. Takes one click to pop. */
export function spawnOrbPart(env: TargetEnv, at: Vector3, radius: number, color: Color): Figure {
  const f = env.g.spawnOrb(at, radius, color);
  f.hp = f.maxHp = 1;
  return f;
}

/** A standing figure (strafer, peeker, decoy) with its feet at `at`. No brain: the target moves it from song time. */
export function spawnFigurePart(env: TargetEnv, at: Vector3, color: Color, hp: number): Figure {
  const f = env.g.spawnHumanoid(at.x, at.z, undefined, color);
  f.hp = f.maxHp = hp;
  return f;
}

/** Put a figure (orb centre or feet) at a world point. */
export function placeFigure(f: Figure, at: Vector3): void {
  f.mover.pos.copy(at);
  f.mover.vel.set(0, 0, 0);
  f.mover.onGround = at.y <= 0.001;
}

/** Remove a target's figures from the Game. Skips figures already gone or dying (a kill pops on its own). */
export function removeParts(env: TargetEnv, parts: readonly TargetPart[]): void {
  for (const p of parts) if (p.figure.alive && env.g.figures.includes(p.figure)) env.g.removeFigure(p.figure);
}

/** Index of `figure` in `parts`, or -1. */
export function partIndex(parts: readonly TargetPart[], figure: Figure | null): number {
  if (!figure) return -1;
  for (let i = 0; i < parts.length; i++) if (parts[i].figure === figure) return i;
  return -1;
}
