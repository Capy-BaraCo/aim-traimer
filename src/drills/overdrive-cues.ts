/**
 * Overdrive's beat cues (D5, V3) and HUD (T16).
 *
 * V3's choreography for one target, all on song time (R1): it flies in from the distance during the
 * beat before it lands; from landing a ring closes onto it and touches it on its target beat; it
 * pulses with the music and flashes on its beat; and its icon crosses the beat strip's hit line on
 * the same beat.
 *  - per target: createCue() returns a TargetCue the drill updates every frame after the target. It
 *    draws the closing ring, the pulse and the flash on the beat, and the pops on a hit;
 *  - HUD: createHud() returns the OverdriveHud the drill feeds the combo, the judgements and the
 *    beat strip's entries (stripEntries()). It draws the beat strip, the combo counter with its
 *    multiplier and the judgement word, and owns the world-space bursts the cues hand it (a hit's
 *    ring has to outlive its target, which is gone the moment it is hit).
 * R3: every cue is thin and faint until the moment it matters (the ring is brightest as it touches,
 * the flash lasts a fifth of a second), nothing big sits near the crosshair but the word, and the FX
 * setting scales all of it: 'off' keeps only the ring, the word and the strip.
 * D19: drops, fills and flourishes (env.roles) get a moment of their own.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import type { Game } from '../core/game';
import { store, type FxLevel } from '../core/store';
import type { TargetRole } from '../rhythm/generator';
import type { Judgement } from '../rhythm/scoring';
import type { Chart, ChartTarget, FlickShape, TargetKind } from '../rhythm/types';
import type { Figure } from '../world/figure';
import { beatFlash, beatPosition } from '../world/synthwave';
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

// ------------------------------------------------------------------------------------------ pure helpers

/** The closing ring ends this many target radii out: it hugs the target, touching it on the beat. */
export const RING_HUG = 1.25;
/** The ring starts this many radii further out than the hug, and closes at a steady speed (like an approach circle). */
export const RING_SPREAD = 2.4;

/** 0 when a ring starts closing, 1 when it touches the target (its beat). Not clamped. */
export function ringProgress(t: number, from: number, to: number): number {
  return to > from ? (t - from) / (to - from) : t >= to ? 1 : 0;
}

/** The closing ring's radius in target radii: RING_HUG + RING_SPREAD at k = 0, exactly RING_HUG at k >= 1. */
export function ringScale(k: number): number {
  return RING_HUG + RING_SPREAD * (1 - Math.max(0, Math.min(1, k)));
}

/** The beat strip's hit line sits this far along the strip (0 = left edge, 1 = right edge). */
export const STRIP_HIT_AT = 0.14;

/**
 * Where an icon sits along the beat strip (0..1): on the hit line when its beat is now, further
 * right the further ahead it is (`ahead` beats reach the right edge), a little left once past it.
 */
export function stripX(beatsAway: number, ahead = 4): number {
  return STRIP_HIT_AT + (beatsAway / ahead) * (0.97 - STRIP_HIT_AT);
}

/** The beat flash (1 on the beat, gone by 60% of the way to the next) from a continuous beat position: beatFlash() without the beat list. */
export function flashAt(position: number): number {
  const k = 1 - (position - Math.floor(position)) / 0.6;
  return k > 0 ? k * k : 0;
}

/** How far through the combo toward the next multiplier step (0..1; 1 at the top multiplier). Mirrors scoring.ts: one step per 8 combo, up to ×4. */
export function multiplierProgress(combo: number, multiplier: number): number {
  if (multiplier >= 4) return 1;
  return Math.max(0, Math.min(1, (combo - (multiplier - 1) * 8) / 8));
}

// ------------------------------------------------------------------------------------------ colours

const KIND_HEX = {
  circle: '#ff2bd6',
  diamond: '#ffd23f',
  triangle: '#ff7a1a',
  burst: '#b05cff',
  strafer: '#ff3b5c',
  hold: '#3dffa8',
  peeker: '#ff6b8a',
  decoy: '#2f9bff',
} as const;

