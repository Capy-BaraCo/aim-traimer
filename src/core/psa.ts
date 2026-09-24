/**
 * PSA — "Perfect Sensitivity Approximation".
 *
 * The community's standard way to find a sensitivity is a binary search over *feel*:
 *   1. Take your current sens as the base. Test base×0.5 and base×1.5.
 *   2. Keep the one that felt better. The one you rejected is replaced by the midpoint of the pair.
 *   3. Repeat. Each round halves the window; after 7 rounds it is base/128 wide.
 *
 * Samples are shown blind (α / β, random order) so the number on screen can't bias the choice.
 */

export type Side = 'low' | 'high';

export interface PsaStep {
  round: number;
  low: number;
  high: number;
  /** Which side was presented as sample α (β is the other one). */
  alpha: Side;
  picked?: Side;
}

export interface PsaState {
  base: number;
  spread: number;
  rounds: number;
  low: number;
  high: number;
  steps: PsaStep[];
}

export function createPsa(base: number, rounds = 7, spread = 0.5, rng: () => number = Math.random): PsaState {
  if (!(base > 0)) throw new Error('PSA base sensitivity must be positive');
  const low = base * (1 - spread);
  const high = base * (1 + spread);
  return {
    base,
    spread,
    rounds,
    low,
    high,
    steps: [{ round: 1, low, high, alpha: rng() < 0.5 ? 'low' : 'high' }],
  };
}

export const currentStep = (s: PsaState): PsaStep => s.steps[s.steps.length - 1];

export const isDone = (s: PsaState): boolean => s.steps.length === s.rounds && currentStep(s).picked !== undefined;

export const sideOf = (step: PsaStep, sample: 'alpha' | 'beta'): Side =>
  sample === 'alpha' ? step.alpha : step.alpha === 'low' ? 'high' : 'low';

export const sensOf = (step: PsaStep, sample: 'alpha' | 'beta'): number =>
  sideOf(step, sample) === 'low' ? step.low : step.high;

/** Record a choice and advance. Returns a new state; the input is not mutated. */
export function pick(s: PsaState, side: Side, rng: () => number = Math.random): PsaState {
  if (isDone(s)) return s;
  const steps = s.steps.map((st) => ({ ...st }));
  const step = steps[steps.length - 1];
  step.picked = side;
  const mid = (step.low + step.high) / 2;
  const low = side === 'low' ? step.low : mid;
  const high = side === 'low' ? mid : step.high;
  if (steps.length < s.rounds) {
    steps.push({ round: steps.length + 1, low, high, alpha: rng() < 0.5 ? 'low' : 'high' });
  }
  return { ...s, low, high, steps };
}

/** Step back one decision (misclick insurance). */
export function undo(s: PsaState, rng: () => number = Math.random): PsaState {
  const steps = s.steps.map((st) => ({ ...st }));
  const last = steps[steps.length - 1];
  if (last.picked !== undefined) {
    // Final round was decided: just clear it.
    last.picked = undefined;
  } else if (steps.length > 1) {
    steps.pop();
    const prev = steps[steps.length - 1];
    prev.picked = undefined;
    prev.alpha = rng() < 0.5 ? 'low' : 'high';
  } else {
    return s;
  }
  const cur = steps[steps.length - 1];
  return { ...s, low: cur.low, high: cur.high, steps };
}

/** Best estimate so far: the centre of the remaining window. */
export const estimate = (s: PsaState): number => (s.low + s.high) / 2;

/** Width of the remaining window relative to the base (1.0 = the original ±50% window). */
export const windowFraction = (s: PsaState): number => (s.high - s.low) / (s.base * 2 * s.spread);
