/** Pure Judgement and scoring for an Overdrive Chart. */
import { levelParams } from './levels';
import type {
  BurstTarget, Chart, ChartTarget, DecoyTarget, FlickShape, FlickTarget,
  HoldTarget, PeekerTarget, StraferTarget, TargetKind,
} from './types';

/** Glossary: Judgement of a tap or burst orb against its Target beat and Hit window. */
export type Judgement = 'perfect' | 'early' | 'late' | 'miss';

/** A Judgement and signed milliseconds from the Target beat (negative is early). */
export interface JudgeResult {
  judgement: Judgement;
  offsetMs: number;
}

/** Judge a click against an inclusive Hit window and Perfect width in milliseconds. */
export function judgeAt(
  clickTime: number, targetTime: number, windowStart: number, windowEnd: number,
  perfectMs: number,
): JudgeResult {
  const offsetMs = (clickTime - targetTime) * 1000;
  if (clickTime < windowStart || clickTime > windowEnd) return { judgement: 'miss', offsetMs };
  if (Math.abs(offsetMs) <= perfectMs) return { judgement: 'perfect', offsetMs };
  return { judgement: offsetMs < 0 ? 'early' : 'late', offsetMs };
}

/** Judge a click using a Target's Hit window and the Level's Perfect width. */
export function judge(clickTime: number, target: ChartTarget, level: number): JudgeResult {
  return judgeAt(clickTime, target.targetTime, target.landTime, target.windowEnd,
    levelParams(level).perfectMs);
}

/** Judge one burst orb; its window opens at landing or the previous orb's beat, so callers resolve orbs in order. */
export function judgeOrb(
  clickTime: number, burst: BurstTarget, orbIndex: number, level: number,
): JudgeResult {
  const orb = burst.orbs[orbIndex];
  if (!orb) throw new RangeError(`Invalid burst orb index: ${orbIndex}`);
  const start = orbIndex === 0 ? burst.landTime : burst.orbs[orbIndex - 1].time;
  return judgeAt(clickTime, orb.time, start, burst.windowEnd, levelParams(level).perfectMs);
}

/** Final score and Judgement, timing, hit-rate and combo statistics for a Chart. */
export interface ScoreResult {
  score: number;
  points: number;
  maxPoints: number;
  maxCombo: number;
  /** Tap and orb Judgements only; tracking success has no timing Judgement. */
  counts: Record<Judgement, number>;
  meanOffsetMs: number;
  offsets: number[];
  hitRate: Partial<Record<TargetKind, number>>;
  hitRateByShape: Partial<Record<FlickShape, number>>;
  decoysHit: number;
}

type TapTarget = FlickTarget | PeekerTarget;
type TrackingTarget = StraferTarget | HoldTarget;
type RateCount = { hits: number; judged: number };

function multiplierFor(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 8));
}

function perfectPoints(target: TapTarget | BurstTarget): number {
  return target.kind === 'flick' && target.shape === 'diamond' ? 150 : 100;
}

function chartMaxPoints(chart: Chart): number {
  const events: { time: number; points: number; comboGain: number }[] = [];
  for (const target of chart.targets) {
    switch (target.kind) {
      case 'flick':
      case 'peeker':
        events.push({ time: target.targetTime, points: perfectPoints(target), comboGain: 2 });
        break;
      case 'burst':
        for (const orb of target.orbs) {
          events.push({ time: orb.time, points: 100, comboGain: 2 });
        }
        break;
      case 'strafer':
      case 'hold':
        events.push({ time: target.targetTime, points: 100, comboGain: 1 });
        break;
      case 'decoy':
        break;
    }
  }
  events.sort((a, b) => a.time - b.time);
  let combo = 0;
  let points = 0;
  for (const event of events) {
    combo += event.comboGain;
    points += event.points * multiplierFor(combo);
  }
  return points;
}

/** Accumulate target outcomes and compute the 0–100 result against a perfect Chart run. */
export class ScoreTally {
  private comboValue = 0;
  private maxComboValue = 0;
  private pointsValue = 0;
  private readonly maxPointsValue: number;
  private readonly countsValue: Record<Judgement, number> =
    { perfect: 0, early: 0, late: 0, miss: 0 };
  private readonly offsetsValue: number[] = [];
  private readonly kindRates: Partial<Record<TargetKind, RateCount>> = {};
  private readonly shapeRates: Partial<Record<FlickShape, RateCount>> = {};
  private decoysHitValue = 0;