/** Same hues as the targets themselves, so a ring reads as part of its target. */
function colorHex(data: ChartTarget): string {
  return data.kind === 'flick' ? KIND_HEX[data.shape] : KIND_HEX[data.kind];
}

const JUDGE_HEX: Record<Judgement, string> = { perfect: '#ffe27a', early: '#19e6ff', late: '#ff9a3c', miss: '#ff3b5c' };
const GOOD_HEX = '#3dffc8';
const WHITE = new Color('#ffffff');
const FILL_HEX = '#19e6ff';
const DROP_HEX = '#ffd23f';

// ------------------------------------------------------------------------------------------ world-space bursts

const ringGeo = new RingGeometry(0.92, 1, 64);
const thinRingGeo = new RingGeometry(0.965, 1, 64);
const discGeo = new CircleGeometry(1, 32);

/** What the FX setting allows (D19: it is the player's call). */
function fxOf(): FxLevel {
  return store.settings.fx;
}

interface Burst {
  mesh: Mesh<RingGeometry | CircleGeometry, MeshBasicMaterial>;
  /** Song time it starts, and for how long. */
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  opacity: number;
  /** Lies flat on the floor instead of facing the camera. */
  floor: boolean;
  /** Fades like a flash (quadratic) rather than a ring (linear-ish). */
  disc: boolean;
}

const MAX_BURSTS = 36;

/** What a cue can ask of the HUD (which owns the bursts, the drop flash and the strip marks). */
interface CueLayer {
  readonly fx: FxLevel;
  burst(at: Vector3, r0: number, r1: number, t0: number, dur: number, hex: string, opacity?: number, opts?: { disc?: boolean; floor?: boolean; thin?: boolean }): void;
  /** A hit or miss on strip entry `index`. */
  mark(index: number, judgement: Judgement | 'friendly' | 'spared'): void;
  /** A drop landed: flash the screen's edges. */
  dropFlash(): void;
}

/** The layer of the run in progress (one at a time). Cues made without a HUD simply draw no bursts. */
let layer: CueLayer | null = null;

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

/** A part's centre and the radius to ring: an orb's own, or a figure's body. */
function anchor(f: Figure, out: Vector3): number {
  if (f.kind === 'orb') {
    out.copy(f.position);
    return Math.max(0.15, f.orbRadius);
  }
  f.aimPoint(out);
  return 0.62;
}

/** Ring material: additive and unlit, drawn over the scene (peekers hide behind their wall like the rest of them). */
function ringMaterial(hex: string, depthTest = false): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(hex),
    transparent: true,
    opacity: 0,
    depthTest,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
}

/** How long after the beat the flash lasts, in seconds. */
const FLASH_DUR = 0.2;
/** How long a hugging ring lingers after the beat, in seconds. */
const LINGER = 0.1;

interface PartCue {
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  /** Fill targets get a second, fainter ring just inside the first. */
  echo: Mesh<RingGeometry, MeshBasicMaterial> | null;
  from: number;
  to: number;
  fired: boolean;
  /** Last place it was drawn, for the burst of a hit after its figure is gone. */
  at: Vector3;
  r: number;
}

class Cue implements TargetCue {
  private readonly parts: PartCue[] = [];
  private readonly halo: Mesh<RingGeometry, MeshBasicMaterial> | null;
  private readonly hex: string;
  private readonly role: TargetRole;
  private readonly index: number;
  private readonly tracked: boolean;
  private contact = false;
  private readonly c = new Vector3();
  private disposed = false;

