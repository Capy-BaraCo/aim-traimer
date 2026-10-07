/**
 * Overdrive (T13; D4, D12, D13, R1): the rhythm drill. Targets launch, land and vanish on the beat of
 * the player's own song, in the synthwave scene, for the whole song.
 *
 * Everything is timed from song time, audio.songTime(), never from frame time: update() reads it
 * every frame to launch targets, move them and close their windows, and shots read it at the click
 * instant (onShot runs synchronously in the mousedown handler). The Game still ends runs on its frame
 * clock, so `duration` is the song plus a margin and `done` is set once song time passes the end.
 *
 * Who does what:
 *  - src/rhythm/run.ts (pure): launches, windows, what a shot counts as, Judgements, the score.
 *  - overdrive-targets.ts and the kind files: each target's look and movement (T14, T15).
 *  - overdrive-cues.ts: beat cues and the HUD hooks (T16).
 *  - this file: the glue: the clock, the Game's shots and figures, flick analytics and the report.
 */
import { Vector3 } from 'three';
import type { FlickRecord } from '../core/analytics';
import { WEAPONS, type Game, type ShotResult } from '../core/game';
import { store } from '../core/store';
import { levelParams } from '../rhythm/levels';
import { presetById } from '../rhythm/presets';
import { ChartRun, ruleOf, type RunEvent } from '../rhythm/run';
import type { ScoreResult } from '../rhythm/scoring';
import type { Chart, Difficulty, FlickShape, TargetKind } from '../rhythm/types';
import type { Figure } from '../world/figure';
import { FlickRecorder } from './common';
import { Drill, pct, type DrillReport, type ReportStat } from './drill';
import { createCue, createHud, stripEntries, type OverdriveHud, type StripEntry, type TargetCue } from './overdrive-cues';
import { createTarget, type OverdriveTarget, type TargetEnv, type TargetEvent } from './overdrive-targets';

/** What Overdrive needs to start (DrillDef.make's third argument). */
export interface OverdriveContext {
  /** The chart to play, built for the level being played (chart.level). */
  chart: Chart;
  /** The decoded song. */
  buffer: AudioBuffer;
  /** The song's beat times in seconds (Analysis.beats): the grid scrolls, strafers turn and holds glide on them. */
  beats: number[];
  /** The song's name, for the HUD. */
  songName?: string;
}

/** Overdrive's DrillReport.data, for the debrief, coach and Logbook (T18). */
export interface OverdriveReportData {
  songId: string;
  songName?: string;
  difficulty: Difficulty;
  level: number;
  /** Mean signed timing offset of the hits, ms (negative is early). */
  meanOffsetMs: number;
  /** Every hit's signed offset, ms (for the early-to-late histogram). */
  offsets: number[];
  /** 0..1 per target type that appeared; decoys are left out (T7). */
  hitRate: Partial<Record<TargetKind, number>>;
  hitRateByShape: Partial<Record<FlickShape, number>>;
  counts: ScoreResult['counts'];
  maxCombo: number;
  decoysHit: number;
}

/** DrillDef.make for Overdrive: the chart and song come in `ctx` (T18 registers it). */
export function makeOverdrive(g: Game, level: number, ctx?: OverdriveContext): OverdriveDrill {
  if (!ctx) throw new Error('Overdrive needs a song. Pick one in the song library first.');
  if (import.meta.env.DEV && ctx.chart.level !== level) console.warn(`[overdrive] Chart built for level ${ctx.chart.level}, asked for ${level}: playing the chart's level.`);
  return new OverdriveDrill(g, ctx);
}

/** Dev builds: one line per thing that happened, in song time (`at` is the chart time it was due). */
export interface TraceEntry {
  t: number;
  what: 'launch' | 'judged' | 'tracked' | 'friendly' | 'spared' | 'ignored' | 'vanish';
  index: number;
  kind: TargetKind;
  at?: number;
  detail?: string;
}

interface Live {
  view: OverdriveTarget;
  cue: TargetCue;
  /** Flicks: the aim from landing to the hit (or the end of the window), for analytics.flicks. */
  rec: FlickRecorder | null;
  /** Strafers and holds: crosshair on it while firing, last frame. */
  contact: boolean;
}

const DIFFICULTY_NAME: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const KIND_NAME: Record<TargetKind, string> = {
  flick: 'Flicks',
  burst: 'Burst orbs',
  strafer: 'Strafers',
  hold: 'Holds',
  peeker: 'Peekers',
  decoy: 'Decoys',
};
const KIND_ORDER: TargetKind[] = ['flick', 'burst', 'peeker', 'strafer', 'hold'];

