import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Box, rayCapsule, raySphere } from '../src/world/collide';
import { Mover, OW, type MoveIntent } from '../src/world/movement';

const idle: MoveIntent = { forward: 0, right: 0, jump: false, crouch: false, yaw: 0 };
const run = (m: Mover, intent: Partial<MoveIntent>, seconds: number, h = 1 / 144) => {
  for (let t = 0; t < seconds - 1e-9; t += h) m.step(h, { ...idle, ...intent });
};

describe('Overwatch locomotion', () => {
  it('runs forward at 5.5 m/s with instant acceleration', () => {
    const m = new Mover([], 100);
    m.step(1 / 144, { ...idle, forward: 1 });
    expect(m.horizontalSpeed).toBeCloseTo(OW.speed, 6);
    run(m, { forward: 1 }, 1);
    expect(-m.pos.z).toBeCloseTo(5.5 + 5.5 / 144, 2);
  });

  it('stops dead the moment keys are released', () => {
    const m = new Mover([], 100);
    run(m, { right: 1 }, 0.5);
    m.step(1 / 144, idle);
    expect(m.horizontalSpeed).toBe(0);
  });

  it('normalises diagonals (no faster strafe-running)', () => {
    const m = new Mover([], 100);
    run(m, { forward: 1, right: 1 }, 0.2);
    expect(m.horizontalSpeed).toBeCloseTo(5.5, 6);
  });

  it('backpedals at 90% speed', () => {
    const m = new Mover([], 100);
    run(m, { forward: -1 }, 0.2);
    expect(m.horizontalSpeed).toBeCloseTo(4.95, 6);
  });

  it('crouch-walks at 3 m/s', () => {
    const m = new Mover([], 100);
    run(m, { right: 1, crouch: true }, 0.2);
    expect(m.horizontalSpeed).toBeCloseTo(3, 6);
  });

  it('jumps ~0.94 m high and stays airborne ~0.66 s', () => {
    const m = new Mover([], 100);
    m.step(1 / 240, { ...idle, jump: true });
    let apex = 0;
    let t = 1 / 240;
    while (!m.onGround && t < 3) {
      m.step(1 / 240, idle);
      apex = Math.max(apex, m.pos.y);
      t += 1 / 240;
    }
    expect(apex).toBeGreaterThan(0.9);
    expect(apex).toBeLessThan(0.98);
    expect(t).toBeGreaterThan(0.6);
    expect(t).toBeLessThan(0.72);
  });

  it('re-jumps on landing while jump is held', () => {
    const m = new Mover([], 100);
    let jumps = 0;
    for (let t = 0; t < 2; t += 1 / 144) {
      m.step(1 / 144, { ...idle, jump: true });
      if (m.jumped) jumps++;
    }
    expect(jumps).toBeGreaterThanOrEqual(3);
  });

  it('keeps momentum in the air when keys are released', () => {
    const m = new Mover([], 100);
    run(m, { right: 1 }, 0.1);
    m.step(1 / 144, { ...idle, right: 1, jump: true });
    run(m, {}, 0.2);
    expect(m.onGround).toBe(false);
    expect(m.horizontalSpeed).toBeCloseTo(5.5, 3);
  });

  it('collides with cover and can hop onto a 0.7 m plinth', () => {
    const plinth = new Box(new Vector3(0, 0.35, -3), new Vector3(1, 0.35, 1));
    const m = new Mover([plinth], 100);
    run(m, { forward: 1 }, 1);
    expect(m.pos.z).toBeGreaterThan(-2 + 0.36 - 0.01); // stopped at the face
    run(m, { forward: 1, jump: true }, 0.25);
    run(m, { forward: 1 }, 0.4);
    expect(m.pos.y).toBeCloseTo(0.7, 3);
  });
});

describe('hit maths', () => {
  const o = new Vector3(0, 1.65, 0);
  const d = new Vector3(0, 0, -1);

  it('hits a sphere head-on', () => {
    expect(raySphere(o, d, new Vector3(0, 1.65, -10), 0.2)).toBeCloseTo(9.8, 6);
    expect(raySphere(o, d, new Vector3(0.25, 1.65, -10), 0.2)).toBe(Infinity);
  });

  it('hits a capsule body and its caps', () => {
    const a = new Vector3(0, 0.5, -10);
    const b = new Vector3(0, 1.12, -10);
    const low = new Vector3(0, 0.8, 0);
    expect(rayCapsule(low, d, a, b, 0.36)).toBeCloseTo(9.64, 6);
    // Grazing the top cap: y = 1.12 + 0.3
    const top = new Vector3(0, 1.42, 0);
    expect(rayCapsule(top, d, a, b, 0.36)).toBeLessThan(10);
    const over = new Vector3(0, 1.5, 0);
    expect(rayCapsule(over, d, a, b, 0.36)).toBe(Infinity);
  });

  it('respects rotated boxes', () => {
    const box = new Box(new Vector3(0, 1, -10), new Vector3(2, 1, 0.25), Math.PI / 2);
    // Rotated 90°: now thin along x, long along z.
    expect(box.ray(new Vector3(1, 1, -10), new Vector3(-1, 0, 0))).toBeCloseTo(0.75, 6);
    expect(box.ray(new Vector3(0, 1, 0), new Vector3(0, 0, -1))).toBeCloseTo(8, 6);
  });
});