  constructor(
    private readonly env: TargetEnv,
    private readonly target: OverdriveTarget,
  ) {
    const data = target.data;
    const fx = fxOf();
    this.hex = colorHex(data);
    this.index = env.chart.targets.indexOf(data);
    this.role = (this.index >= 0 && env.roles?.[this.index]) || 'pattern';
    this.tracked = data.kind === 'strafer' || data.kind === 'hold';
    const scene = env.g.engine.scene;
    const depth = data.kind === 'peeker';
    const span = Math.max(0.15, data.targetTime - data.landTime);
    const hex = this.role === 'fill' ? FILL_HEX : this.hex;
    target.parts.forEach((part, i) => {
      // Burst orbs close on their own beats, never earlier than the burst's own lead and never as a pile on the first.
      const gap = i > 0 ? (part.time - target.parts[i - 1].time) * 2 : Infinity;
      const own = Math.min(span, gap);
      const ring = new Mesh(thinRingGeo, ringMaterial(hex, depth));
      ring.renderOrder = 20;
      ring.visible = false;
      scene.add(ring);
      let echo: PartCue['echo'] = null;
      if (this.role === 'fill' && fx !== 'off') {
        echo = new Mesh(thinRingGeo, ringMaterial('#ffffff', depth));
        echo.renderOrder = 20;
        echo.visible = false;
        scene.add(echo);
      }
      this.parts.push({ ring, echo, from: part.time - own, to: part.time, fired: false, at: new Vector3(), r: 0.3 });
    });
    if (fx !== 'off' && data.kind !== 'decoy') {
      this.halo = new Mesh(thinRingGeo, ringMaterial(this.hex, depth));
      this.halo.renderOrder = 19;
      this.halo.visible = false;
      scene.add(this.halo);
    } else this.halo = null;
  }

  update(t: number): void {
    const data = this.target.data;
    const fx = fxOf();
    const cam = this.env.g.engine.camera.quaternion;
    const live = t >= data.landTime && t < data.windowEnd + 0.05;
    this.target.parts.forEach((part, i) => {
      const pc = this.parts[i];
      const f = part.figure;
      if (!f.alive || !live) {
        pc.ring.visible = false;
        if (pc.echo) pc.echo.visible = false;
        return;
      }
      pc.r = anchor(f, pc.at);
      const k = ringProgress(t, pc.from, pc.to);
      const decoy = data.kind === 'decoy';
      let opacity = 0;
      let scale = ringScale(k);
      if (decoy) {
        // A friendly: no beat to hit, so no closing ring: a steady, slow breath in a calm blue.
        scale = RING_HUG + 0.12 * Math.sin(t * 5);
        opacity = 0.35;
      } else if (k < 1) {
        // Faint at first, brightest as it touches (R3).
        opacity = k < 0 ? 0 : 0.14 + 0.78 * k * k;
      } else if (this.tracked) {
        // Strafers and holds are shot for as long as they last: the ring stays on, bright while you are on target.
        opacity = this.contact ? 0.85 : 0.3;
      } else {
        opacity = Math.max(0, 1 - (t - pc.to) / LINGER) * 0.9;
      }
      pc.ring.visible = opacity > 0.01;
      if (pc.ring.visible) {
        pc.ring.position.copy(pc.at);
        pc.ring.quaternion.copy(cam);
        pc.ring.scale.setScalar(pc.r * scale);
        pc.ring.material.opacity = opacity;
        // The last stretch whitens toward the touch, so the beat is where the ring is brightest.
        if (this.role !== 'fill' && !decoy) pc.ring.material.color.set(this.hex).lerp(WHITE, k > 0.8 ? ((Math.min(1, k) - 0.8) / 0.2) * 0.7 : 0);
      }
      if (pc.echo) {
        pc.echo.visible = pc.ring.visible && k < 1 && k > 0;
        if (pc.echo.visible) {
          pc.echo.position.copy(pc.at);
          pc.echo.quaternion.copy(cam);
          pc.echo.scale.setScalar(pc.r * (scale + 0.55));
          pc.echo.material.opacity = opacity * 0.45;
        }
      }
      if (!pc.fired && t >= pc.to && !decoy) {
        pc.fired = true;
        this.onBeat(pc, i);
      }
    });

    if (this.halo) {
      const f = this.target.parts[0]?.figure;
      this.halo.visible = !!f && f.alive && live;
      if (this.halo.visible) {
        const pc = this.parts[0];
        const b = beatFlash(this.env.beats, t);
        this.halo.position.copy(pc.at);
        this.halo.quaternion.copy(cam);
        // The pulse: a thin halo that breathes with the beat (full), or just glows (lite).
        this.halo.scale.setScalar(pc.r * (1.9 + (fx === 'full' ? 0.25 * b : 0)));
        this.halo.material.opacity = (fx === 'full' ? 0.08 + 0.22 * b : 0.1) * (t < pc.to ? 1 : 0.5);
      }
    }
  }

