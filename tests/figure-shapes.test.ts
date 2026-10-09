import { Camera, Raycaster, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Figure } from '../src/world/figure';

/** The ray test must agree with three's own ray test against the drawn mesh: that is "hit where it is drawn". */
function build(shape: 'sphere' | 'diamond' | 'triangle', yaw: number, roll: number): { f: Figure; mesh: Mesh } {
  const f = new Figure('orb', [], 80);
  f.orbRadius = 0.8;
  f.mover.teleport(2, 3, -12);
  f.setOrbShape(shape);
  f.setOrbPose(yaw, roll);
  f.update(1, 0, new Camera()); // lays the group, the head and its scale out
  f.group.updateMatrixWorld(true);
  return { f, mesh: f.group.children[0] as Mesh };
}

function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('orb shapes are hit where they are drawn', () => {
  for (const [shape, yaw, roll] of [
    ['diamond', 0, 0],
    ['diamond', 0.5, 0],
    ['triangle', 0.3, 0],
    ['triangle', 0.3, -Math.PI / 2],
    ['triangle', -0.4, Math.PI / 2],
  ] as const) {
    it(`${shape} (yaw ${yaw}, roll ${roll.toFixed(2)}) agrees with the mesh`, () => {
      const { f, mesh } = build(shape, yaw, roll);
      const rand = rng(7);
      const eye = new Vector3(0, 1.6, 0);
      const ray = new Raycaster();
      let hits = 0;
      let disagree = 0;
      for (let i = 0; i < 4000; i++) {
        // Aim at a random point within 1.5 radii of the centre, so many rays graze the edge.
        const at = f.position.clone().add(new Vector3((rand() - 0.5) * 3, (rand() - 0.5) * 3, (rand() - 0.5) * 0.5).multiplyScalar(f.orbRadius));
        const dir = at.sub(eye).normalize();
        ray.set(eye, dir);
        const drawn = ray.intersectObject(mesh, false).length > 0;
        const mine = f.ray(eye, dir) !== null;
        if (drawn) hits++;
        if (drawn !== mine) disagree++;
      }
      expect(hits).toBeGreaterThan(300);
      // Allow a hair of float noise exactly on an edge.
      expect(disagree).toBeLessThanOrEqual(4);
    });
  }

  it('a diamond misses the corner of its bounding circle', () => {
    const { f } = build('diamond', 0, 0);
    const eye = new Vector3(0, 3, 0);
    const toward = (dx: number, dy: number) => f.position.clone().add(new Vector3(dx, dy, 0)).sub(eye).normalize();
    // Face-on the diamond is a rhombus: the middle of an edge is inside, a diagonal point at 0.9 r is outside.
    expect(f.ray(eye, toward(0.3 * 0.8, 0))).not.toBeNull();
    expect(f.ray(eye, toward(0.62 * 0.8, 0.62 * 0.8))).toBeNull();
  });
});
