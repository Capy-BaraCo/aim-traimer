import { Vector3 } from 'three';
import { WEAPONS, type ShotResult } from '../core/game';
import { flickBias, mean, speedScore, tallyFlicks, type FlickAnalysis, type FlickTally } from '../core/metrics';
import { mmForDegrees } from '../core/sens';
import { store } from '../core/store';
import type { Figure } from '../world/figure';
import { dirFrom, FlickRecorder, spawnFlickOrb } from './common';
import { Drill, ms, pct, type DrillReport } from './drill';

export function flickNotes(t: FlickTally, corrections: number): string[] {
  const notes: string[] = [];
  if (t.total < 4) return ['Not enough completed flicks to read a pattern — run it again.'];
  const over = t.overshoot / t.total;
  const under = t.undershoot / t.total;
  const bias = flickBias(t);
  if (bias > 0.25)
    notes.push(
      `You overshoot ${pct(over)}% of flicks: the first movement carries past the target. Either your sensitivity is slightly high for you, or you're flicking with more force than you can stop. Try the "flick & freeze" exercise.`,
    );
  else if (bias < -0.25)
    notes.push(
      `You undershoot ${pct(under)}% of flicks: you stop short and crawl onto the target with corrections. Commit harder to the first movement; if it persists, your sensitivity may be slightly low.`,
    );
  else notes.push(`Balanced flicks (${pct(over)}% over / ${pct(under)}% under). That's what a controllable sensitivity looks like.`);
  if (corrections > 1.6) notes.push(`${corrections.toFixed(1)} corrective moves per flick on average. Aim for one flick and at most one confirm.`);
  return notes;
}

/** Snap — one target at a time, 25–130° away. Measures time-to-hit and overshoot/undershoot. */
export class SnapDrill extends Drill {
  readonly id = 'snap';
  readonly title = 'Snap';
  override kicker = 'FLICKING';
  override weapon = WEAPONS.rail;
  override duration = 60;
  private readonly total = 18;
  private readonly timeout = 2.8;
  private readonly rec = new FlickRecorder();
  private current: Figure | null = null;
  private shown = 0;
  private age = 0;
  private gap = 0;
  private shots = 0;
  private hits = 0;
  private readonly times: number[] = [];
  private readonly flicks: FlickAnalysis[] = [];
  private hudT = 0;

  setup(): void {}

  override begin(): void {
    this.next();
  }

  private next(): void {
    if (this.shown >= this.total) {
      this.done = true;
      return;
    }
    this.current = spawnFlickOrb(this.g, 25, 130, 10, 20, 0.34);
    this.rec.begin(this.g, this.current);
    this.shown++;
    this.age = 0;
  }

  override update(dt: number): void {
    if (this.current) {
      this.rec.sample(this.g);
      this.rec.scope(this.g, this.current);
      this.age += dt;
      if (this.age > this.timeout) {
        this.flicks.push(this.rec.finish());
        this.g.removeFigure(this.current);
        this.current = null;
        this.gap = 0.3;
        this.g.hud.flashToast('MISSED', 'warn');
      }
    } else if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.next();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      const t = tallyFlicks(this.flicks);
      this.g.hud.setStats([
        { k: 'TARGET', v: `${this.shown}/${this.total}` },
        { k: 'AVG TIME', v: `${ms(mean(this.times))} ms` },
        { k: 'OVER', v: String(t.overshoot) },
        { k: 'UNDER', v: String(t.undershoot) },
      ]);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    if (s.figure && s.figure === this.current) this.hits++;
  }

  override onKill(f: Figure): void {
    if (f !== this.current) return;
    this.times.push(this.rec.elapsed * 1000);
    const a = this.rec.finish();
    this.flicks.push(a);
    if (a.cls === 'overshoot') this.g.hud.flashToast('OVERSHOOT', 'over');
    else if (a.cls === 'undershoot') this.g.hud.flashToast('UNDERSHOOT', 'under');
    this.current = null;
    this.gap = 0.22;
  }