  /** The flash on a part's beat, plus a role's moment (D19). */
  private onBeat(pc: PartCue, i: number): void {
    const fx = fxOf();
    if (!layer || fx === 'off') return;
    const t = this.target.parts[i].time;
    const big = this.role === 'drop';
    layer.burst(pc.at, pc.r * 1.3, pc.r * (big ? 2.4 : 1.8), t, FLASH_DUR, big ? DROP_HEX : this.hex, big ? 0.7 : 0.5, { disc: true });
    if (this.role === 'drop') {
      // The drop: the screen's edges flare, a ring blows out from the target and another rolls across the grid.
      layer.dropFlash();
      layer.burst(pc.at, pc.r * 1.3, pc.r * 9, t, 0.55, DROP_HEX, 0.8);
      if (fx === 'full') layer.burst(this.floorPoint(pc.at), 1, 26, t, 0.9, '#ff2bd6', 0.75, { floor: true, thin: true });
    } else if (this.role === 'flourish') {
      layer.burst(pc.at, pc.r * 1.3, pc.r * 4.2, t, 0.45, '#ffffff', 0.7);
      layer.burst(pc.at, pc.r * 1.3, pc.r * 6.5, t + 0.08, 0.5, DROP_HEX, 0.6);
    } else if (this.role === 'fill') {
      layer.burst(pc.at, pc.r * 1.3, pc.r * 3, t, 0.3, FILL_HEX, 0.55);
    }
  }

  private floorPoint(p: Vector3): Vector3 {
    return this.c.set(p.x, 0.04, p.z);
  }

  react(e: TargetEvent): void {
    if (!layer) return;
    const fx = fxOf();
    const t = this.env.g.audio.songTime();
    switch (e.type) {
      case 'judged': {
        const pc = this.parts[e.part] ?? this.parts[0];
        const f = this.target.parts[e.part]?.figure;
        if (f) pc.r = anchor(f, pc.at);
        layer.mark(this.index, e.judgement);
        pc.ring.visible = false;
        const hex = JUDGE_HEX[e.judgement];
        if (e.judgement === 'miss') {
          // The window closed: the ring just lets go.
          layer.burst(pc.at, pc.r * RING_HUG, pc.r * 1.7, t, 0.4, hex, 0.35);
        } else if (e.judgement === 'perfect') {
          layer.burst(pc.at, pc.r * RING_HUG, pc.r * 3.4, t, 0.38, hex, 0.95);
          if (fx !== 'off') layer.burst(pc.at, pc.r * 0.6, pc.r * 1.8, t, 0.2, '#ffffff', 0.8, { disc: true });
          if (fx === 'full') layer.burst(pc.at, pc.r * RING_HUG, pc.r * 5, t + 0.06, 0.4, hex, 0.5);
          this.roleHit(pc, t, fx);
        } else {
          layer.burst(pc.at, pc.r * RING_HUG, pc.r * 2.4, t, 0.3, hex, 0.75);
          this.roleHit(pc, t, fx);
        }
        break;
      }
      case 'contact':
        this.contact = e.on;
        break;
      case 'tracked': {
        const pc = this.parts[0];
        const f = this.target.parts[0]?.figure;
        if (f) pc.r = anchor(f, pc.at);
        layer.mark(this.index, e.hit ? 'perfect' : 'miss');
        pc.ring.visible = false;
        if (e.hit) layer.burst(pc.at, pc.r * RING_HUG, pc.r * (e.killed ? 4.5 : 3), t, 0.4, GOOD_HEX, 0.8);
        else layer.burst(pc.at, pc.r * RING_HUG, pc.r * 1.7, t, 0.4, JUDGE_HEX.miss, 0.35);
        break;
      }
      case 'friendly': {
        const pc = this.parts[0];
        layer.mark(this.index, 'friendly');
        layer.burst(pc.at, pc.r * RING_HUG, pc.r * 2.6, t, 0.35, JUDGE_HEX.miss, 0.8);
        break;
      }
      case 'spared': {
        const pc = this.parts[0];
        layer.mark(this.index, 'spared');
        layer.burst(pc.at, pc.r * 2.4, pc.r * RING_HUG, t, 0.35, GOOD_HEX, 0.5);
        break;
      }
    }
  }

