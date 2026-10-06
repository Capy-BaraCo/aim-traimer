/** Style presets for Overdrive (D7, D8, V5). */
import type { Preset, PresetId } from './types';

/** The sole selectable Style preset: V5's section matrix and flick shape split. */
export const MIXED: Preset = {
  id: 'mixed',
  name: 'Mixed',
  rows: {
    intro: {
      weights: { flick: 0.50, burst: 0, strafer: 0.20, hold: 0.30, peeker: 0, decoy: 0 },
      perBar: { from: 1, to: 1 },
    },
    calm: {
      weights: { flick: 0.30, burst: 0, strafer: 0.20, hold: 0.30, peeker: 0.20, decoy: 0 },
      perBar: { from: 2, to: 2 },
    },
    build: {
      weights: { flick: 0.35, burst: 0.20, strafer: 0.15, hold: 0, peeker: 0.20, decoy: 0.10 },
      perBar: { from: 2, to: 4 },
    },
    peak: {
      weights: { flick: 0.30, burst: 0.25, strafer: 0.20, hold: 0.05, peeker: 0.10, decoy: 0.10 },
      perBar: { from: 4, to: 4 },
    },
    outro: {
      weights: { flick: 0.30, burst: 0, strafer: 0.30, hold: 0.40, peeker: 0, decoy: 0 },
      perBar: { from: 1, to: 1 },
    },
  },
  flickShapes: { circle: 0.50, diamond: 0.25, triangle: 0.25 },
};

/** Style presets offered by the Song picker. */
export const PRESETS: readonly Preset[] = [MIXED];

/** Find a Style preset by its id. */
export function presetById(id: PresetId): Preset {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown Style preset: ${id}`);
  return preset;
}
