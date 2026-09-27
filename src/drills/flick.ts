import { summariseFlicks, type FlickRecord } from '../core/analytics';
import { flickFindings } from '../core/coach';
import { WEAPONS, type ShotResult } from '../core/game';
import { mean, speedScore, speedScoreShort } from '../core/metrics';
import { mmForDegrees } from '../core/sens';
import { store } from '../core/store';
import type { Figure } from '../world/figure';
import { dirFrom, FlickRecorder, spawnFlickOrb, spawnOrbWhere, spawnScreenOrb, TargetSound } from './common';
import { Drill, ms, pct, type DrillReport } from './drill';

export interface FlickParams {
  /** Target radius in metres. */
  radius: number;
  minDeg: number;
  maxDeg: number;
  /** Seconds before a target expires. */
  limit: number;
  count: number;
  minDist: number;
  maxDist: number;
  /** true: targets appear on screen (short flicks). false: anywhere around you (wide flicks, turns). */
  screen: boolean;
}

/** Time-to-hit → 0..1. Short flicks are expected to be faster than turns. */
export const flickSpeedScore = (msTime: number, screen: boolean): number => (screen ? speedScoreShort(msTime) : speedScore(msTime));

export function flickScore(records: readonly FlickRecord[], shots: number, screen: boolean): number {
  if (!records.length) return 0;
  const hits = records.filter((r) => r.hit);
  const hitRate = hits.length / records.length;
  const acc = shots ? hits.length / shots : 0;
  const t = mean(hits.map((r) => r.totalMs)) || (screen ? 1000 : 1400);
  return Math.round(100 * hitRate * (0.5 + 0.5 * flickSpeedScore(t, screen)) * (0.6 + 0.4 * acc));
}

/**
 * One target at a time; flick, click, next. Blink (short, on-screen) and Snap (wide, off-screen)
 * are the same drill with different parameters.
 */
export class FlickDrill extends Drill {
  override weapon = WEAPONS.rail;
  override movable = false;
  private readonly rec = new FlickRecorder();
  /** Wide flicks start off screen: a positional ping says where, as a sound would in a match. */
  private readonly sound = new TargetSound();
  private current: Figure | null = null;
  private shown = 0;
  private age = 0;
  private gap = 0;
  private shots = 0;
  private hits = 0;
  private readonly records: FlickRecord[] = [];
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    readonly id: string,
    readonly title: string,
    kicker: string,
    private readonly p: FlickParams,
    level: number,
  ) {
    super(g);
    this.kicker = kicker;
    this.level = level;
    this.duration = p.count * (p.limit + 0.35) + 3;
  }

  setup(): void {}

  override begin(): void {
    this.next();
  }

  private next(): void {
    if (this.shown >= this.p.count) {
      this.done = true;
      return;
    }
    const { minDeg, maxDeg, minDist, maxDist, radius } = this.p;
    this.current = this.p.screen
      ? spawnScreenOrb(this.g, minDeg, maxDeg, minDist, maxDist, radius)
      : spawnFlickOrb(this.g, minDeg, maxDeg, minDist, maxDist, radius);
    this.rec.begin(this.g, this.current);
    if (!this.p.screen) this.sound.start(this.g, this.current);
    this.shown++;
    this.age = 0;
  }

  private resolve(hit: boolean): void {
    const r = this.rec.finish(this.g, hit);
    this.records.push(r);
    this.coach.flick(r);
    if (hit && r.cls === 'overshoot') this.g.hud.flashToast('OVERSHOOT', 'over');
    else if (hit && r.cls === 'undershoot') this.g.hud.flashToast('UNDERSHOOT', 'under');
    else if (hit && r.cls === 'clean') this.g.hud.flashToast('CLEAN', 'clean');
  }

  override update(dt: number): void {
    if (this.current) {
      this.rec.sample(this.g);
      this.rec.scope(this.g, this.current);
      this.age += dt;
      if (this.age > this.p.limit) {
        this.resolve(false);
        this.g.removeFigure(this.current);
        this.current = null;
        this.gap = 0.3;
        this.g.hud.flashToast('TOO SLOW', 'warn');
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.next();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      const hitsT = this.records.filter((r) => r.hit).map((r) => r.totalMs);
      const over = this.records.filter((r) => r.cls === 'overshoot').length;
      const under = this.records.filter((r) => r.cls === 'undershoot').length;
      this.g.hud.setStats([
        { k: 'TARGET', v: `${this.shown}/${this.p.count}` },
        { k: 'AVG TIME', v: `${ms(mean(hitsT))} ms` },
        { k: 'PAST', v: String(over) },
        { k: 'SHORT', v: String(under) },
      ]);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    const hit = !!s.figure && s.figure === this.current;
    if (hit) this.hits++;
    this.rec.click(this.g, hit);
  }

  override onKill(f: Figure): void {
    if (f !== this.current) return;
    this.resolve(true);
    this.current = null;
    this.gap = 0.22;
  }

  report(): DrillReport {
    const s = summariseFlicks(this.records);
    const acc = this.shots ? this.hits / this.shots : 0;
    const t = s.tally;
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: flickScore(this.records, this.shots, this.p.screen),
      stats: [
        { label: 'Targets hit', value: `${s.hits}/${s.shown}` },
        { label: 'Avg time to hit', value: ms(s.totalMs), unit: 'ms' },
        { label: 'Shot accuracy', value: pct(acc), unit: '%' },
        { label: 'First move lands at', value: Number.isFinite(s.landing) ? pct(s.landing) : '—', unit: '% of the way', hint: '100% = exactly on the target' },
        { label: 'Went past', value: t.total ? pct(t.overshoot / t.total) : '—', unit: '%' },
        { label: 'Stopped short', value: t.total ? pct(t.undershoot / t.total) : '—', unit: '%' },
      ],
      notes: flickFindings(s, this.p.screen ? 'short' : 'wide').map((f) => f.title),
      analytics: { flicks: this.records, flickContext: this.p.screen ? 'short' : 'wide' },
    };
  }
}

