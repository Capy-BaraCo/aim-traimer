/**
 * The rules of one Overdrive run (T13; D4, D12, D13): when each Target launches and vanishes, what a
 * shot counts as, and the Judgement and score behind it (via scoring.ts). Pure: song times come in
 * as numbers, so vitest runs it in node; the drill (src/drills/overdrive.ts) feeds it the clock and
 * the shots and draws what it says.
 *
 * Everything is in song time (glossary), never frame time (R1).
 *  - A target launches at launchTime (its fly-in starts) and is open from landTime to windowEnd.
 *  - A target nobody resolved is closed at windowEnd: a Miss for taps and burst orbs, the tracking
 *    result for strafers and holds, nothing for a decoy left alone.
 *  - Firing (D13): a click (press) can hit anything; the held stream only damages strafers and holds.
 */
import { judge, judgeOrb, ScoreTally, type Judgement, type ScoreResult } from './scoring';
import type { Chart, ChartTarget, TargetKind } from './types';

/** How a Target type takes shots (D13). */
export type TargetRule = 'tap' | 'burst' | 'track' | 'decoy';

export function ruleOf(kind: TargetKind): TargetRule {
  switch (kind) {
    case 'flick':
    case 'peeker':
      return 'tap';
    case 'burst':
      return 'burst';
    case 'strafer':
    case 'hold':
      return 'track';
    case 'decoy':
      return 'decoy';
  }
}

/** D13: a click hits any target; the held stream only damages strafers and holds. */
export function takesShot(kind: TargetKind, press: boolean): boolean {
  return press || ruleOf(kind) === 'track';
}

/** Below this share of their life tracked, strafers and holds count as a Miss for the combo (T7). */
export const TRACK_HIT = 0.3;

/**
 * What happened to a target. `index` is its place in chart.targets; `part` is the burst orb (0 for
 * every other kind). Taps and orbs are judged at the click instant, or as a Miss when the window ends.
 */
export type RunEvent =
  | { type: 'judged'; index: number; part: number; judgement: Judgement; offsetMs: number }
  /** A strafer or hold is over: the share of its life you tracked, and whether that counts as a hit. */
  | { type: 'tracked'; index: number; fraction: number; hit: boolean; killed: boolean }
  /** You shot a decoy. */
  | { type: 'friendly'; index: number }
  /** A decoy's window ended and you left it alone. */
  | { type: 'spared'; index: number };

interface State {
  launched: boolean;
  resolved: boolean;
  /** Burst: which orbs are judged. */
  orbs: boolean[];
  /** Strafer and hold: seconds of their life spent on target while firing. */
  tracked: number;
  /** Song time and contact of the last track() sample (NaN before the first). */
  lastT: number;
  lastOn: boolean;
}

/** One run through a Chart at a Level. Feed it song time every frame and every shot as it happens. */
export class ChartRun {
  readonly tally: ScoreTally;
  private readonly states: State[];
  /** Target indices by launchTime (holds and triangles launch earlier than their neighbours). */
  private readonly launchOrder: number[];
  /** Target indices by windowEnd. */
  private readonly endOrder: number[];
  private nextLaunch = 0;
  private nextEnd = 0;

  constructor(
    readonly chart: Chart,
    readonly level: number,
  ) {
    this.tally = new ScoreTally(chart);
    const n = chart.targets.length;
    this.states = chart.targets.map((t) => ({
      launched: false,
      resolved: false,
      orbs: t.kind === 'burst' ? t.orbs.map(() => false) : [],
      tracked: 0,
      lastT: NaN,
      lastOn: false,
    }));
    const order = Array.from({ length: n }, (_, i) => i);
    this.launchOrder = [...order].sort((a, b) => chart.targets[a].launchTime - chart.targets[b].launchTime || a - b);
    this.endOrder = [...order].sort((a, b) => chart.targets[a].windowEnd - chart.targets[b].windowEnd || a - b);
  }

  target(index: number): ChartTarget {
    return this.chart.targets[index];
  }

  /** Launched and not yet resolved: on screen. */
  isLive(index: number): boolean {
    const s = this.states[index];
    return !!s && s.launched && !s.resolved;
  }

  isResolved(index: number): boolean {
    return this.states[index]?.resolved ?? true;
  }

  get combo(): number {
    return this.tally.combo;
  }

  get multiplier(): number {
    return this.tally.multiplier;
  }

  /** Targets whose launchTime has come by song time `t`, in launch order. Each index is returned once. */
  launch(t: number): number[] {
    const out: number[] = [];
    while (this.nextLaunch < this.launchOrder.length) {
      const i = this.launchOrder[this.nextLaunch];
      if (this.chart.targets[i].launchTime > t) break;
      this.states[i].launched = true;
      out.push(i);
      this.nextLaunch++;
    }
    return out;
  }

  /**
   * Close every target whose window has ended by song time `t` (windowEnd <= t). Anything not yet
   * launched by then is launched first, so a stalled frame can't lose a target.
   */
  expire(t: number): RunEvent[] {
    const events: RunEvent[] = [];
    while (this.nextEnd < this.endOrder.length) {
      const i = this.endOrder[this.nextEnd];
      if (this.chart.targets[i].windowEnd > t) break;
      this.nextEnd++;
      this.close(i, events);
    }
    return events;
  }

  /** The song is over: close everything still open (the chart ends at the song's end, D12). */
  finish(): RunEvent[] {
    const events: RunEvent[] = [];
    for (; this.nextEnd < this.endOrder.length; this.nextEnd++) this.close(this.endOrder[this.nextEnd], events);
    return events;
  }

