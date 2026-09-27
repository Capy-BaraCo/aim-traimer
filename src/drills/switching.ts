import { switchingFindings } from '../core/coach';
import { WEAPONS, type ShotResult } from '../core/game';
import { mean } from '../core/metrics';
import { bearingXZ } from '../world/arena';
import type { Figure } from '../world/figure';
import { Drill, ms, pct, type DrillReport } from './drill';

/** Triad — three strafers; kill one, find the next. Measures switch time. */
export class TriadDrill extends Drill {
  readonly id = 'triad';
  readonly title = 'Triad';
  override kicker = 'TARGET SWITCHING';
  override weapon = WEAPONS.pulse;
  override duration = 30;
  private kills = 0;
  private shots = 0;
  private hits = 0;
  private lastKillAt = -1;
  private lastKilled: Figure | null = null;
  private readonly switches: number[] = [];
  private pending = 0;
  private respawnT: number[] = [];
  private hudT = 0;

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    private readonly p: { count: number; hp: number; duelShare: number; speed: number },
    level: number,
  ) {
    super(g);
    this.level = level;
  }

  setup(): void {
    const spread = this.p.count >= 4 ? [-60, -20, 20, 60] : [-40, 0, 40];
    for (const b of spread) this.spawn(b);
  }

  private spawn(bearing?: number): void {
    const others = this.g.figures.filter((f) => f.alive).map((f) => Math.atan2(f.position.x, -f.position.z) * (180 / Math.PI));
    let b = bearing ?? 0;
    if (bearing === undefined) {
      for (let i = 0; i < 12; i++) {
        b = -65 + Math.random() * 130;
        if (others.every((o) => Math.abs(o - b) > 18)) break;
      }
    }
    const { x, z } = bearingXZ(b, 9 + Math.random() * 8);
    const f = this.g.spawnHumanoid(x, z, {
      style: Math.random() < this.p.duelShare ? 'duel' : 'smooth',
      lane: 3.5,
      near: 7,
      far: 18,
      tuning: { speed: this.p.speed },
    });
    f.hp = f.maxHp = this.p.hp;
  }

  override update(dt: number): void {
    this.respawnT = this.respawnT.map((t) => t - dt);
    while (this.respawnT.length && this.respawnT[0] <= 0) {
      this.respawnT.shift();
      this.spawn();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.g.hud.setStats([
        { k: 'KILLS', v: String(this.kills) },
        { k: 'SWITCH', v: `${ms(mean(this.switches))} ms` },
        { k: 'ACCURACY', v: `${pct(this.shots ? this.hits / this.shots : 0)}%` },
      ]);
    }
    const t = this.g.crosshairTarget().figure;
    if (t) {
      const aim = this.g.aimAngles();
      const a = this.g.anglesTo(t.aimPoint());
      this.g.hud.pushScope(this.g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, (Math.asin(t.aimRadius / a.dist) * 180) / Math.PI, true);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    if (!s.figure) return;
    this.hits++;
    if (this.pending && s.figure !== this.lastKilled) {
      const t = (s.at - this.lastKillAt) * 1000;
      this.switches.push(t);
      this.pending = 0;
      if (t > 900) this.coach.nudge('Pick your next target before this one dies.', 'fix');
      else if (t < 400 && this.switches.length % 4 === 0) this.coach.nudge('Snappy switches!', 'good');
    }
  }

  override onKill(f: Figure): void {
    this.kills++;
    this.lastKillAt = this.g.clock;
    this.lastKilled = f;
    this.pending = 1;
    this.respawnT.push(0.3);
  }

  report(): DrillReport {
    const acc = this.shots ? this.hits / this.shots : 0;
    const sw = mean(this.switches);
    const notes = switchingFindings({ switchMs: sw, acc, kills: this.kills }).map((f) => f.title);
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      analytics: { switching: { switchMs: sw, acc, kills: this.kills } },
      score: Math.min(100, Math.round(this.kills * 5 * (0.5 + acc))),
      stats: [
        { label: 'Eliminations', value: String(this.kills) },
        { label: 'Avg switch time', value: ms(sw), unit: 'ms' },
        { label: 'Shot accuracy', value: pct(acc), unit: '%' },
      ],
      notes,
    };
  }
}