export interface PinParams {
  radius: number;
  minDist: number;
  maxDist: number;
  /** Sideways drift of each target, m/s. */
  drift: number;
}

/** Pin — tiny, far targets a few degrees apart: micro-adjustment and patience. */
export class PinDrill extends Drill {
  readonly id = 'pin';
  readonly title = 'Pin';
  override kicker = 'PRECISION';
  override weapon = WEAPONS.rail;
  override movable = false;
  override duration = 30;
  private current: Figure | null = null;
  private born = 0;
  private shots = 0;
  private hits = 0;
  private readonly times: number[] = [];
  private readonly steadiness: number[] = [];
  private hudT = 0;
  private driftDir = 1;
  private seen = true;
  private lastAim = { yaw: 0, pitch: 0 };
  private aimSpeed = 0;
  private missStreak = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    private readonly p: PinParams,
    level: number,
  ) {
    super(g);
    this.level = level;
  }

  setup(): void {}

  override begin(): void {
    this.spawn(true);
  }

  private spawn(first = false): void {
    const aim = this.g.aimAngles();
    let n = 0;
    this.current = spawnOrbWhere(this.g, this.p.radius, 30, () => {
      // The first target starts on the crosshair; if that line is blocked, nearby instead.
      const off = first ? (n++ === 0 ? 0 : 2 + Math.random() * 6) : 3 + Math.random() * 8;
      const a = Math.random() * Math.PI * 2;
      const pitch = Math.max(-3, Math.min(9, aim.pitch + Math.sin(a) * off * 0.5));
      const bearing = Math.max(-40, Math.min(40, aim.yaw + Math.cos(a) * off));
      return { dir: dirFrom(bearing, pitch), dist: this.p.minDist + Math.random() * (this.p.maxDist - this.p.minDist) };
    });
    this.driftDir = Math.random() < 0.5 ? -1 : 1;
    this.seen = true;
    this.born = this.g.clock;
  }

  override update(dt: number): void {
    const aim = this.g.aimAngles();
    this.aimSpeed = dt > 0 ? Math.hypot(aim.yaw - this.lastAim.yaw, aim.pitch - this.lastAim.pitch) / dt : 0;
    this.lastAim = aim;
    const c = this.current;
    if (c?.alive) {
      if (this.p.drift > 0) {
        // Drift sideways relative to the player, bouncing every ~1.5 s.
        const e = this.g.eye();
        const dx = c.position.x - e.x;
        const dz = c.position.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        c.mover.pos.x += (-dz / d) * this.p.drift * this.driftDir * dt;
        c.mover.pos.z += (dx / d) * this.p.drift * this.driftDir * dt;
        // Bounce every ~1.5 s, and straight away if it just slid behind a wall.
        const seen = this.g.canSee(c.position);
        if (Math.random() < dt / 1.5 || (!seen && this.seen)) this.driftDir *= -1;
        this.seen = seen;
      }
      const a = this.g.anglesTo(c.position);
      const on = this.g.crosshairTarget().figure === c;
      this.g.hud.pushScope(this.g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, (Math.asin(c.headRadius / a.dist) * 180) / Math.PI, on);
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.g.hud.setStats([
        { k: 'HITS', v: String(this.hits) },
        { k: 'ACCURACY', v: `${pct(this.shots ? this.hits / this.shots : 0)}%` },
        { k: 'AVG', v: `${ms(mean(this.times))} ms` },
      ]);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    this.steadiness.push(this.aimSpeed);
    if (s.figure === this.current) {
      this.hits++;
      this.missStreak = 0;
    } else if (++this.missStreak >= 3) {
      this.coach.nudge('Settle first, then click.', 'fix');
      this.missStreak = 0;
    }
  }

  override onKill(f: Figure): void {
    if (f !== this.current) return;
    this.times.push((this.g.clock - this.born) * 1000);
    this.spawn();
  }

  report(): DrillReport {
    const acc = this.shots ? this.hits / this.shots : 0;
    const { sens, dpi } = store.settings;
    const headDeg = 2 * ((Math.atan(0.2 / 30) * 180) / Math.PI);
    const mm = mmForDegrees(headDeg, sens, dpi);
    const steady = mean(this.steadiness);
    const notes = [
      `At your sensitivity, a head 30 m away is ${mm.toFixed(1)} mm of mouse movement wide.`,
      acc < 0.5
        ? 'Under half your shots hit: you are clicking on the way past. Stop, check, then click.'
        : acc > 0.8
          ? 'Very clean clicking. Try to go a little faster without dropping below 80%.'
          : 'Solid. Keep the rhythm: arrive, settle, click.',
    ];
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: Math.min(100, Math.round((this.hits * acc * 100) / 30)),
      stats: [
        { label: 'Hits', value: String(this.hits) },
        { label: 'Accuracy', value: pct(acc), unit: '%' },
        { label: 'Avg time / target', value: ms(mean(this.times)), unit: 'ms' },
        { label: 'Crosshair speed when clicking', value: steady.toFixed(1), unit: '°/s', hint: 'Lower = steadier' },
        { label: 'Head width @30 m', value: mm.toFixed(1), unit: 'mm of mouse' },
      ],
      notes,
    };
  }
}