/** A steady 120 BPM grid, for a song with no beats (shouldn't happen: analysis always tracks some). */
const steadyBeats = (duration: number): number[] => Array.from({ length: Math.ceil(duration * 2) + 2 }, (_, i) => i / 2);

const signedMs = (x: number): string => {
  const v = Math.round(x);
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
};

export class OverdriveDrill extends Drill {
  readonly id = 'overdrive';
  readonly title = 'Overdrive';
  override kicker = 'RHYTHM';
  /** Click for taps, hold for strafers and holds (D13): Pulse streams while the button is held. */
  override weapon = WEAPONS.pulse;
  override movable = false;
  override clickAlwaysFires = true;
  readonly chart: Chart;
  readonly run: ChartRun;
  /** Dev builds only (empty otherwise). */
  readonly trace: TraceEntry[] = [];
  private readonly env: TargetEnv;
  private readonly beats: number[];
  private readonly live = new Map<number, Live>();
  private readonly flicks: FlickRecord[] = [];
  private hud: OverdriveHud | null = null;
  /** Song time and figure of the shot being fired (damageEnabled runs just before onShot). */
  private shot: { t: number; figure: Figure } | null = null;
  private stats = { score: 0, meanOffsetMs: 0 };
  private statsT = 0;
  private readonly _aim = new Vector3();

  constructor(
    g: Game,
    private readonly ctx: OverdriveContext,
  ) {
    super(g);
    this.chart = ctx.chart;
    this.level = ctx.chart.level;
    this.duration = ctx.chart.duration + 2;
    this.run = new ChartRun(ctx.chart, this.level);
    this.beats = ctx.beats.length >= 2 ? ctx.beats : steadyBeats(ctx.chart.duration);
    this.env = { g, chart: ctx.chart, params: levelParams(this.level, presetById(ctx.chart.preset)), beats: this.beats };
    if (ctx.songName) this.kicker = `RHYTHM · ${ctx.songName.toUpperCase()}`;
  }

  /** The synthwave scene goes up before the countdown, so the count happens in the world you'll play in. */
  setup(): void {
    this.g.enterSynthwave({ songTime: () => this.g.audio.songTime(), beats: this.beats, walls: this.chart.walls });
    this.hud = createHud(this.g);
  }

  override begin(): void {
    if (!this.g.audio.playMusic(this.ctx.buffer, 0)) console.warn('[overdrive] Audio is not unlocked yet: the song cannot start.');
  }

  override update(dt: number): void {
    const t = this.g.audio.songTime();
    for (const i of this.run.launch(t)) this.spawn(i, t);
    this.apply(this.run.expire(t), t);

    const firing = this.g.input.fireHeld;
    let crosshair: Figure | null | undefined;
    for (const [i, l] of this.live) {
      l.view.update(t);
      l.cue.update(t);
      const target = this.chart.targets[i];
      if (l.rec) {
        if (!l.rec.active && t >= target.landTime) this.beginFlick(l);
        l.rec.sample(this.g);
      }
      if (ruleOf(target.kind) === 'track') {
        crosshair ??= firing ? this.g.crosshairTarget().figure : null;
        const on = !!crosshair && l.view.partHit(crosshair) >= 0;
        this.run.track(i, on, t);
        if (on !== l.contact) {
          l.contact = on;
          this.tell(l, { type: 'contact', on });
        }
      }
    }

    if ((this.statsT -= dt) <= 0) {
      this.statsT = 0.1;
      const r = this.run.result();
      this.stats = { score: r.score, meanOffsetMs: r.meanOffsetMs };
    }
    this.hud?.frame({
      t,
      combo: this.run.combo,
      multiplier: this.run.multiplier,
      score: this.stats.score,
      meanOffsetMs: this.stats.meanOffsetMs,
      strip: store.settings.beatStrip ? this.strip(t) : [],
    });

    if (t >= this.chart.duration) {
      this.apply(this.run.finish(), t);
      this.done = true;
    }
  }

  /** Damage only lands where the run accepts the shot: taps take clicks inside their window, the stream only hurts strafers and holds. */
  override damageEnabled(figure?: Figure, press = true): boolean {
    if (!figure) return true;
    const t = this.g.audio.songTime();
    this.shot = { t, figure };
    const hit = this.find(figure);
    if (!hit) return false;
    // A decoy is never killed: shooting one only breaks your combo (onShot).
    if (this.chart.targets[hit.index].kind === 'decoy') return false;
    return this.run.accepts(hit.index, hit.part, press, t);
  }