  report(): DrillReport {
    const t = tallyFlicks(this.flicks);
    const hitRate = this.shown ? this.times.length / this.shown : 0;
    const acc = this.shots ? this.hits / this.shots : 0;
    const avg = mean(this.times);
    const corrections = mean(this.flicks.filter((f) => f.cls !== 'micro').map((f) => f.corrections));
    return {
      id: this.id,
      title: this.title,
      score: Math.round(100 * hitRate * (0.5 + 0.5 * speedScore(avg)) * (0.6 + 0.4 * acc)),
      stats: [
        { label: 'Avg time to hit', value: ms(avg), unit: 'ms' },
        { label: 'Targets hit', value: `${this.times.length}/${this.shown}` },
        { label: 'Shot accuracy', value: pct(acc), unit: '%' },
        { label: 'Overshoot', value: t.total ? pct(t.overshoot / t.total) : '—', unit: '%' },
        { label: 'Undershoot', value: t.total ? pct(t.undershoot / t.total) : '—', unit: '%' },
        { label: 'Corrections / flick', value: corrections.toFixed(1) },
      ],
      notes: flickNotes(t, corrections),
      data: { tally: t },
    };
  }
}

/** Pin — tiny, far targets a few degrees apart: micro-adjustment and patience. */
export class PinDrill extends Drill {
  readonly id = 'pin';
  readonly title = 'Pin';
  override kicker = 'PRECISION';
  override weapon = WEAPONS.rail;
  override duration = 30;
  private current: Figure | null = null;
  private born = 0;
  private shots = 0;
  private hits = 0;
  private readonly times: number[] = [];
  private hudT = 0;
  private readonly radius = 0.15;

  setup(): void {}

  override begin(): void {
    this.spawn(true);
  }

  private spawn(first = false): void {
    const eye = this.g.eye();
    const aim = this.g.aimAngles();
    const pos = new Vector3();
    for (let i = 0; i < 20; i++) {
      const off = first ? 0 : 3 + Math.random() * 8;
      const a = Math.random() * Math.PI * 2;
      const pitch = Math.max(-3, Math.min(9, aim.pitch + Math.sin(a) * off * 0.5));
      const yaw = first ? aim.yaw : aim.yaw + Math.cos(a) * off;
      const bearing = Math.max(-40, Math.min(40, yaw));
      pos.copy(eye).addScaledVector(dirFrom(bearing, pitch), 24 + Math.random() * 9);
      if (pos.y > 0.6 && this.g.canSee(pos)) break;
    }
    this.current = this.g.spawnOrb(pos, this.radius);
    this.born = this.g.clock;
  }

  override update(dt: number): void {
    if (this.current?.alive) {
      const aim = this.g.aimAngles();
      const a = this.g.anglesTo(this.current.position);
      const on = this.g.crosshairTarget().figure === this.current;
      this.g.hud.pushScope(this.g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, (Math.asin(this.radius / a.dist) * 180) / Math.PI, on);
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
    if (s.figure === this.current) this.hits++;
  }

  override onKill(f: Figure): void {
    if (f !== this.current) return;
    this.times.push((this.g.clock - this.born) * 1000);
    this.spawn();
  }

  report(): DrillReport {
    const acc = this.shots ? this.hits / this.shots : 0;
    const { sens, dpi } = store.settings;
    const headDeg = 2 * (Math.atan(0.2 / 30) * 180) / Math.PI;
    const mm = mmForDegrees(headDeg, sens, dpi);
    const notes = [
      `At your sensitivity, a head 30 m away is ${mm.toFixed(1)} mm of mouse travel wide. Precision is fingertip work — slow the last few millimetres down.`,
    ];
    if (acc < 0.5) notes.push('Under 50% accuracy: you are clicking on the way past. Stop, confirm, then click — speed comes later.');
    else if (acc > 0.8) notes.push('Very clean. Push speed: aim to cut your average time by 10% without dropping below 80%.');
    return {
      id: this.id,
      title: this.title,
      score: Math.min(100, Math.round((this.hits * acc * 100) / 30)),
      stats: [
        { label: 'Hits', value: String(this.hits) },
        { label: 'Accuracy', value: pct(acc), unit: '%' },
        { label: 'Avg time / target', value: ms(mean(this.times)), unit: 'ms' },
        { label: 'Head width @30 m', value: mm.toFixed(1), unit: 'mm of mouse' },
      ],
      notes,
    };
  }
}
