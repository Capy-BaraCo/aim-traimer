import { WEAPONS } from '../core/game';
import { bearingXZ } from '../world/arena';
import type { BotStyle } from '../world/brain';
import type { Figure } from '../world/figure';
import type { ShotResult } from '../core/game';
import { TrackingProbe } from './common';
import { Drill, pct, type DrillReport } from './drill';

export function trackingNotes(acc: number, trail: number, vertical: number): string[] {
  const notes: string[] = [];
  if (trail > 0.3)
    notes.push(
      `You trail the target by ${trail.toFixed(2)}° on average — you react to direction changes instead of reading them. Watch the strafe rhythm, keep a looser grip, and let your crosshair ride the centre of mass.`,
    );
  else if (trail < -0.3)
    notes.push(
      `You lead the target by ${Math.abs(trail).toFixed(2)}° — you're guessing the next strafe or over-correcting after reversals. Stay reactive: follow, don't predict.`,
    );
  else notes.push('Your lead/lag is balanced: you stay centred through direction changes.');
  if (vertical > 0.45) notes.push(`Your crosshair sags ${vertical.toFixed(2)}° below centre mass. Jumps pull you low — track the chest, not the feet.`);
  else if (vertical < -0.45) notes.push(`You ride ${Math.abs(vertical).toFixed(2)}° high. Great for headshots only if you can hold it — check the scope trace for drift.`);
  if (acc < 0.3) notes.push('Under 30%: drop to the "smooth" bot until 50%+ feels routine, then return to duel strafes.');
  else if (acc > 0.55) notes.push('Strong tracking. Add your own movement next: run Crossfire.');
  return notes;
}

/** Stay on a strafing figure. Auto weapon, hold fire. */
export class DuelistDrill extends Drill {
  readonly id: string;
  readonly title: string;
  override kicker = 'TRACKING';
  override weapon = WEAPONS.pulse;
  override duration = 30;
  protected probe = new TrackingProbe();
  protected target: Figure | null = null;
  protected kills = 0;
  protected shots = 0;
  protected hits = 0;
  protected heads = 0;
  private respawnIn = -1;
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    protected readonly style: BotStyle = 'duel',
  ) {
    super(g);
    this.id = style === 'duel' ? 'duelist' : 'duelist-smooth';
    this.title = style === 'duel' ? 'Duelist' : 'Duelist · Smooth';
  }

  setup(): void {
    this.spawn(0);
  }

  protected spawn(bearing = -25 + Math.random() * 50): void {
    const { x, z } = bearingXZ(bearing, 10 + Math.random() * 4);
    this.target = this.g.spawnHumanoid(x, z, { style: this.style, lane: 5.5, near: 8, far: 15 });
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
    return {
      id: this.id,
      title: this.title,
      score: Math.round(m.accuracy * 100),
      stats: [
        { label: 'Time on target', value: pct(m.accuracy), unit: '%', hint: 'While holding fire' },
        { label: 'Mean error', value: m.meanError.toFixed(2), unit: '°' },
        { label: 'Lag (+) / lead (−)', value: m.trail.toFixed(2), unit: '°' },
        { label: 'Shot accuracy', value: pct(this.shots ? this.hits / this.shots : 0), unit: '%' },
        { label: 'Crit rate', value: pct(this.hits ? this.heads / this.hits : 0), unit: '%' },
        { label: 'Eliminations', value: String(this.kills) },
      ],
      notes: trackingNotes(m.accuracy, m.trail, m.verticalBias),
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

  constructor(g: ConstructorParameters<typeof Drill>[0]) {
    super(g, 'duel');
  }

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
    r.stats.push({ label: 'Shots while still', value: String(this.stillShots) });
    r.notes.unshift(
      moving < 0.8
        ? `You were planted ${pct(1 - moving)}% of the time. In Overwatch a standing target is a free headshot for the enemy — strafe while you shoot (A/D rhythm, crouch at close range).`
        : 'You kept moving — your accuracy held while being a harder target yourself.',
    );
    return r;
  }
}