  override onShot(s: ShotResult): void {
    // The click instant: the song time read as this shot was fired (same handler, same moment).
    const t = this.shot && this.shot.figure === s.figure ? this.shot.t : this.g.audio.songTime();
    this.shot = null;
    const hit = this.find(s.figure);
    if (s.press) this.recordClick(hit, t);
    if (!hit) return;
    const events = this.run.shot(hit.index, hit.part, s.press, t);
    const kind = this.chart.targets[hit.index].kind;
    if (import.meta.env.DEV && !events.length && ruleOf(kind) !== 'track') {
      this.log({ t, what: 'ignored', index: hit.index, kind, detail: s.press ? 'click outside the window' : 'stream shot' });
    }
    this.apply(events, t);
  }

  override onKill(f: Figure): void {
    const hit = this.find(f);
    if (hit && this.chart.targets[hit.index].kind === 'strafer') {
      const t = this.g.audio.songTime();
      this.apply(this.run.kill(hit.index, t), t);
    }
  }

  report(): DrillReport {
    const r = this.run.result();
    const data: OverdriveReportData = {
      songId: this.chart.songId,
      songName: this.ctx.songName,
      difficulty: this.chart.difficulty,
      level: this.level,
      meanOffsetMs: r.meanOffsetMs,
      offsets: r.offsets,
      hitRate: r.hitRate,
      hitRateByShape: r.hitRateByShape,
      counts: r.counts,
      maxCombo: r.maxCombo,
      decoysHit: r.decoysHit,
    };
    const stats: ReportStat[] = [
      { label: 'Difficulty', value: DIFFICULTY_NAME[this.chart.difficulty] },
      { label: 'Level', value: String(this.level) },
      { label: 'Timing', value: r.offsets.length ? signedMs(r.meanOffsetMs) : '—', unit: 'ms', hint: 'Your average hit against the beat: − is early, + is late' },
      { label: 'Perfect', value: String(r.counts.perfect) },
      { label: 'Early / late', value: `${r.counts.early} / ${r.counts.late}` },
      { label: 'Missed', value: String(r.counts.miss) },
      { label: 'Best combo', value: String(r.maxCombo) },
      ...KIND_ORDER.filter((k) => r.hitRate[k] !== undefined).map((k) => ({ label: `${KIND_NAME[k]} hit`, value: pct(r.hitRate[k] ?? 0), unit: '%' })),
    ];
    if (r.decoysHit) stats.push({ label: 'Friendlies shot', value: String(r.decoysHit) });
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: Math.round(r.score),
      stats,
      notes: this.notes(r),
      analytics: this.flicks.length ? { flicks: this.flicks, flickContext: 'mixed' } : undefined,
      data,
    };
  }

  override teardown(): void {
    for (const l of this.live.values()) {
      l.view.dispose();
      l.cue.dispose();
    }
    this.live.clear();
    this.hud?.dispose();
    this.hud = null;
    this.g.exitSynthwave();
    super.teardown();
  }

  /** The figure of a live target's part (index into chart.targets), or null. For dev tools and tests. */
  figureOf(index: number, part = 0): Figure | null {
    return this.live.get(index)?.view.parts[part]?.figure ?? null;
  }

  // ------------------------------------------------------------------------------------------ internals

  private spawn(index: number, t: number): void {
    const target = this.chart.targets[index];
    const view = createTarget(this.env, target);
    view.spawn(t);
    this.live.set(index, { view, cue: createCue(this.env, view), rec: target.kind === 'flick' ? new FlickRecorder() : null, contact: false });
    if (import.meta.env.DEV) this.log({ t, what: 'launch', index, kind: target.kind, at: target.launchTime });
  }

  /** Hand the run's events to the targets, their cues and the HUD; retire whatever is finished. */
  private apply(events: RunEvent[], t: number): void {
    for (const e of events) {
      const l = this.live.get(e.index);
      const kind = this.chart.targets[e.index].kind;
      switch (e.type) {
        case 'judged':
          this.hud?.judgement(e.judgement, e.offsetMs);
          if (l?.rec) this.finishFlick(l, e.judgement !== 'miss');
          if (l) this.tell(l, { type: 'judged', part: e.part, judgement: e.judgement, offsetMs: e.offsetMs });
          if (import.meta.env.DEV) this.log({ t, what: 'judged', index: e.index, kind, at: this.chart.targets[e.index].targetTime, detail: `${e.judgement} ${signedMs(e.offsetMs)} ms (part ${e.part})` });
          break;
        case 'tracked':
          if (!e.hit) this.hud?.judgement('miss', 0);
          if (l) this.tell(l, { type: 'tracked', fraction: e.fraction, hit: e.hit, killed: e.killed });
          if (import.meta.env.DEV) this.log({ t, what: 'tracked', index: e.index, kind, detail: `${Math.round(e.fraction * 100)}%${e.killed ? ' killed' : ''}` });
          break;
        case 'friendly':
          this.hud?.friendly();
          if (l) this.tell(l, { type: 'friendly' });
          if (import.meta.env.DEV) this.log({ t, what: 'friendly', index: e.index, kind });
          break;
        case 'spared':
          if (l) this.tell(l, { type: 'spared' });
          if (import.meta.env.DEV) this.log({ t, what: 'spared', index: e.index, kind });
          break;
      }
      if (this.run.isResolved(e.index)) this.retire(e.index, t);
    }
  }

  private tell(l: Live, e: TargetEvent): void {
    l.view.react(e);
    l.cue.react(e);
  }

  private retire(index: number, t: number): void {
    const l = this.live.get(index);
    if (!l) return;
    if (l.rec?.active) this.finishFlick(l, false);
    l.view.dispose();
    l.cue.dispose();
    this.live.delete(index);
    const target = this.chart.targets[index];
    if (import.meta.env.DEV && t >= target.windowEnd) this.log({ t, what: 'vanish', index, kind: target.kind, at: target.windowEnd });
  }

  /** The live target and part a figure belongs to. */
  private find(figure: Figure | null): { index: number; part: number; live: Live } | null {
    if (!figure) return null;
    for (const [index, live] of this.live) {
      const part = live.view.partHit(figure);
      if (part >= 0) return { index, part, live };
    }
    return null;
  }

  private beginFlick(l: Live): void {
    const f = l.view.parts[0]?.figure;
    if (l.rec && f) l.rec.begin(this.g, f);
  }

  private finishFlick(l: Live, hit: boolean): void {
    if (!l.rec?.active) return;
    this.flicks.push(l.rec.finish(this.g, hit));
  }

  /**
   * A click goes into one flick's record: the flick it hit, or else the landed flick nearest the
   * crosshair (the one you were going for), so overlapping flicks don't count each other's clicks.
   */
  private recordClick(hit: { index: number; live: Live } | null, t: number): void {
    let into: Live | null = null;
    let struck = false;
    if (hit?.live.rec) {
      into = hit.live;
      struck = this.run.accepts(hit.index, 0, true, t);
    } else {
      const aim = this.g.aimDir(this._aim);
      let best = -Infinity;
      for (const [i, l] of this.live) {
        const f = l.view.parts[0]?.figure;
        if (!l.rec || !f || t < this.chart.targets[i].landTime) continue;
        const dot = f.position.clone().sub(this.g.eye()).normalize().dot(aim);
        if (dot > best) {
          best = dot;
          into = l;
        }
      }
    }
    if (!into?.rec) return;
    if (!into.rec.active) this.beginFlick(into);
    into.rec.click(this.g, struck);
  }

  /** The beat strip's entries (T16 draws them): targets from half a beat past to four beats ahead. */
  private strip(t: number): StripEntry[] {
    return stripEntries(this.chart, this.env.beats, t);
  }

  private notes(r: ScoreResult): string[] {
    const out: string[] = [];
    const off = Math.round(r.meanOffsetMs);
    if (r.offsets.length >= 5 && Math.abs(off) > 25) {
      out.push(off > 0 ? `You shot ${off} ms late on average. Click on the beat, not after it.` : `You shot ${-off} ms early on average. Wait for the beat.`);
    }
    const weakest = KIND_ORDER.filter((k) => r.hitRate[k] !== undefined).sort((a, b) => (r.hitRate[a] ?? 0) - (r.hitRate[b] ?? 0))[0];
    if (weakest && (r.hitRate[weakest] ?? 1) < 0.6) out.push(`${KIND_NAME[weakest]} gave you the most trouble: you hit ${pct(r.hitRate[weakest] ?? 0)}%.`);
    return out;
  }

  private log(e: TraceEntry): void {
    this.trace.push(e);
  }
}
