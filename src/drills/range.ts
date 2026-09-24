import { WEAPONS, type ShotResult } from '../core/game';
import { cmPer360, edpi, roundSens } from '../core/sens';
import { store } from '../core/store';
import { bearingXZ } from '../world/arena';
import { Drill, pct, type DrillReport } from './drill';

/** Free Range — sandbox. Live sensitivity nudging with [ and ], weapon swap with 1 / 2. */
export class FreeRangeDrill extends Drill {
  readonly id = 'range';
  readonly title = 'Free Range';
  override kicker = 'SANDBOX';
  override weapon = WEAPONS.pulse;
  override duration = Infinity;
  private shots = 0;
  private hits = 0;
  private kills = 0;
  private hudT = 0;
  private respawn: number[] = [];
  /** Sensitivity after any live nudges, readable after the drill ends. */
  liveSens = 0;

  setup(): void {
    this.liveSens = this.g.sens;
    for (const [b, d] of [
      [-30, 9],
      [8, 15],
      [42, 22],
    ] as const)
      this.spawnAt(b, d);
    this.g.hud.setPhase('[ / ] sens · 1 / 2 weapon · R reset bots');
  }

  private spawnAt(b = -60 + Math.random() * 120, d = 8 + Math.random() * 16): void {
    const { x, z } = bearingXZ(b, d);
    const f = this.g.spawnHumanoid(x, z, { style: Math.random() < 0.7 ? 'duel' : 'smooth', lane: 5, near: 6, far: 26 });
    f.hp = f.maxHp = 200;
  }

  override onKey(code: string): void {
    const g = this.g;
    if (code === 'BracketLeft' || code === 'BracketRight') {
      g.sens = Math.max(0.01, roundSens(g.sens + (code === 'BracketRight' ? 0.05 : -0.05)));
      this.liveSens = g.sens;
      g.hud.flashToast(`SENS ${g.sens.toFixed(2)}`, 'info');
    } else if (code === 'Digit1') {
      g.weapon = WEAPONS.pulse;
      g.hud.flashToast('PULSE · AUTO', 'info');
    } else if (code === 'Digit2') {
      g.weapon = WEAPONS.rail;
      g.hud.flashToast('RAIL · SEMI', 'info');
    } else if (code === 'KeyR') {
      g.clearFigures();
      this.respawn = [];
      const keep = this.liveSens;
      this.setup();
      this.liveSens = keep;
    }
  }

  override update(dt: number): void {
    this.respawn = this.respawn.map((t) => t - dt);
    while (this.respawn.length && this.respawn[0] <= 0) {
      this.respawn.shift();
      this.spawnAt();
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.12;
      const dpi = store.settings.dpi;
      this.g.hud.setStats([
        { k: 'SENS', v: this.g.sens.toFixed(2) },
        { k: 'eDPI', v: String(Math.round(edpi(this.g.sens, dpi))) },
        { k: 'CM/360', v: cmPer360(this.g.sens, dpi).toFixed(1) },
        { k: 'ACC', v: `${pct(this.shots ? this.hits / this.shots : 0)}%` },
        { k: 'KILLS', v: String(this.kills) },
      ]);
    }
    const t = this.g.crosshairTarget().figure;
    const aim = this.g.aimAngles();
    const near = t ?? this.g.figures.find((f) => f.alive) ?? null;
    if (near) {
      const a = this.g.anglesTo(near.aimPoint());
      this.g.hud.pushScope(this.g.clock, a.yaw - aim.yaw, a.pitch - aim.pitch, (Math.asin(near.aimRadius / a.dist) * 180) / Math.PI, t === near);
    }
  }

  override onShot(s: ShotResult): void {
    this.shots++;
    if (s.figure) this.hits++;
  }

  override onKill(): void {
    this.kills++;
    this.respawn.push(0.6);
  }

  report(): DrillReport {
    return {
      id: this.id,
      title: this.title,
      score: Math.round((this.shots ? this.hits / this.shots : 0) * 100),
      stats: [
        { label: 'Sensitivity (live)', value: this.g.sens.toFixed(2) },
        { label: 'Shot accuracy', value: pct(this.shots ? this.hits / this.shots : 0), unit: '%' },
        { label: 'Eliminations', value: String(this.kills) },
      ],
      notes: [],
      data: { sens: this.g.sens },
    };
  }
}

/** Protractor — verify cm/360 and your mouse's real DPI with a ruler. No targets, no weapon. */
export class ProtractorDrill extends Drill {
  readonly id = 'protractor';
  readonly title = 'Protractor';
  override kicker = 'INSTRUMENT';
  override weapon = null;
  override allowMove = false;
  override duration = Infinity;
  private startYaw = 0;
  private hudT = 0;

  setup(): void {
    this.g.hud.setPhase('Sweep right along a ruler · R = zero · ENTER = done');
  }

  override begin(): void {
    this.zero();
  }

  private zero(): void {
    this.startYaw = this.g.aimAngles().yaw;
    this.g.input.countsX = 0;
    this.g.input.countsY = 0;
  }

  override onKey(code: string): void {
    if (code === 'KeyR') this.zero();
    if (code === 'Enter' || code === 'NumpadEnter') this.done = true;
  }

  override update(dt: number): void {
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.05;
    const rot = this.g.aimAngles().yaw - this.startYaw;
    const { dpi } = store.settings;
    const counts = this.g.input.countsX;
    this.g.hud.setStats([
      { k: 'ROTATION', v: `${rot.toFixed(1)}°`, tone: Math.abs(Math.abs(rot) - 360) < 1 ? 'good' : '' },
      { k: 'COUNTS', v: String(counts) },
      { k: `@${dpi} DPI`, v: `${((Math.abs(counts) / dpi) * 2.54).toFixed(2)} cm` },
      { k: 'PREDICTED 360', v: `${cmPer360(this.g.sens, dpi).toFixed(2)} cm` },
    ]);
  }

  report(): DrillReport {
    const rot = this.g.aimAngles().yaw - this.startYaw;
    return {
      id: this.id,
      title: this.title,
      score: 0,
      stats: [
        { label: 'Rotation', value: rot.toFixed(1), unit: '°' },
        { label: 'Mouse counts', value: String(this.g.input.countsX) },
      ],
      notes: [],
      data: { rotation: rot, counts: this.g.input.countsX },
    };
  }
}
