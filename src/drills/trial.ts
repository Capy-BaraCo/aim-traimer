import { summariseFlicks, type FlickRecord, type TrackingSummary } from '../core/analytics';
import { WEAPONS, type ShotResult } from '../core/game';
import { trialScore, type Focus, type SectionFlickMetrics, type TrialMetrics } from '../core/metrics';
import { bearingXZ } from '../world/arena';
import type { Figure } from '../world/figure';
import { FlickRecorder, spawnFlickOrb, spawnScreenOrb, TargetSound, TrackingProbe } from './common';
import { Drill, ms, pct, type DrillReport } from './drill';

export type Section = 'track' | 'short' | 'wide';

export interface Sections {
  track: boolean;
  short: boolean;
  wide: boolean;
}

/** Seconds of tracking, and how many short / wide flicks, per focus. */
export const PLAN: Record<Focus, { track: number; short: number; wide: number }> = {
  balanced: { track: 10, short: 7, wide: 5 },
  tracking: { track: 14, short: 5, wide: 3 },
  flick: { track: 6, short: 8, wide: 7 },
};

const LIMIT = { short: 1.6, wide: 2.8 };
const RADIUS = { short: 0.26, wide: 0.34 };

export const SECTION_INFO: Record<Section, { name: string; hud: string; plain: string }> = {
  track: { name: 'Tracking', hud: 'TRACK — hold fire, stay on them', plain: 'follow a dodging enemy while holding fire' },
  short: { name: 'Short flicks', hud: 'SHORT FLICKS — targets on your screen', plain: 'snap to targets that pop up close to your crosshair' },
  wide: { name: 'Wide flicks', hud: 'WIDE FLICKS — targets all around you', plain: 'turn to targets anywhere around you, even behind' },
};

export function sampleSeconds(focus: Focus, s: Sections): number {
  const p = PLAN[focus];
  return (s.track ? p.track : 0) + (s.short ? p.short * 1.1 : 0) + (s.wide ? p.wide * 1.7 : 0) + 3;
}

export interface TrialData {
  metrics: TrialMetrics;
  score: number;
  flicks: { short: FlickRecord[]; wide: FlickRecord[] };
  tracking: TrackingSummary | null;
}

/**
 * One PSA sample: tracking, then short on-screen flicks, then wide turns (any can be switched off).
 * Short on purpose — PSA compares the *feel* of two sensitivities back to back; numbers break ties.
 */