  /** Extra pop when a role's target is actually hit. */
  private roleHit(pc: PartCue, t: number, fx: FxLevel): void {
    if (!layer || fx === 'off') return;
    if (this.role === 'drop') layer.burst(pc.at, pc.r * RING_HUG, pc.r * 7, t, 0.5, DROP_HEX, 0.9);
    else if (this.role === 'flourish') layer.burst(pc.at, pc.r * RING_HUG, pc.r * 5.5, t + 0.04, 0.45, '#ffffff', 0.8);
    else if (this.role === 'fill') layer.burst(pc.at, pc.r * RING_HUG, pc.r * 3.6, t, 0.3, FILL_HEX, 0.7);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const scene = this.env.g.engine.scene;
    const drop = (m: Mesh<RingGeometry, MeshBasicMaterial> | null) => {
      if (!m) return;
      scene.remove(m);
      m.material.dispose();
    };
    for (const pc of this.parts) {
      drop(pc.ring);
      drop(pc.echo);
    }
    drop(this.halo);
  }
}

/** The ring, pulse and flash for a freshly spawned target. */
export function createCue(env: TargetEnv, target: OverdriveTarget): TargetCue {
  // Headless (vitest in node, no DOM or renderer): nothing to draw.
  if (typeof document === 'undefined') return { update() {}, react() {}, dispose() {} };
  return new Cue(env, target);
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
  /** Its part in the music, when roles are known (a drop gets a glow on the strip, a fill a rising mark). */
  role?: TargetRole;
}

/**
 * The beat strip's contents at song time `t`: every target whose target beat is within `ahead`
 * beats in front (or `behind` beats past) of now, in time order. Pure. Relies on chart.targets
 * being sorted by targetTime (T6), so it only looks at the targets near now.
 */
export function stripEntries(
  chart: Chart,
  beats: readonly number[],
  t: number,
  ahead = 4,
  behind = 0.5,
  roles?: readonly TargetRole[],
): StripEntry[] {
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
    out.push({
      index,
      kind: target.kind,
      shape: target.kind === 'flick' ? target.shape : undefined,
      time: target.targetTime,
      beatsAway,
      role: roles?.[index],
    });
  }
  return out;
}

