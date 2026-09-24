import { Vector3 } from 'three';
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
  override allowMove = false;
  override duration = 60;
  private readonly peeks = 14;
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
    f.hp = f.maxHp = 140;
    this.brain = new PeekBrain(f, hide, tangent, fin.width / 2 + 0.85, 0.5 + Math.random() * 1.8);
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
    const notes: string[] = [];
    if (err > 8) notes.push(`When a head appeared your crosshair was ${err.toFixed(1)}° away on average. Park it on the edge of the cover where the head will appear, not in open space.`);
    else if (err > 0) notes.push(`${err.toFixed(1)}° average placement error — every degree you remove is reaction time you get back.`);
    if (vert > 0.8) notes.push(`You sit ${vert.toFixed(1)}° below head height. In Overwatch most heads are at roughly the same height: lift your default crosshair level.`);
    else if (vert < -0.8) notes.push(`You sit ${Math.abs(vert).toFixed(1)}° above head height. Lower your resting line to where heads actually are.`);
    if (this.escapes > 2) notes.push(`${this.escapes} figures got away. Pre-aim reduces the flick you need — the kill should be one short adjustment.`);
    return {
      id: this.id,
      title: this.title,
      score: Math.round(100 * (this.kills / Math.max(1, this.count)) * Math.max(0.2, 1 - err / 12)),
      stats: [
        { label: 'Placement error', value: err ? err.toFixed(1) : '—', unit: '°', hint: 'Crosshair → head when it appeared' },
        { label: 'Vertical offset', value: vert ? (vert > 0 ? '−' : '+') + Math.abs(vert).toFixed(1) : '—', unit: '°' },
        { label: 'Time to kill', value: ms(mean(this.ttk)), unit: 'ms' },
        { label: 'Crit shots', value: pct(this.shots ? this.heads / this.shots : 0), unit: '%' },
        { label: 'Escaped', value: `${this.escapes}/${this.count}` },
      ],
      notes,
    };
  }
}
