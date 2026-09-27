import { summariseEcho, summariseFlicks, type EchoRecord, type FlickRecord } from '../core/analytics';
import { flickFindings, hearingFindings } from '../core/coach';
import { WEAPONS, type ShotResult } from '../core/game';
import { mean } from '../core/metrics';
import type { Figure } from '../world/figure';
import { dirFrom, FlickRecorder, spawnOrbWhere, TargetSound } from './common';
import { Drill, ms, pct, type DrillReport } from './drill';

export interface EchoParams {
  radius: number;
  /** How far round from your aim the target appears (degrees, either side). */
  minDeg: number;
  maxDeg: number;
  /** Seconds before a target expires. */
  limit: number;
  count: number;
  /** Seconds between beacon ticks while the target is off screen; 0 = one ping only. */
  beacon: number;
  /** Training wheels: show the direction arc for every sound, only the first, or never. */
  arc: 'all' | 'spawn' | 'none';
  minDist: number;
  maxDist: number;
}

/** A first turn smaller than this is a twitch, not a decision. */
const TURN_DEG = 4;

/**
 * Echo — targets appear beside and behind you, and sound is how you find them. Turn the short way,
 * flick, click. Measures whether your first turn went the right way and how soon it started.
 */
export class EchoDrill extends Drill {
  readonly id = 'echo';
  readonly title = 'Echo';
  override kicker = 'SOUND AWARENESS';
  override weapon = WEAPONS.rail;
  override movable = false;
  private readonly rec = new FlickRecorder();
  private readonly sound: TargetSound;
  private current: Figure | null = null;
  private shown = 0;
  private age = 0;
  private gap = 0;
  private shots = 0;
  private hits = 0;
  private readonly records: FlickRecord[] = [];
  private readonly hearing: EchoRecord[] = [];
  private live: EchoRecord | null = null;
  private startYaw = 0;
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    private readonly p: EchoParams,
    level: number,
  ) {
    super(g);
    this.level = level;
    this.duration = p.count * (p.limit + 0.45) + 3;
    this.sound = new TargetSound(p.beacon, {
      force: true,
      onPing: (az, spawn) => {
        if (p.arc === 'all' || (p.arc === 'spawn' && spawn)) g.hud.sonar(az, spawn);
      },
    });
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
    const aim = this.g.aimAngles();
    const side = Math.random() < 0.5 ? -1 : 1;
    const { minDeg, maxDeg, minDist, maxDist, radius } = this.p;
    this.current = spawnOrbWhere(this.g, radius, 30, () => ({
      dir: dirFrom(aim.yaw + side * (minDeg + Math.random() * (maxDeg - minDeg)), -2 + Math.random() * 10),
      dist: minDist + Math.random() * (maxDist - minDist),
    }));
    const a = this.g.anglesTo(this.current.position);
    this.startYaw = aim.yaw;
    this.live = { rel: a.yaw - aim.yaw, turnDir: 0, turnMs: null, seenMs: null, hit: false, totalMs: 0 };
    this.rec.begin(this.g, this.current);
    this.sound.start(this.g, this.current);
    this.shown++;
    this.age = 0;
  }

  private resolve(hit: boolean): void {
    this.sound.stop();
    const r = this.rec.finish(this.g, hit);
    this.records.push(r);
    const e = this.live;
    if (e) {
      e.hit = hit;
      e.totalMs = this.age * 1000;
      this.hearing.push(e);
      this.live = null;
      if (e.turnDir && Math.abs(e.rel) < 165 && Math.sign(e.rel) !== e.turnDir) this.coach.nudge('Wrong way — turn toward the louder ear.', 'fix');
    }
  }

  override update(dt: number): void {
    const f = this.current;
    if (f) {
      this.rec.sample(this.g);
      this.rec.scope(this.g, f);
      this.sound.update(this.g, dt);
      this.age += dt;
      const e = this.live;
      if (e) {
        const turned = this.g.aimAngles().yaw - this.startYaw;
        if (!e.turnDir && Math.abs(turned) >= TURN_DEG) {
          e.turnDir = Math.sign(turned);
          e.turnMs = this.age * 1000;
        }
        if (e.seenMs === null && this.g.onScreen(f.position, 0.95)) e.seenMs = this.age * 1000;
      }
      if (this.age > this.p.limit) {
        this.resolve(false);
        this.g.removeFigure(f);
        this.current = null;
        this.gap = 0.45;
        this.g.hud.flashToast('TOO SLOW', 'warn');
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.next();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      const s = summariseEcho(this.hearing);
      this.g.hud.setStats([
        { k: 'TARGET', v: `${this.shown}/${this.p.count}` },
        { k: 'RIGHT WAY', v: s.judged ? `${pct(s.rate)}%` : '—' },
        { k: 'TURN START', v: `${ms(s.turnMs)} ms` },
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
    this.gap = 0.35;
  }

  report(): DrillReport {
    const e = summariseEcho(this.hearing);
    const fs = summariseFlicks(this.records);
    const hitMs = mean(this.hearing.filter((r) => r.hit).map((r) => r.totalMs));
    const speed = Number.isFinite(hitMs) ? Math.min(1, Math.max(0, (2400 - hitMs) / 1700)) : 0;
    const hitRate = e.n ? e.hits / e.n : 0;
    const right = Number.isFinite(e.rate) ? e.rate : 0.5;
    const acc = this.shots ? this.hits / this.shots : 0;
    const score = Math.round(100 * hitRate * (0.45 + 0.55 * speed) * (0.55 + 0.45 * right) * (0.75 + 0.25 * acc));
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: Math.min(100, score),
      stats: [
        { label: 'Targets hit', value: `${e.hits}/${e.n}` },
        { label: 'Avg time to hit', value: ms(hitMs), unit: 'ms' },
        { label: 'First turn the short way', value: e.judged ? pct(e.rate) : '—', unit: '%', hint: 'Dead-behind sounds (either way is fine) are not counted' },
        { label: 'Started turning after', value: ms(e.turnMs), unit: 'ms', hint: 'From the sound to your first real turn' },
        { label: 'Right way · in front', value: e.front.n ? pct(e.front.rate) : '—', unit: '%' },
        { label: 'Right way · behind', value: e.behind.n ? pct(e.behind.rate) : '—', unit: '%' },
      ],
      notes: [...hearingFindings(e), ...flickFindings(fs, 'wide')].map((f) => f.title),
      analytics: { flicks: this.records, flickContext: 'wide', hearing: this.hearing },
    };
  }
}