/** What the HUD shows every frame. */
export interface HudState {
  /** Song time. */
  t: number;
  /** Continuous beat position (beatPosition of the song's beats at `t`), for the pulse; omitted when unknown. */
  beat?: number;
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

/** The HUD hooks the drill calls: the combo counter, the judgement word and the beat strip. */
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

const WORD: Record<Judgement, string> = { perfect: 'PERFECT', early: 'EARLY', late: 'LATE', miss: 'MISS' };

/** Signed offset as the player reads it: "+32" late, "−32" early. */
function signedMs(ms: number): string {
  const v = Math.round(ms);
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
}

const ICON: Record<string, string> = {
  circle: '<circle cx="12" cy="12" r="8"/>',
  diamond: '<polygon points="12,2.5 21.5,12 12,21.5 2.5,12"/>',
  triangle: '<polygon points="12,3.5 21.5,20 2.5,20"/>',
  burst: '<circle cx="5.5" cy="14" r="3.2"/><circle cx="12" cy="9" r="3.2"/><circle cx="18.5" cy="14" r="3.2"/>',
  strafer: '<path d="M2 12 8 6v4h8V6l6 6-6 6v-4H8v4z"/>',
  hold: '<rect x="2" y="9" width="20" height="6" rx="3"/><circle cx="4.5" cy="12" r="3"/>',
  peeker: '<rect x="3" y="3" width="5" height="18" rx="1"/><circle cx="16" cy="12" r="5.5"/>',
  decoy: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M7 7l10 10" stroke="currentColor" stroke-width="2.4" fill="none"/>',
};

function iconKey(e: StripEntry): string {
  return e.kind === 'flick' ? (e.shape ?? 'circle') : e.kind;
}

function iconHex(e: StripEntry): string {
  return e.kind === 'flick' ? KIND_HEX[e.shape ?? 'circle'] : KIND_HEX[e.kind];
}

/** Restart a CSS animation that is driven by a class. */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Perfects in a row before the streak glows, and between streak pops. */
const STREAK_GLOW = 4;
const STREAK_POP = 5;
/** A combo this long breaks with a flourish. */
const BREAK_MIN = 4;
/** Beat ticks drawn on the strip. */
const TICKS = 6;

class Hud implements OverdriveHud, CueLayer {
  readonly fx: FxLevel = fxOf();
  private readonly root: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly word: HTMLElement;
  private readonly wordText: HTMLElement;
  private readonly wordMs: HTMLElement;
  private readonly comboBox: HTMLElement;
  private readonly comboNum: HTMLElement;
  private readonly comboMult: HTMLElement;
  private readonly comboBar: HTMLElement;
  private readonly comboTag: HTMLElement;
  private readonly milestone: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly ticks: HTMLElement[] = [];
  private readonly icons = new Map<number, { el: HTMLElement; state: string }>();
  private readonly bursts: Burst[] = [];
  private readonly scene;
  private readonly camera;
  private combo = 0;
  private multiplier = 1;
  private streak = 0;
  private rail = -Infinity;
  private lastT = 0;
  private lastBeat = '';

  constructor(private readonly g: Game) {
    this.scene = g.engine.scene;
    this.camera = g.engine.camera;
    this.root = document.createElement('div');
    this.root.className = 'od-hud';
    this.root.dataset.fx = this.fx;
    this.root.innerHTML = `
      <div class="od-pulse"></div>
      <div class="od-flash"></div>
      <div class="od-judge"><span class="od-word"></span><span class="od-ms"></span></div>
      <div class="od-combo">
        <div class="od-combo-top"><span class="od-num">0</span><span class="od-mult">×1</span></div>
        <div class="od-combo-label">COMBO</div>
        <div class="od-bar"><i></i></div>
        <div class="od-tag"></div>
        <div class="od-milestone"></div>
      </div>
      <div class="od-strip"><div class="od-track"></div><div class="od-line"></div></div>
    `;
    g.hud.root.appendChild(this.root);
    g.hud.root.classList.add('od-on');
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.flash = q('.od-flash');
    this.word = q('.od-judge');
    this.wordText = q('.od-word');
    this.wordMs = q('.od-ms');
    this.comboBox = q('.od-combo');
    this.comboNum = q('.od-num');
    this.comboMult = q('.od-mult');
    this.comboBar = q('.od-bar i');
    this.comboTag = q('.od-tag');
    this.milestone = q('.od-milestone');
    this.strip = q('.od-strip');
    const track = q('.od-track');
    for (let i = 0; i < TICKS; i++) {
      const tick = document.createElement('i');
      tick.className = 'od-tick';
      track.appendChild(tick);
      this.ticks.push(tick);
    }
    layer = this;
  }

  // ---- CueLayer

