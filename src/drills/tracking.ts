import { trackingFindings } from '../core/coach';
import { WEAPONS, type ShotResult } from '../core/game';
import { bearingXZ } from '../world/arena';
import type { BotStyle, StyleTuning } from '../world/brain';
import type { Figure } from '../world/figure';
import { TrackingProbe } from './common';
import { Drill, pct, type DrillReport } from './drill';

export interface DuelParams {
  style: BotStyle;
  tuning: Partial<StyleTuning>;
  /** Distance band the figure keeps from you, metres. Closer = faster across your screen. */
  near: number;
  far: number;
}

/** Stay on a strafing figure. Auto weapon, hold fire. */
export class DuelistDrill extends Drill {
  readonly id: string = 'duelist';
  readonly title: string = 'Duelist';
  override kicker = 'TRACKING';
  override weapon = WEAPONS.pulse;
  override duration = 30;
  protected readonly probe: TrackingProbe;
  protected target: Figure | null = null;
  protected kills = 0;
  protected shots = 0;
  protected hits = 0;
  protected heads = 0;
  private respawnIn = -1;
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    protected readonly p: DuelParams,
    level: number,
  ) {
    super(g);
    this.level = level;
    this.probe = new TrackingProbe(this.coach);
  }

  setup(): void {
    this.spawn(0);
  }

  protected spawn(bearing = -25 + Math.random() * 50): void {
    const { x, z } = bearingXZ(bearing, (this.p.near + this.p.far) / 2);
    this.target = this.g.spawnHumanoid(x, z, { style: this.p.style, lane: 5.5, near: this.p.near, far: this.p.far, tuning: this.p.tuning });
  }

  override update(dt: number): void {
    if (this.respawnIn > 0) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.spawn();
    }
    this.probe.sample(this.g, this.target?.alive ? this.target : null, dt);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.pushHud();
    }
  }

  protected pushHud(): void {
    const m = this.probe.meter;
    this.g.hud.setStats([
      { k: 'ON TARGET', v: `${pct(m.accuracy)}%` },
      { k: 'ERR', v: `${m.meanError.toFixed(2)}°` },
      { k: 'LAG', v: `${m.trail >= 0 ? '+' : ''}${m.trail.toFixed(2)}°` },
      { k: 'KILLS', v: String(this.kills) },
    ]);
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    if (s.figure) {
      this.hits++;
      if (s.part === 'head') this.heads++;
    }
  }

  override onKill(): void {
    this.kills++;
    this.target = null;
    this.respawnIn = 0.35;
  }

  report(): DrillReport {
    const m = this.probe.meter;
    const facts = this.probe.facts();
    const d = facts.summary.delayMs;
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: Math.round(m.accuracy * 100),
      stats: [
        { label: 'Time on target', value: pct(m.accuracy), unit: '%', hint: 'While holding fire' },
        { label: 'Reaction to strafes', value: d === null ? '—' : String(Math.round(d)), unit: 'ms' },
        { label: 'Behind (+) / ahead (−)', value: m.trail.toFixed(2), unit: '°' },
        { label: 'Height vs chest', value: (-m.verticalBias).toFixed(2), unit: '°', hint: 'Negative = below' },
        { label: 'Extra shakes / second', value: facts.summary.jitter.toFixed(1) },
        { label: 'Eliminations', value: String(this.kills) },
      ],
      notes: trackingFindings(facts).map((f) => f.title),
      analytics: { tracking: facts },
    };
  }
}

/**
 * Crossfire — Overwatch has no movement inaccuracy for hitscan, so good players never stand still.
 * Damage only lands while you're moving at least half speed.
 */
export class CrossfireDrill extends DuelistDrill {
  override readonly id = 'crossfire';
  override readonly title = 'Crossfire';
  override kicker = 'MOVEMENT × AIM';
  private movingTime = 0;
  private stillShots = 0;
  private toastCool = 0;

  private get moving(): boolean {
    return this.g.player.horizontalSpeed >= 2.5 || !this.g.player.onGround;
  }

  override damageEnabled(): boolean {
    return this.moving;
  }

  override update(dt: number): void {
    if (this.moving) this.movingTime += dt;
    this.toastCool -= dt;
    super.update(dt);
  }

  override onShot(s: ShotResult): void {
    super.onShot(s);
    if (!this.moving) {
      this.stillShots++;
      if (this.toastCool <= 0) {
        this.g.hud.flashToast('STANDING STILL · NO DAMAGE', 'warn');
        this.toastCool = 1;
      }
      if (this.stillShots % 12 === 0) this.coach.nudge('Keep your feet moving — A, D, A, D.', 'fix');
    }
  }

  protected override pushHud(): void {
    const m = this.probe.meter;
    this.g.hud.setStats([
      { k: 'ON TARGET', v: `${pct(m.accuracy)}%` },
      { k: 'MOVING', v: `${pct(this.elapsed > 0 ? this.movingTime / this.elapsed : 0)}%`, tone: this.moving ? 'good' : 'bad' },
      { k: 'LAG', v: `${m.trail >= 0 ? '+' : ''}${m.trail.toFixed(2)}°` },
      { k: 'KILLS', v: String(this.kills) },
    ]);
  }

  override report(): DrillReport {
    const r = super.report();
    const moving = this.elapsed > 0 ? this.movingTime / this.elapsed : 0;
    r.score = Math.round(this.probe.meter.accuracy * moving * 100);
    r.stats.splice(1, 0, { label: 'Time moving', value: pct(moving), unit: '%' });
    r.stats.push({ label: 'Shots while standing still', value: String(this.stillShots) });
    r.analytics = { ...r.analytics, movement: { moving } };
    return r;
  }
}