export class CalibrationTrial extends Drill {
  readonly id = 'trial';
  readonly title: string;
  override kicker: string;
  override weapon = WEAPONS.pulse;
  private readonly phases: Section[];
  private phaseIdx = 0;
  private phaseStart = 0;
  private readonly plan: { track: number; short: number; wide: number };
  private readonly probe: TrackingProbe;
  private readonly rec = new FlickRecorder();
  private readonly sound = new TargetSound();
  private target: Figure | null = null;
  private orb: Figure | null = null;
  private shownInPhase = 0;
  private age = 0;
  private gap = 0;
  private readonly shots = { short: 0, wide: 0 };
  private readonly records: { short: FlickRecord[]; wide: FlickRecord[] } = { short: [], wide: [] };
  private respawnIn = -1;
  private hudT = 0;
  private tracked = false;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    label: string,
    kicker: string,
    private readonly focus: Focus,
    sections: Sections = { track: true, short: true, wide: true },
  ) {
    super(g);
    this.title = label;
    this.kicker = kicker;
    this.plan = PLAN[focus];
    this.phases = (['track', 'short', 'wide'] as Section[]).filter((s) => sections[s]);
    if (!this.phases.length) this.phases.push('short');
    this.probe = new TrackingProbe();
    this.coach.enabled = false; // no coaching during calibration: it would bias the comparison
    this.duration =
      (sections.track ? this.plan.track : 0) +
      (sections.short ? this.plan.short * (LIMIT.short + 0.35) : 0) +
      (sections.wide ? this.plan.wide * (LIMIT.wide + 0.35) : 0) +
      3;
  }

  private get phase(): Section {
    return this.phases[Math.min(this.phaseIdx, this.phases.length - 1)];
  }

  /** Movement is allowed while tracking only, so flick measurements stay clean. */
  override get allowMove(): boolean {
    return this.phase === 'track';
  }

  setup(): void {
    this.enterPhase(0, true);
  }

  private enterPhase(i: number, initial = false): void {
    this.phaseIdx = i;
    if (i >= this.phases.length) {
      this.done = true;
      return;
    }
    const ph = this.phase;
    this.phaseStart = this.elapsed;
    this.shownInPhase = 0;
    this.g.clearFigures();
    this.target = null;
    this.orb = null;
    this.g.hud.setPhase(`${String(i + 1).padStart(2, '0')} · ${SECTION_INFO[ph].hud}`);
    if (ph === 'track') {
      this.g.weapon = WEAPONS.pulse;
      this.spawnTracker(0);
    } else {
      this.g.weapon = WEAPONS.rail;
      this.gap = initial ? 0.05 : 0.45;
      if (!initial) this.g.hud.flashToast(SECTION_INFO[ph].name.toUpperCase(), 'info');
    }
  }

  override begin(): void {
    if (this.phase !== 'track' && !this.orb) this.gap = 0.2;
  }

  private spawnTracker(bearing = -20 + Math.random() * 40): void {
    const { x, z } = bearingXZ(bearing, 11 + Math.random() * 2);
    this.target = this.g.spawnHumanoid(x, z, { style: 'duel', lane: 5, near: 8, far: 14 });
    this.target.hp = this.target.maxHp = 400;
  }

  override update(dt: number): void {
    const ph = this.phase;
    if (ph === 'track') {
      this.tracked = true;
      if (this.respawnIn > 0) {
        this.respawnIn -= dt;
        if (this.respawnIn <= 0) this.spawnTracker();
      }
      this.probe.sample(this.g, this.target?.alive ? this.target : null, dt);
      if (this.elapsed - this.phaseStart >= this.plan.track) this.enterPhase(this.phaseIdx + 1);
    } else if (this.orb) {
      this.rec.sample(this.g);
      this.rec.scope(this.g, this.orb);
      this.age += dt;
      if (this.age > LIMIT[ph]) {
        this.records[ph].push(this.rec.finish(this.g, false));
        this.g.removeFigure(this.orb);
        this.orb = null;
        this.gap = 0.3;
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.nextOrb();
    }

    this.hudT -= dt;
    if (this.hudT <= 0 && !this.done) {
      this.hudT = 0.1;
      if (this.phase === 'track') this.g.hud.setStats([{ k: 'ON TARGET', v: `${pct(this.probe.meter.accuracy)}%` }]);
      else {
        const p = this.phase as 'short' | 'wide';
        const hits = this.records[p].filter((r) => r.hit).map((r) => r.totalMs);
        this.g.hud.setStats([
          { k: p === 'short' ? 'SHORT' : 'WIDE', v: `${this.shownInPhase}/${this.plan[p]}` },
          { k: 'AVG', v: `${ms(hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : NaN)} ms` },
        ]);
      }
    }
  }

  private nextOrb(): void {
    const ph = this.phase as 'short' | 'wide';
    if (this.shownInPhase >= this.plan[ph]) {
      this.enterPhase(this.phaseIdx + 1);
      return;
    }
    this.orb =
      ph === 'short'
        ? spawnScreenOrb(this.g, 5, 26, 11, 17, RADIUS.short)
        : spawnFlickOrb(this.g, 35, 130, 10, 18, RADIUS.wide);
    this.rec.begin(this.g, this.orb);
    if (ph === 'wide') this.sound.start(this.g, this.orb);
    this.shownInPhase++;
    this.age = 0;
  }

  override onShot(s: ShotResult): void {
    const ph = this.phase;
    if (ph === 'track') return;
    this.shots[ph]++;
    this.rec.click(this.g, !!s.figure && s.figure === this.orb);
  }

  override onKill(f: Figure): void {
    const ph = this.phase;
    if (ph === 'track') {
      this.target = null;
      this.respawnIn = 0.3;
      return;
    }
    if (f !== this.orb) return;
    this.records[ph].push(this.rec.finish(this.g, true));
    this.orb = null;
    this.gap = 0.22;
  }

  private section(ph: 'short' | 'wide'): SectionFlickMetrics | null {
    if (!this.phases.includes(ph)) return null;
    const recs = this.records[ph];
    const s = summariseFlicks(recs);
    return {
      n: recs.length,
      timeMs: Number.isFinite(s.totalMs) ? s.totalMs : ph === 'short' ? 1000 : 1400,
      hitRate: recs.length ? s.hits / recs.length : 0,
      acc: this.shots[ph] ? s.hits / this.shots[ph] : 0,
      landing: s.landing,
      tally: s.tally,
    };
  }

  report(): DrillReport {
    const m = this.probe.meter;
    const short = this.section('short');
    const wide = this.section('wide');
    const tally = {
      overshoot: (short?.tally.overshoot ?? 0) + (wide?.tally.overshoot ?? 0),
      undershoot: (short?.tally.undershoot ?? 0) + (wide?.tally.undershoot ?? 0),
      clean: (short?.tally.clean ?? 0) + (wide?.tally.clean ?? 0),
      total: (short?.tally.total ?? 0) + (wide?.tally.total ?? 0),
    };
    const tracking = this.tracked ? this.probe.trace.summary() : null;
    const metrics: TrialMetrics = {
      trackAcc: this.phases.includes('track') ? m.accuracy : null,
      trackErr: m.meanError,
      trackTrail: m.trail,
      trackDelayMs: tracking?.delayMs ?? null,
      short,
      wide,
      tally,
    };
    const score = trialScore(metrics, this.focus);
    const data: TrialData = { metrics, score, flicks: this.records, tracking };
    return { id: this.id, title: this.title, score, stats: [], notes: [], data };
  }
}
