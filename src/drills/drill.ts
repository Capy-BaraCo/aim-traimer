import type { Game, ShotResult, WeaponSpec } from '../core/game';
import type { Figure } from '../world/figure';

export interface ReportStat {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}

export interface DrillReport {
  id: string;
  title: string;
  /** 0–100, comparable across runs of the same drill. */
  score: number;
  stats: ReportStat[];
  /** Coach notes generated from the numbers. */
  notes: string[];
  /** Drill-specific payload (e.g. PSA trial metrics). */
  data?: unknown;
}

export abstract class Drill {
  abstract readonly id: string;
  abstract readonly title: string;
  kicker = 'DRILL';
  weapon: WeaponSpec | null = null;
  allowMove = true;
  duration = 30;
  elapsed = 0;
  done = false;
  /** Facing when the drill starts (bearing, degrees). */
  startBearing = 0;

  constructor(protected readonly g: Game) {}

  /** Spawn figures, set weapon. Runs before the countdown. */
  abstract setup(): void;
  /** The clock starts. */
  begin(): void {}
  update(_dt: number): void {}
  onShot(_shot: ShotResult): void {}
  onKill(_f: Figure): void {}
  onKey(_code: string): void {}
  /** Return false to make hits register visually but deal no damage (e.g. "only while moving"). */
  damageEnabled(): boolean {
    return true;
  }
  abstract report(): DrillReport;
  teardown(): void {
    this.g.clearFigures();
  }
}

export const pct = (x: number): string => `${Math.round(x * 100)}`;
export const ms = (x: number): string => (Number.isFinite(x) && x > 0 ? `${Math.round(x)}` : '—');