  /** The window that a shot on `part` of target `index` must fall in, in song time ([start, end], inclusive). */
  window(index: number, part = 0): { start: number; end: number } {
    const t = this.chart.targets[index];
    if (t.kind === 'burst') return { start: part === 0 ? t.landTime : t.orbs[part - 1]?.time ?? t.landTime, end: t.windowEnd };
    return { start: t.landTime, end: t.windowEnd };
  }

  /** Whether a shot at song time `t` on `part` of target `index` counts (the drill gates damage with it). */
  accepts(index: number, part: number, press: boolean, t: number): boolean {
    if (!this.isLive(index)) return false;
    const target = this.chart.targets[index];
    if (!takesShot(target.kind, press)) return false;
    if (target.kind === 'burst' && (this.states[index].orbs[part] ?? true)) return false;
    const w = this.window(index, part);
    return t >= w.start && t <= w.end;
  }

  /**
   * A shot struck `part` of target `index` at song time `t` (read at the click instant). Returns what
   * it did: a Judgement for a tap or orb, `friendly` for a decoy, nothing for a stream shot on a tap
   * target, a shot outside the window or a hit on a strafer or hold (they are scored by track()).
   */
  shot(index: number, part: number, press: boolean, t: number): RunEvent[] {
    if (!this.accepts(index, part, press, t)) return [];
    const target = this.chart.targets[index];
    const s = this.states[index];
    switch (target.kind) {
      case 'flick':
      case 'peeker': {
        const r = judge(t, target, this.level);
        this.tally.tap(target, r);
        s.resolved = true;
        return [{ type: 'judged', index, part: 0, ...r }];
      }
      case 'burst': {
        const r = judgeOrb(t, target, part, this.level);
        this.tally.orb(target, part, r);
        s.orbs[part] = true;
        if (s.orbs.every(Boolean)) s.resolved = true;
        return [{ type: 'judged', index, part, ...r }];
      }
      case 'decoy':
        this.tally.decoyHit(target);
        s.resolved = true;
        return [{ type: 'friendly', index }];
      case 'strafer':
      case 'hold':
        return [];
    }
  }

  /**
   * Sample a strafer or hold once a frame: `on` is true while the crosshair is on it and the trigger
   * is held. The time since the last sample counts when `on`, clipped to the part of its life that
   * is scored (see life()).
   */
  track(index: number, on: boolean, t: number): void {
    const s = this.states[index];
    if (!this.isLive(index) || ruleOf(this.chart.targets[index].kind) !== 'track') return;
    if (on && Number.isFinite(s.lastT)) s.tracked += this.overlap(index, s.lastT, t);
    s.lastT = t;
    s.lastOn = on;
  }

  /** A strafer's health ran out at song time `t`: its life ends there, scored on what came before. */
  kill(index: number, t: number): RunEvent[] {
    const target = this.chart.targets[index];
    if (!this.isLive(index) || target.kind !== 'strafer') return [];
    const s = this.states[index];
    // The killing shot hit it, so the moment since the last frame counts.
    if (Number.isFinite(s.lastT)) s.tracked += this.overlap(index, s.lastT, t);
    const events: RunEvent[] = [];
    this.resolveTracking(index, Math.min(t, target.windowEnd), true, events);
    return events;
  }

  /**
   * The scored part of a strafer's or hold's life: a strafer from landing to windowEnd; a hold from
   * its target beat (when it sets off) to windowEnd, like a sustained note.
   */
  life(index: number): { start: number; end: number } {
    const t = this.chart.targets[index];
    return { start: t.kind === 'hold' ? t.targetTime : t.landTime, end: t.windowEnd };
  }

  /** Share of a strafer's or hold's scored life tracked so far (0..1). */
  trackedFraction(index: number, until?: number): number {
    const { start, end } = this.life(index);
    const span = Math.max(1e-3, Math.min(end, until ?? end) - start);
    return Math.max(0, Math.min(1, this.states[index].tracked / span));
  }

  result(): ScoreResult {
    return this.tally.result();
  }

  private overlap(index: number, from: number, to: number): number {
    const { start, end } = this.life(index);
    return Math.max(0, Math.min(to, end) - Math.max(from, start));
  }

  private close(i: number, events: RunEvent[]): void {
    const s = this.states[i];
    s.launched = true;
    if (s.resolved) return;
    const target = this.chart.targets[i];
    switch (target.kind) {
      case 'flick':
      case 'peeker':
        this.tally.miss(target);
        events.push({ type: 'judged', index: i, part: 0, judgement: 'miss', offsetMs: 0 });
        break;
      case 'burst':
        s.orbs.forEach((done, k) => {
          if (done) return;
          this.tally.miss(target, k);
          events.push({ type: 'judged', index: i, part: k, judgement: 'miss', offsetMs: 0 });
        });
        break;
      case 'strafer':
      case 'hold':
        this.resolveTracking(i, target.windowEnd, false, events);
        return;
      case 'decoy':
        events.push({ type: 'spared', index: i });
        break;
    }
    s.resolved = true;
  }

  private resolveTracking(i: number, until: number, killed: boolean, events: RunEvent[]): void {
    const target = this.chart.targets[i];
    if (target.kind !== 'strafer' && target.kind !== 'hold') return;
    const fraction = this.trackedFraction(i, until);
    this.tally.tracking(target, fraction);
    this.states[i].resolved = true;
    events.push({ type: 'tracked', index: i, fraction, hit: fraction >= TRACK_HIT, killed });
  }
}