  burst(at: Vector3, r0: number, r1: number, t0: number, dur: number, hex: string, opacity = 0.8, opts: { disc?: boolean; floor?: boolean; thin?: boolean } = {}): void {
    if (this.fx === 'off') {
      // Keep only the ring that says "you hit it".
      if (opts.disc || opts.floor || opacity < 0.5) return;
    }
    if (this.fx === 'lite' && (opts.floor || t0 > this.lastT + 0.05)) return;
    if (this.bursts.length >= MAX_BURSTS) this.remove(this.bursts[0]);
    const mat = ringMaterial(hex);
    const mesh = new Mesh(opts.disc ? discGeo : opts.thin ? thinRingGeo : ringGeo, mat);
    mesh.renderOrder = 21;
    mesh.visible = false;
    mesh.position.copy(at);
    if (opts.floor) mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.bursts.push({ mesh: mesh as Burst['mesh'], t0, dur, r0, r1, opacity, floor: !!opts.floor, disc: !!opts.disc });
  }

  mark(index: number, judgement: Judgement | 'friendly' | 'spared'): void {
    const icon = this.icons.get(index);
    if (!icon) return;
    icon.state = judgement === 'perfect' ? 'hit-perfect' : judgement === 'early' || judgement === 'late' ? 'hit' : judgement === 'spared' ? 'spared' : 'miss';
    icon.el.classList.add(icon.state);
  }

  dropFlash(): void {
    if (this.fx === 'off') return;
    replay(this.flash, 'on');
  }

  private remove(b: Burst): void {
    this.scene.remove(b.mesh);
    b.mesh.material.dispose();
    const i = this.bursts.indexOf(b);
    if (i >= 0) this.bursts.splice(i, 1);
  }

  // ---- OverdriveHud

  frame(s: HudState): void {
    this.lastT = s.t;
    this.updateBursts(s.t);
    this.updateCombo(s);
    this.updateStrip(s);

    // The stat rail keeps the score and your timing; the combo has its own counter.
    if (s.t >= this.rail) {
      this.rail = s.t + 0.1;
      const off = Math.round(s.meanOffsetMs);
      this.g.hud.setStats([
        { k: 'SCORE', v: String(Math.round(s.score)) },
        { k: 'TIMING', v: off ? `${off > 0 ? '+' : '−'}${Math.abs(off)} ms` : '0 ms' },
      ]);
    }
  }

  judgement(j: Judgement, offsetMs: number): void {
    this.word.dataset.j = j;
    this.wordText.textContent = WORD[j];
    this.wordMs.textContent = j === 'miss' ? '' : signedMs(offsetMs);
    replay(this.word, 'on');
    this.streak = j === 'perfect' ? this.streak + 1 : 0;
    this.showStreak(j === 'perfect');
  }

  friendly(): void {
    this.word.dataset.j = 'friendly';
    this.wordText.textContent = 'FRIENDLY';
    this.wordMs.textContent = '';
    replay(this.word, 'on');
    this.streak = 0;
    this.showStreak(false);
  }

  dispose(): void {
    if (layer === this) layer = null;
    for (const b of [...this.bursts]) this.remove(b);
    this.root.remove();
    this.g.hud.root.classList.remove('od-on');
    this.g.hud.setStats([]);
  }

  // ---- parts

  private updateBursts(t: number): void {
    const cam = this.camera.quaternion;
    for (const b of [...this.bursts]) {
      const u = (t - b.t0) / b.dur;
      if (u >= 1) {
        this.remove(b);
        continue;
      }
      b.mesh.visible = u >= 0;
      if (u < 0) continue;
      const e = 1 - (1 - u) ** 3;
      b.mesh.scale.setScalar(b.r0 + (b.r1 - b.r0) * e);
      b.mesh.material.opacity = b.opacity * (b.disc ? (1 - u) ** 2 : (1 - u) ** 1.4);
      if (!b.floor) b.mesh.quaternion.copy(cam);
    }
  }

