import { Vector3 } from 'three';

/**
 * Analytic collision + ray tests. Targets are literal capsules and spheres, so what you see is
 * exactly what you hit — no mesh raycasting, no tessellation error.
 */

export class Box {
  readonly center: Vector3;
  readonly half: Vector3;
  readonly yaw: number;
  private readonly c: number;
  private readonly s: number;

  constructor(center: Vector3, half: Vector3, yaw = 0) {
    this.center = center.clone();
    this.half = half.clone();
    this.yaw = yaw;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }

  get top(): number {
    return this.center.y + this.half.y;
  }
  get bottom(): number {
    return this.center.y - this.half.y;
  }

  /** World XZ → box-local XZ (inverse yaw rotation). */
  localXZ(x: number, z: number): [number, number] {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return [this.c * dx - this.s * dz, this.s * dx + this.c * dz];
  }

  private worldDirXZ(lx: number, lz: number): [number, number] {
    return [this.c * lx + this.s * lz, -this.s * lx + this.c * lz];
  }

  /** Horizontal push (world XZ) that separates a circle from this box, or null. */
  pushCircle(x: number, z: number, r: number): [number, number] | null {
    const [lx, lz] = this.localXZ(x, z);
    const hx = this.half.x;
    const hz = this.half.z;
    const cx = Math.max(-hx, Math.min(hx, lx));
    const cz = Math.max(-hz, Math.min(hz, lz));
    const ddx = lx - cx;
    const ddz = lz - cz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= r * r) return null;
    let px: number;
    let pz: number;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      px = (ddx / d) * (r - d);
      pz = (ddz / d) * (r - d);
    } else {
      // Centre is inside the box: leave through the nearest face.
      const ox = hx - Math.abs(lx) + r;
      const oz = hz - Math.abs(lz) + r;
      if (ox < oz) {
        px = Math.sign(lx || 1) * ox;
        pz = 0;
      } else {
        px = 0;
        pz = Math.sign(lz || 1) * oz;
      }
    }
    return this.worldDirXZ(px, pz);
  }

  overlapsCircleXZ(x: number, z: number, r: number): boolean {
    const [lx, lz] = this.localXZ(x, z);
    const cx = Math.max(-this.half.x, Math.min(this.half.x, lx));
    const cz = Math.max(-this.half.z, Math.min(this.half.z, lz));
    return (lx - cx) ** 2 + (lz - cz) ** 2 < r * r;
  }

  /** Ray distance to the box surface, or Infinity. */
  ray(o: Vector3, d: Vector3): number {
    const [ox, oz] = this.localXZ(o.x, o.z);
    const oy = o.y - this.center.y;
    const dx = this.c * d.x - this.s * d.z;
    const dz = this.s * d.x + this.c * d.z;
    const dy = d.y;
    let tmin = -Infinity;
    let tmax = Infinity;
    const axes: [number, number, number][] = [
      [ox, dx, this.half.x],
      [oy, dy, this.half.y],
      [oz, dz, this.half.z],
    ];
    for (const [oo, dd, h] of axes) {
      if (Math.abs(dd) < 1e-9) {
        if (oo < -h || oo > h) return Infinity;
      } else {
        let t1 = (-h - oo) / dd;
        let t2 = (h - oo) / dd;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return Infinity;
      }
    }
    if (tmax < 0) return Infinity;
    return tmin >= 0 ? tmin : 0;
  }
}

/** Ray vs sphere; d must be normalised. */
export function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  if (t >= 0) return t;
  const t2 = -b + sq;
  return t2 >= 0 ? 0 : Infinity;
}

const _ba = new Vector3();
const _oa = new Vector3();
const _p = new Vector3();

/** Ray vs capsule (segment a→b, radius r); d must be normalised. */
export function rayCapsule(o: Vector3, d: Vector3, a: Vector3, b: Vector3, r: number): number {
  _ba.subVectors(b, a);
  _oa.subVectors(o, a);
  const baba = _ba.dot(_ba);
  const bard = _ba.dot(d);
  const baoa = _ba.dot(_oa);
  const rdoa = d.dot(_oa);
  const oaoa = _oa.dot(_oa);
  const qa = baba - bard * bard;
  const qb = baba * rdoa - baoa * bard;
  const qc = baba * oaoa - baoa * baoa - r * r * baba;
  const h = qb * qb - qa * qc;
  if (h >= 0 && qa > 1e-12) {
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // Caps
  const tA = raySphere(o, d, a, r);
  const tB = raySphere(o, d, b, r);
  const t = Math.min(tA, tB);
  if (t === Infinity) {
    // Origin inside the cylinder body?
    const s = Math.max(0, Math.min(1, baoa / (baba || 1)));
    _p.copy(a).addScaledVector(_ba, s);
    if (_p.distanceToSquared(o) <= r * r) return 0;
  }
  return t;
}

/** Shortest distance between a point and a segment. */
export function pointSegmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  _ba.subVectors(b, a);
  _oa.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _oa.dot(_ba) / (_ba.dot(_ba) || 1)));
  _p.copy(a).addScaledVector(_ba, t);
  return _p.distanceTo(p);
}
