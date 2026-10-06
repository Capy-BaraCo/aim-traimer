import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/game';
import { keepsFrontal, spawnFlickOrb, spawnOrbWhere, spawnScreenOrb } from '../src/drills/common';

const EYE = new Vector3(0, 1.65, 0);
const WALL_Z = -10;

/** Minimal stand-in for Game: a 6 m wide wall 10 m straight ahead, nothing else. */
function fakeGame() {
  const spawned: { pos: Vector3; radius: number }[] = [];
  const wallDistance = (d: Vector3) => {
    if (d.z >= 0) return Infinity;
    const t = (WALL_Z - EYE.z) / d.z;
    const x = EYE.x + d.x * t;
    return Math.abs(x) < 3 ? t : Infinity;
  };
  const g = {
    eye: () => EYE.clone(),
    aimAngles: () => ({ yaw: 0, pitch: 0 }),
    aimDir: (out: Vector3) => out.set(0, 0, -1),
    wallDistance,
    engine: { camera: { fov: 70.53, aspect: 16 / 9 } },
    spawnOrb: (pos: Vector3, radius: number) => {
      spawned.push({ pos: pos.clone(), radius });
      return { pos, radius };
    },
  };
  return { g: g as unknown as Game, spawned, wallDistance };
}

const along = (p: Vector3) => p.clone().sub(EYE);

describe('orb placement', () => {
  it('pulls a blocked target in front of the wall and keeps its angular size', () => {
    const { g, spawned } = fakeGame();
    spawnOrbWhere(g, 0.2, 5, () => ({ dir: new Vector3(0, 0, -1), dist: 20 }));
    const { pos, radius } = spawned[0];
    const d = along(pos).length();
    expect(d).toBeLessThanOrEqual(10 - 1.2 + 1e-9);
    expect(radius / d).toBeCloseTo(0.2 / 20, 9);
  });

  it('prefers a clear line at full distance and size over a pulled-in one', () => {
    const { g, spawned } = fakeGame();
    let n = 0;
    const ahead = new Vector3(0, 0, -1);
    const clear = new Vector3(1, 0, -1).normalize();
    spawnOrbWhere(g, 0.2, 6, () => ({ dir: n++ < 3 ? ahead : clear, dist: 20 }));
    expect(along(spawned[0].pos).length()).toBeCloseTo(20, 6);
    expect(spawned[0].radius).toBe(0.2);
  });

  it('never leaves a flick target behind the wall', () => {
    const { g, spawned, wallDistance } = fakeGame();
    for (let i = 0; i < 300; i++) {
      spawnFlickOrb(g, 5, 60, 12, 24, 0.3);
      spawnScreenOrb(g, 3, 20, 12, 24, 0.25);
    }
    for (const { pos } of spawned) {
      const v = along(pos);
      const d = v.length();
      expect(d).toBeLessThan(wallDistance(v.normalize()));
    }
  });
});

describe('short flicks stay in front of you', () => {
  /** An open arena; the crosshair snaps onto every target, like a perfect player. */
  function chase(anchor?: { yaw: number; pitch: number; maxYaw: number; maxPitch: number }) {
    const aim = { yaw: 0, pitch: 0 };
    let worstYaw = 0;
    let worstPitch = 0;
    const g = {
      eye: () => EYE.clone(),
      aimAngles: () => ({ ...aim }),
      aimDir: (out: Vector3) => out.set(0, 0, -1),
      wallDistance: () => Infinity,
      engine: { camera: { fov: 70.53, aspect: 16 / 9 } },
      spawnOrb: (pos: Vector3) => {
        const d = pos.clone().sub(EYE).normalize();
        aim.yaw = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
        aim.pitch = (Math.asin(d.y) * 180) / Math.PI;
        worstYaw = Math.max(worstYaw, Math.abs(aim.yaw));
        worstPitch = Math.max(worstPitch, Math.abs(aim.pitch));
        return {};
      },
    } as unknown as Game;
    for (let i = 0; i < 400; i++) spawnScreenOrb(g, 8, 32, 11, 17, 0.2, anchor);
    return { worstYaw, worstPitch };
  }

  it('without an anchor, targets can walk you far round to the side', () => {
    expect(chase().worstYaw).toBeGreaterThan(60);
  });

  it('with an anchor, your view stays roughly frontal', () => {
    const r = chase({ yaw: 0, pitch: 0, maxYaw: 32, maxPitch: 19 });
    // Every target lands inside the window, so 400 flicks later you are still facing forward.
    expect(r.worstYaw).toBeLessThanOrEqual(32 + 1e-6);
    expect(r.worstPitch).toBeLessThanOrEqual(19 + 1e-6);
  });

  it('a target outside the window must bring you back toward home', () => {
    const a = { yaw: 0, pitch: 0, maxYaw: 20, maxPitch: 10 };
    expect(keepsFrontal(a, { yaw: 30, pitch: 0 }, 40, 0)).toBe(false);
    expect(keepsFrontal(a, { yaw: 30, pitch: 0 }, 25, 0)).toBe(true);
    expect(keepsFrontal(a, { yaw: 0, pitch: 0 }, 18, 5)).toBe(true);
  });
});
