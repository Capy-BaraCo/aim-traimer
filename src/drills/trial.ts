import { WEAPONS, type ShotResult } from '../core/game';
import { mean, tallyFlicks, trialScore, type FlickAnalysis, type Focus, type TrialMetrics } from '../core/metrics';
import { bearingXZ } from '../world/arena';
import type { Figure } from '../world/figure';
import { FlickRecorder, spawnFlickOrb, TrackingProbe } from './common';
import { Drill, ms, pct, type DrillReport } from './drill';

const PLAN: Record<Focus, { track: number; flicks: number }> = {
  balanced: { track: 12, flicks: 8 },
  tracking: { track: 16, flicks: 5 },
  flick: { track: 8, flicks: 11 },
};

export interface TrialData {
  metrics: TrialMetrics;
  score: number;
}

/**
 * One PSA sample: a duel-strafe tracking phase, then a string of flicks. Short on purpose —
 * PSA is about the *feel* of each sensitivity back to back, and the numbers are a tie-breaker.
 */
export class CalibrationTrial extends Drill {
  readonly id = 'trial';
  readonly title: string;
  override kicker: string;
  override weapon = WEAPONS.pulse;
  private phase: 'track' | 'flick' = 'track';
  private readonly plan: { track: number; flicks: number };
  private readonly probe = new TrackingProbe();
  private readonly rec = new FlickRecorder();
  private target: Figure | null = null;
  private orb: Figure | null = null;
  private shown = 0;
  private age = 0;
  private gap = 0;
  private flickShots = 0;
  private flickHits = 0;
  private readonly times: number[] = [];
  private readonly flicks: FlickAnalysis[] = [];
  private respawnIn = -1;
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    label: string,
    kicker: string,
    private readonly focus: Focus,
  ) {
    super(g);
    this.title = label;
    this.kicker = kicker;
    this.plan = PLAN[focus];
    this.duration = this.plan.track + this.plan.flicks * 3.1 + 1;
  }

  setup(): void {
    this.spawnTracker(0);
    this.g.hud.setPhase('01 · TRACK — hold fire, stay on target');
  }

  private spawnTracker(bearing = -20 + Math.random() * 40): void {
    const { x, z } = bearingXZ(bearing, 11 + Math.random() * 2);
    this.target = this.g.spawnHumanoid(x, z, { style: 'duel', lane: 5, near: 8, far: 14 });
    this.target.hp = this.target.maxHp = 400;
  }

  override update(dt: number): void {
    if (this.phase === 'track') {
      if (this.respawnIn > 0) {
        this.respawnIn -= dt;
        if (this.respawnIn <= 0) this.spawnTracker();
      }
      this.probe.sample(this.g, this.target?.alive ? this.target : null, dt);
      if (this.elapsed >= this.plan.track) this.toFlicks();
    } else if (this.orb) {
      this.rec.sample(this.g);
      this.rec.scope(this.g, this.orb);
      this.age += dt;
      if (this.age > 2.8) {
        this.flicks.push(this.rec.finish());
        this.g.removeFigure(this.orb);
        this.orb = null;
        this.gap = 0.3;
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.nextOrb();
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.g.hud.setStats(
        this.phase === 'track'
          ? [{ k: 'ON TARGET', v: `${pct(this.probe.meter.accuracy)}%` }]
          : [
              { k: 'FLICK', v: `${this.shown}/${this.plan.flicks}` },
              { k: 'AVG', v: `${ms(mean(this.times))} ms` },
            ],
      );
    }
  }

  private toFlicks(): void {
    this.phase = 'flick';
    this.g.clearFigures();
    this.target = null;
    this.g.weapon = WEAPONS.rail;
    this.g.hud.setPhase('02 · FLICK — one click per target');
    this.g.hud.flashToast('FLICK PHASE', 'info');
    this.gap = 0.45;
  }

  private nextOrb(): void {
    if (this.shown >= this.plan.flicks) {
      this.done = true;
      return;
    }
    this.orb = spawnFlickOrb(this.g, 25, 120, 10, 18, 0.34);
    this.rec.begin(this.g, this.orb);
    this.shown++;
    this.age = 0;
  }

  override onShot(s: ShotResult): void {
    if (this.phase === 'flick') {
      this.flickShots++;
      if (s.figure && s.figure === this.orb) this.flickHits++;
    }
  }

  override onKill(f: Figure): void {
    if (this.phase === 'track') {
      this.target = null;
      this.respawnIn = 0.3;
      return;
    }
    if (f !== this.orb) return;
    this.times.push(this.rec.elapsed * 1000);
    this.flicks.push(this.rec.finish());
    this.orb = null;
    this.gap = 0.22;
  }

  report(): DrillReport {
    const m = this.probe.meter;
    const metrics: TrialMetrics = {
      trackAcc: m.accuracy,
      trackErr: m.meanError,
      trackTrail: m.trail,
      flickTimeMs: this.times.length ? mean(this.times) : 2800,
      flickHitRate: this.shown ? this.times.length / this.shown : 0,
      flickAcc: this.flickShots ? this.flickHits / this.flickShots : 0,
      tally: tallyFlicks(this.flicks),
    };
    const score = trialScore(metrics, this.focus);
    const data: TrialData = { metrics, score };
    return { id: this.id, title: this.title, score, stats: [], notes: [], data };
  }
}
