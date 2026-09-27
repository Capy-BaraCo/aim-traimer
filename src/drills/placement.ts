import { Vector3 } from 'three';
import { placementFindings } from '../core/coach';
import { WEAPONS, type ShotResult } from '../core/game';
import { mean } from '../core/metrics';
import { PeekBrain } from '../world/brain';
import type { Figure } from '../world/figure';
import { Drill, ms, pct, type DrillReport } from './drill';

/**
 * Corner Watch — hold the angle. Figures peek from behind three fins at head height.
 * The key number is where your crosshair was the moment a head became visible.
 */
export class CornerWatchDrill extends Drill {
  readonly id = 'corner';
  readonly title = 'Corner Watch';
  override kicker = 'CROSSHAIR PLACEMENT';
  override weapon = WEAPONS.rail;
  override movable = false;
  override duration = 60;
  private readonly peeks: number;
  private count = 0;
  private current: Figure | null = null;
  private brain: PeekBrain | null = null;
  private seenAt = -1;
  private wasExposed = false;
  private gap = 0;
  private readonly errors: number[] = [];
  private readonly vertical: number[] = [];
  private readonly ttk: number[] = [];
  private escapes = 0;
  private shots = 0;
  private heads = 0;
  private kills = 0;
  private hudT = 0;
  private readonly points: { x: number; y: number }[] = [];

  constructor(
    g: ConstructorParameters<typeof Drill>[0],
    private readonly p: { exposure: [number, number]; peeks: number; hp: number },
    level: number,
  ) {
    super(g);
    this.level = level;
    this.peeks = p.peeks;
    this.duration = p.peeks * 5 + 4;
  }

  setup(): void {}

  override begin(): void {
    this.next();
  }

  private next(): void {
    if (this.count >= this.peeks) {
      this.done = true;
      return;
    }
    this.count++;
    const fins = this.g.arena.fins;
    const fin = fins[Math.floor(Math.random() * fins.length)];
    const b = (fin.bearing * Math.PI) / 180;
    const radial = new Vector3(Math.sin(b), 0, -Math.cos(b));
    const tangent = new Vector3(Math.cos(b), 0, Math.sin(b));
    const hide = fin.box.center.clone().setY(0).addScaledVector(radial, 1.25);
    const f = this.g.spawnHumanoid(hide.x, hide.z);
    f.hp = f.maxHp = this.p.hp;
    this.brain = new PeekBrain(f, hide, tangent, fin.width / 2 + 0.85, 0.5 + Math.random() * 1.8, this.p.exposure);
    this.g.setBrain(f, this.brain);
    this.current = f;
    this.seenAt = -1;
    this.wasExposed = false;
  }

  override update(dt: number): void {
    const f = this.current;
    if (f?.alive && this.brain) {
      const head = f.headCenter();
      const visible = this.g.canSee(head);
      if (visible && this.seenAt < 0) {
        this.seenAt = this.g.clock;
        const aim = this.g.aimAngles();
        const a = this.g.anglesTo(head);
        const dy = a.yaw - aim.yaw;
        const dp = a.pitch - aim.pitch;
        this.errors.push(Math.hypot(dy, dp));
        this.vertical.push(dp);
        this.points.push({ x: -dy, y: -dp });
        if (Math.hypot(dy, dp) > 10 && this.errors.length % 3 === 0) this.coach.nudge('Rest your crosshair on the wall edges, at head height.', 'fix');
      }
      if (this.brain.phase === 'exposed' || this.brain.phase === 'out') this.wasExposed = true;
      if (this.wasExposed && this.brain.phase === 'hidden') {
        this.escapes++;
        this.g.hud.flashToast('ESCAPED', 'warn');
        this.g.removeFigure(f);
        this.current = null;
        this.gap = 0.4;
      }
      if (visible) {
        const aim = this.g.aimAngles();
        const a = this.g.anglesTo(head);
        this.g.hud.pushScope(this.g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, (Math.asin(f.headRadius / a.dist) * 180) / Math.PI, this.g.crosshairTarget().figure === f);
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.next();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.g.hud.setStats([
        { k: 'PEEK', v: `${this.count}/${this.peeks}` },
        { k: 'PLACEMENT', v: this.errors.length ? `${mean(this.errors).toFixed(1)}°` : '—' },
        { k: 'TTK', v: `${ms(mean(this.ttk))} ms` },
        { k: 'ESCAPED', v: String(this.escapes) },
      ]);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    if (s.figure && s.part === 'head') this.heads++;
  }

  override onKill(f: Figure): void {
    if (f !== this.current) return;
    this.kills++;
    if (this.seenAt >= 0) this.ttk.push((this.g.clock - this.seenAt) * 1000);
    this.current = null;
    this.brain = null;
    this.gap = 0.5;
  }

  report(): DrillReport {
    const err = mean(this.errors);
    const vert = mean(this.vertical);
    const placement = { error: err, vertical: vert, escapes: this.escapes, count: this.count, points: this.points };
    return {
      id: this.id,
      title: this.title,
      level: this.level,
      score: Math.round(100 * (this.kills / Math.max(1, this.count)) * Math.max(0.2, 1 - err / 12)),
      stats: [
        { label: 'Crosshair distance from head', value: err ? err.toFixed(1) : '—', unit: '°', hint: 'When the head first appeared' },
        { label: 'Crosshair height vs head', value: vert ? (vert > 0 ? '−' : '+') + Math.abs(vert).toFixed(1) : '—', unit: '°' },
        { label: 'Time to kill', value: ms(mean(this.ttk)), unit: 'ms' },
        { label: 'Headshots', value: pct(this.shots ? this.heads / this.shots : 0), unit: '%' },
        { label: 'Escaped', value: `${this.escapes}/${this.count}` },
      ],
      notes: placementFindings(placement).map((f) => f.title),
      analytics: { placement },
    };
  }
}
