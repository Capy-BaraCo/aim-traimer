import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bearingXZ } from '../src/world/arena';
import { Box } from '../src/world/collide';
import {
  beatFlash,
  beatPosition,
  GRID_CELL,
  gridOffset,
  restoreColliders,
  swapColliders,
  wallBox,
} from '../src/world/synthwave';

// Deliberately uneven spacing: the floor must lock to these, not to a BPM.
const beats = [1, 1.5, 2.1, 2.4, 3.4, 3.9];

describe('beat phase (grid scroll)', () => {
  it('moves exactly one cell per beat across uneven spacing', () => {
    for (let i = 0; i + 1 < beats.length; i++) {
      expect(gridOffset(beats, beats[i + 1] - 1e-9) - gridOffset(beats, beats[i])).toBeCloseTo(GRID_CELL, 6);
      expect(gridOffset(beats, beats[i])).toBeCloseTo(i * GRID_CELL, 9);
    }
  });

  it('is linear inside a beat and continuous across boundaries', () => {
    expect(beatPosition(beats, 1.25)).toBeCloseTo(0.5, 9);
    expect(beatPosition(beats, 2.25)).toBeCloseTo(2.5, 9);
    for (const b of beats.slice(1, -1)) {
      expect(Math.abs(beatPosition(beats, b + 1e-7) - beatPosition(beats, b - 1e-7))).toBeLessThan(1e-5);
    }
  });

  it('extrapolates with the nearest interval before the first and after the last beat', () => {
    expect(beatPosition(beats, 0.75)).toBeCloseTo(-0.5, 9);
    expect(beatPosition(beats, 4.4)).toBeCloseTo(6, 9);
    expect(beatPosition(beats, 4.15)).toBeCloseTo(5.5, 9);
  });

  it('does not scroll with an empty or single-beat list', () => {
    expect(beatPosition([], 5)).toBe(0);
    expect(beatPosition([2], 5)).toBe(0);
    expect(beatFlash([], 5)).toBe(0);
  });

  it('survives duplicate beat times', () => {
    expect(Number.isFinite(beatPosition([1, 1, 2], 1))).toBe(true);
    expect(Number.isFinite(beatPosition([1, 2, 2], 3))).toBe(true);
  });
});

describe('beat flash', () => {
  it('peaks on the beat and has decayed before the next one', () => {
    for (let i = 0; i + 1 < beats.length; i++) {
      const gap = beats[i + 1] - beats[i];
      expect(beatFlash(beats, beats[i])).toBeCloseTo(1, 9);
      expect(beatFlash(beats, beats[i] + 0.3 * gap)).toBeGreaterThan(0);
      expect(beatFlash(beats, beats[i + 1] - 0.3 * gap)).toBe(0);
    }
  });
});

describe('chart wall colliders', () => {
  it('places a wall at its bearing and distance, facing the spawn', () => {
    const box = wallBox({ bearing: 30, distance: 14, width: 3.6, height: 3 });
    const { x, z } = bearingXZ(30, 14);
    expect(box.center.x).toBeCloseTo(x, 9);
    expect(box.center.z).toBeCloseTo(z, 9);
    expect(box.center.y).toBeCloseTo(1.5, 9);
    expect(box.half.x).toBeCloseTo(1.8, 9);
    // A shot from the spawn along that bearing hits the wall face, short of the centre.
    const d = new Vector3(Math.sin(Math.PI / 6), 0, -Math.cos(Math.PI / 6));
    const t = box.ray(new Vector3(0, 1.5, 0), d);
    expect(t).toBeGreaterThan(13.5);
    expect(t).toBeLessThan(14);
  });

  it('swaps colliders in place, keeps the same array object, and restores them', () => {
    const pillar = new Box(new Vector3(0, 1, -10), new Vector3(1, 1, 1));
    const live: Box[] = [pillar];
    const held = live; // what a Mover keeps
    const wall = wallBox({ bearing: 40, distance: 12, width: 3, height: 3 });
    const o = new Vector3(0, 1.5, 0);
    const ahead = new Vector3(0, 0, -1);
    const toWall = new Vector3(Math.sin((40 * Math.PI) / 180), 0, -Math.cos((40 * Math.PI) / 180));
    expect(Math.min(...live.map((b) => b.ray(o, ahead)))).toBeCloseTo(9, 6);

    const stash = swapColliders(live, [wall]);
    expect(live).toBe(held);
    expect(live).toEqual([wall]);
    expect(stash).toEqual([pillar]);
    expect(Math.min(...live.map((b) => b.ray(o, ahead)))).toBe(Infinity); // the pillar no longer blocks
    expect(Math.min(...live.map((b) => b.ray(o, toWall)))).toBeLessThan(12); // the wall does

    restoreColliders(live, stash);
    expect(live).toBe(held);
    expect(live).toEqual([pillar]);
  });
});