  private updateCombo(s: HudState): void {
    const prev = this.combo;
    if (s.combo !== prev) {
      this.comboNum.textContent = String(s.combo);
      if (s.combo > prev) replay(this.comboNum, 'bump');
      else if (prev >= BREAK_MIN && s.combo === 0) {
        // The break: the number drops and shakes, the box flashes red, and what you had is named.
        this.comboTag.textContent = `${prev} LOST`;
        replay(this.comboTag, 'on');
        replay(this.comboBox, 'broke');
      }
      this.combo = s.combo;
    }
    if (s.multiplier !== this.multiplier) {
      if (s.multiplier > this.multiplier) {
        // A milestone (×2, ×3, ×4): the multiplier pops big, a ring flares from the box and the edges kick.
        this.milestone.textContent = `×${s.multiplier}`;
        replay(this.milestone, 'on');
        replay(this.comboMult, 'pop');
        if (this.fx !== 'off') replay(this.flash, 'on');
      }
      this.multiplier = s.multiplier;
      this.comboMult.textContent = `×${s.multiplier}`;
      this.comboBox.dataset.m = String(s.multiplier);
    }
    this.comboBar.style.transform = `scaleX(${multiplierProgress(s.combo, s.multiplier).toFixed(3)})`;
    this.comboBox.classList.toggle('idle', s.combo === 0);

    // The beat: the screen's edges breathe with it and the hit line brightens, scaled by the FX level.
    const b = s.beat === undefined || this.fx === 'off' ? 0 : flashAt(s.beat);
    const key = b.toFixed(2);
    if (key !== this.lastBeat) {
      this.lastBeat = key;
      this.root.style.setProperty('--b', key);
    }
  }

  private showStreak(on: boolean): void {
    const glow = this.streak >= STREAK_GLOW;
    this.comboBox.classList.toggle('streak', glow);
    if (on && glow) {
      this.comboTag.textContent = `PERFECT ×${this.streak}`;
      this.comboTag.classList.add('on', 'gold');
      if (this.streak % STREAK_POP === 0) replay(this.comboTag, 'pop');
    } else if (!on) {
      this.comboTag.classList.remove('gold');
    }
  }

  private updateStrip(s: HudState): void {
    this.strip.classList.toggle('off', !store.settings.beatStrip);
    if (!store.settings.beatStrip) return;
    const w = this.strip.clientWidth || 600;
    const seen = new Set<number>();
    for (const e of s.strip) {
      seen.add(e.index);
      let icon = this.icons.get(e.index);
      if (!icon) {
        const el = document.createElement('div');
        el.className = `od-ic ${e.role ?? 'pattern'}`;
        el.style.color = iconHex(e);
        el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICON[iconKey(e)]}</svg>`;
        this.strip.querySelector('.od-track')!.appendChild(el);
        icon = { el, state: '' };
        this.icons.set(e.index, icon);
      }
      const x = stripX(e.beatsAway);
      // Fade in at the far end, out just past the hit line.
      const fade = Math.min(1, (4.4 - e.beatsAway) / 0.8, 1 + e.beatsAway / 0.5);
      icon.el.style.transform = `translate(${(x * w).toFixed(1)}px, -50%)`;
      icon.el.style.opacity = Math.max(0, fade).toFixed(2);
    }
    for (const [index, icon] of this.icons) {
      if (seen.has(index)) continue;
      icon.el.remove();
      this.icons.delete(index);
    }
    // Beat ticks scroll the same way, so the spacing between icons reads as rhythm.
    const p = s.beat ?? 0;
    const first = Math.floor(p);
    this.ticks.forEach((tick, i) => {
      const away = first + i - p;
      const x = stripX(away);
      tick.style.transform = `translateX(${(x * w).toFixed(1)}px)`;
      tick.style.opacity = away < -0.4 || away > 4 ? '0' : ((1 - Math.max(0, away) / 4.4) * 0.5).toFixed(2);
    });
  }
}

/** The HUD: combo, multiplier, judgement word and beat strip (T16). */
export function createHud(g: Game): OverdriveHud {
  if (typeof document === 'undefined') return { frame() {}, judgement() {}, friendly() {}, dispose() {} };
  return new Hud(g);
}
