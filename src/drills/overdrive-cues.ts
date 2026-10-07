/**
 * Overdrive's beat cues (D5, V3) and HUD hooks (T13 seams for T16).
 *
 * V3's choreography for one target, all on song time: it flies in from the distance during the beat
 * before it lands; from landing a ring closes onto it and touches it on its target beat; it pulses
 * with the music and flashes on its beat; and its icon crosses the beat strip's hit line on the same
 * beat. T13 ships only the fly-in (so targets don't pop in) and the hook points; T16 builds the rest:
 *  - per target: createCue() returns a TargetCue the drill updates every frame after the target;
 *  - HUD: createHud() returns the OverdriveHud the drill feeds the combo, the judgements and the
 *    beat strip's entries (stripEntries()).
 */
import { Vector3 } from 'three';
import type { Game } from '../core/game';
import type { Judgement } from '../rhythm/scoring';
import type { Chart, ChartTarget, FlickShape, TargetKind } from '../rhythm/types';
import { beatPosition } from '../world/synthwave';
import type { OverdriveTarget, TargetEnv, TargetEvent } from './overdrive-targets';

// ------------------------------------------------------------------------------------------ fly-in

/** The fly-in starts this far beyond the landing point (metres, along the line from the player)… */
const FLY_FROM = 38;
/** …and this far up, so it swoops down onto its spot. */
const FLY_RISE = 7;

/** Fly-in progress: 0 at launchTime, 1 at landTime and after. Eased out, so it settles onto its landing beat. */
export function flyInProgress(t: number, target: Pick<ChartTarget, 'launchTime' | 'landTime'>): number {
  const span = target.landTime - target.launchTime;
  const k = span > 0 ? (t - target.launchTime) / span : 1;
  if (k >= 1) return 1;
  if (k <= 0) return 0;
  return 1 - (1 - k) ** 3;
}

/** Where something landing at `to` is drawn at fly-in progress `k`: from far out and high up, onto `to`. */
export function flyInPoint(to: Vector3, k: number, out = new Vector3()): Vector3 {
  if (k >= 1) return out.copy(to);
  const h = Math.hypot(to.x, to.z) || 1;
  const rest = 1 - k;
  return out.set(to.x + (to.x / h) * FLY_FROM * rest, to.y + FLY_RISE * rest, to.z + (to.z / h) * FLY_FROM * rest);
}

// ------------------------------------------------------------------------------------------ per-target cues

/**
 * The ring, pulse and flash for one target (T16). The drill creates one when the target spawns,
 * calls update() every frame after the target's own update(), forwards every TargetEvent to react(),
 * and disposes it with the target. Read the target's `parts` for where to draw (figure.position)
 * and when (part.time).
 */
export interface TargetCue {
  update(t: number): void;
  react(e: TargetEvent): void;
  dispose(): void;
}

/** T13 placeholder: no ring, pulse or flash yet. */
export function createCue(_env: TargetEnv, _target: OverdriveTarget): TargetCue {
  return { update() {}, react() {}, dispose() {} };
}

// ------------------------------------------------------------------------------------------ HUD

/** One upcoming target on the beat strip. */
export interface StripEntry {
  /** Index in chart.targets. */
  index: number;
  kind: TargetKind;
  shape?: FlickShape;
  /** Its target beat, in song time. */
  time: number;
  /** Beats from now until its target beat (0 on the hit line, negative once past it). */
  beatsAway: number;
}

/**
 * The beat strip's contents at song time `t`: every target whose target beat is within `ahead`
 * beats in front (or `behind` beats past) of now, in time order. Pure. Relies on chart.targets
 * being sorted by targetTime (T6), so it only looks at the targets near now.
 */
export function stripEntries(chart: Chart, beats: readonly number[], t: number, ahead = 4, behind = 0.5): StripEntry[] {
  const now = beatPosition(beats, t);
  const away = (i: number) => beatPosition(beats, chart.targets[i].targetTime) - now;
  let lo = 0;
  let hi = chart.targets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (away(mid) < -behind) lo = mid + 1;
    else hi = mid;
  }
  const out: StripEntry[] = [];
  for (let index = lo; index < chart.targets.length; index++) {
    const beatsAway = away(index);
    if (beatsAway > ahead) break;
    const target = chart.targets[index];
    out.push({ index, kind: target.kind, shape: target.kind === 'flick' ? target.shape : undefined, time: target.targetTime, beatsAway });
  }
  return out;
}

/** What the HUD shows every frame. */
export interface HudState {
  /** Song time. */
  t: number;
  combo: number;
  /** ×1–×4. */
  multiplier: number;
  /** Score so far, 0–100 of the whole chart. */
  score: number;
  /** Mean signed timing offset of the hits so far, ms (negative is early). */
  meanOffsetMs: number;
  /** Upcoming targets for the beat strip (empty when the beatStrip setting is off). */
  strip: StripEntry[];
}

/** The HUD hooks the drill calls (T16 replaces the placeholder with the combo counter, judgement word and beat strip). */
export interface OverdriveHud {
  /** Every frame. */
  frame(s: HudState): void;
  /** A Judgement just happened: on the frame of the click, or when a window ends unhit. */
  judgement(j: Judgement, offsetMs: number): void;
  /** A decoy was shot. */
  friendly(): void;
  /** The run is over or quit: remove anything this HUD added. */
  dispose(): void;
}

const WORD: Record<Judgement, { text: string; tone: string }> = {
  perfect: { text: 'PERFECT', tone: 'clean' },
  early: { text: 'EARLY', tone: 'under' },
  late: { text: 'LATE', tone: 'over' },
  miss: { text: 'MISS', tone: 'warn' },
};

/** T13 placeholder: combo, multiplier, score and timing on the stat rail; judgements as the HUD toast. */
export function createHud(g: Game): OverdriveHud {
  let rail = -Infinity;
  return {
    frame(s) {
      if (s.t < rail) return;
      rail = s.t + 0.1;
      const off = Math.round(s.meanOffsetMs);
      g.hud.setStats([
        { k: 'COMBO', v: String(s.combo), tone: s.multiplier >= 4 ? 'good' : '' },
        { k: 'MULTI', v: `×${s.multiplier}` },
        { k: 'SCORE', v: String(Math.round(s.score)) },
        { k: 'TIMING', v: off ? `${off > 0 ? '+' : '−'}${Math.abs(off)} ms` : '0 ms' },
      ]);
    },
    judgement(j) {
      g.hud.flashToast(WORD[j].text, WORD[j].tone);
    },
    friendly() {
      g.hud.flashToast('FRIENDLY', 'warn');
    },
    dispose() {
      g.hud.setStats([]);
    },
  };
}
