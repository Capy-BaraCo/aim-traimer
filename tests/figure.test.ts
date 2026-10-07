import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Figure, HB } from '../src/world/figure';

/** A bear standing 10 m straight ahead of an eye at head height. */
function bear() {
  const f = new Figure('humanoid', [], 100);
  f.mover.teleport(0, 0, -10);
  return f;
}
const EYE = new Vector3(0, 1.65, 0);
const toward = (x: number, y: number, z = -10) => new Vector3(x, y, z).sub(EYE).normalize();

describe('bear hitbox', () => {
  it('head and body register as before', () => {
    const f = bear();
    expect(f.ray(EYE, toward(0, HB.headY))?.part).toBe('head');
    expect(f.ray(EYE, toward(0, 0.9))?.part).toBe('body');
    expect(f.ray(EYE, toward(0, 2.2))).toBeNull();
  });

  it('arms count as body, on whichever side you see them', () => {
    const f = bear();
    const midX = (HB.armTop[0] + HB.armBot[0]) / 2;
    const midY = (HB.armTop[1] + HB.armBot[1]) / 2;
    expect(f.ray(EYE, toward(midX, midY))?.part).toBe('body');
    expect(f.ray(EYE, toward(-midX, midY))?.part).toBe('body');
    // Just outside the paw is a miss.
    expect(f.ray(EYE, toward(HB.armBot[0] + HB.armR + 0.08, HB.armBot[1]))).toBeNull();
  });

  it('arms follow the shooter round the bear', () => {
    const f = bear();
    // From the side (eye at +x), the arms are now in front of and behind the body.
    const side = new Vector3(10, 1.65, -10);
    const d = new Vector3(0, 1.06, -10 - 0.42).sub(side).normalize();
    // The ray passes the body's edge at the arm's depth: it hits the near arm/body, not nothing.
    expect(f.ray(side, d)?.part).toBe('body');
  });
});