  /** Prepare the ideal score for this Chart before recording outcomes. */
  constructor(chart: Chart) {
    this.maxPointsValue = chartMaxPoints(chart);
  }

  /** Current combo points after the latest target outcome. */
  get combo(): number { return this.comboValue; }

  /** Current ×1–×4 multiplier after the latest target outcome. */
  get multiplier(): number { return multiplierFor(this.comboValue); }

  private advance(judgement: Judgement): void {
    this.comboValue = judgement === 'miss' ? 0 : this.comboValue + (judgement === 'perfect' ? 2 : 1);
    this.maxComboValue = Math.max(this.maxComboValue, this.comboValue);
  }

  private rate(rates: Partial<Record<TargetKind | FlickShape, RateCount>>, key: TargetKind | FlickShape,
    hit: boolean): void {
    const count = rates[key] ?? { hits: 0, judged: 0 };
    count.judged++;
    if (hit) count.hits++;
    rates[key] = count;
  }

  private recordTap(kind: 'flick' | 'peeker' | 'burst', shape: FlickShape | undefined,
    result: JudgeResult, perfect: number): void {
    const { judgement, offsetMs } = result;
    this.countsValue[judgement]++;
    this.advance(judgement);
    const hit = judgement !== 'miss';
    this.rate(this.kindRates, kind, hit);
    if (shape) this.rate(this.shapeRates, shape, hit);
    if (hit) {
      this.offsetsValue.push(offsetMs);
      this.pointsValue += (judgement === 'perfect' ? perfect : 50) * this.multiplier;
    }
  }

  /** Record one flick or peeker tap and its timing Judgement. */
  tap(target: TapTarget, result: JudgeResult): void {
    this.recordTap(target.kind, target.kind === 'flick' ? target.shape : undefined,
      result, perfectPoints(target));
  }

  /** Record one burst orb, which contributes separately to points and hit rate. */
  orb(burst: BurstTarget, orbIndex: number, result: JudgeResult): void {
    if (!burst.orbs[orbIndex]) throw new RangeError(`Invalid burst orb index: ${orbIndex}`);
    this.recordTap('burst', undefined, result, 100);
  }

  /** Record the fraction of a strafer or hold's life tracked while firing. */
  tracking(target: TrackingTarget, fraction: number): void {
    const share = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    const hit = share >= 0.3;
    this.advance(hit ? 'early' : 'miss');
    this.rate(this.kindRates, target.kind, hit);
    this.pointsValue += 100 * share * this.multiplier;
  }

  /** Reset combo and subtract 150 unmultiplied points for shooting a decoy. */
  decoyHit(_target: DecoyTarget): void {
    this.comboValue = 0;
    this.pointsValue -= 150;
    this.decoysHitValue++;
  }

  /** Record an expired, unhit flick, peeker or burst orb as a Miss. */
  miss(target: TapTarget): void;
  miss(target: BurstTarget, orbIndex: number): void;
  miss(target: TapTarget | BurstTarget, orbIndex?: number): void {
    if (target.kind === 'burst') {
      if (orbIndex === undefined) throw new RangeError('Burst Miss requires an orb index');
      this.orb(target, orbIndex, { judgement: 'miss', offsetMs: 0 });
    } else {
      this.tap(target, { judgement: 'miss', offsetMs: 0 });
    }
  }

  /** Return a snapshot of the 0–100 score and all recorded statistics. */
  result(): ScoreResult {
    const hitRate: ScoreResult['hitRate'] = {};
    const hitRateByShape: ScoreResult['hitRateByShape'] = {};
    for (const [kind, count] of Object.entries(this.kindRates)) {
      hitRate[kind as TargetKind] = count.hits / count.judged;
    }
    for (const [shape, count] of Object.entries(this.shapeRates)) {
      hitRateByShape[shape as FlickShape] = count.hits / count.judged;
    }
    const score = this.maxPointsValue === 0
      ? (this.decoysHitValue === 0 ? 100 : 0)
      : Math.max(0, Math.min(100, 100 * this.pointsValue / this.maxPointsValue));
    return {
      score, points: this.pointsValue, maxPoints: this.maxPointsValue,
      maxCombo: this.maxComboValue, counts: { ...this.countsValue },
      meanOffsetMs: this.offsetsValue.length
        ? this.offsetsValue.reduce((sum, offset) => sum + offset, 0) / this.offsetsValue.length : 0,
      offsets: [...this.offsetsValue], hitRate, hitRateByShape,
      decoysHit: this.decoysHitValue,
    };
  }
}
