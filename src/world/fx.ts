import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { PALETTE } from './palette';

const MAX_P = 700;
const UP = new Vector3(0, 1, 0);

/** Cheap pooled effects: one draw call for all sparks, small pools for tracers and rings. */
export class Fx {
  private readonly pos = new Float32Array(MAX_P * 3);
  private readonly col = new Float32Array(MAX_P * 3);
  private readonly size = new Float32Array(MAX_P);
  private readonly alpha = new Float32Array(MAX_P);
  private readonly vel = new Float32Array(MAX_P * 3);
  private readonly life = new Float32Array(MAX_P);
  private readonly maxLife = new Float32Array(MAX_P);
  private cursor = 0;
  private readonly geo = new BufferGeometry();
  private readonly tracers: { mesh: Mesh; t: number }[] = [];
  private readonly rings: { mesh: Mesh; t: number; max: number }[] = [];

  constructor(scene: Scene) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * (300.0 / max(-mv.z, 0.1));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a * 1.6, a);
        }
      `,
    });
    const pts = new Points(this.geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);

    const tracerGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 16; i++) {
      const mesh = new Mesh(
        tracerGeo,
        new MeshBasicMaterial({ color: new Color('#ffd9c2'), transparent: true, blending: AdditiveBlending, depthWrite: false }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 1 });
    }
    const ringGeo = new RingGeometry(0.92, 1, 64);
    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(
        ringGeo,
        new MeshBasicMaterial({ color: PALETTE.signal, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 1, max: 0.5 });
    }
  }

  private emit(p: Vector3, v: Vector3, color: Color, size: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_P;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
  }

  sparks(at: Vector3, color: Color = PALETTE.targetRim, count = 10, speed = 3.5): void {
    const v = new Vector3();
    for (let n = 0; n < count; n++) {
      v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.emit(at, v, color, 0.05 + Math.random() * 0.05, 0.18 + Math.random() * 0.22);
    }
  }

  burst(at: Vector3, color: Color = PALETTE.signal): void {
    const v = new Vector3();
    for (let n = 0; n < 60; n++) {
      v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 6);
      this.emit(at, v, n % 3 ? color : PALETTE.targetRim, 0.06 + Math.random() * 0.08, 0.35 + Math.random() * 0.5);
    }
    this.ring(new Vector3(at.x, 0.04, at.z));
  }

  ring(at: Vector3, max = 2.6): void {
    const r = this.rings.find((x) => x.t >= 1) ?? this.rings[0];
    r.t = 0;
    r.max = max;
    r.mesh.position.copy(at);
    r.mesh.visible = true;
  }

  tracer(from: Vector3, to: Vector3, width = 0.012): void {
    const tr = this.tracers.find((x) => x.t >= 1) ?? this.tracers[0];
    const d = to.clone().sub(from);
    const len = d.length();
    tr.mesh.position.copy(from);
    tr.mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, d.normalize()));
    tr.mesh.scale.set(width, len, width);
    tr.mesh.visible = true;
    tr.t = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= 9 * dt;
      this.vel[k] *= 1 - 2.2 * dt;
      this.vel[k + 2] *= 1 - 2.2 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] = Math.max(0.02, this.pos[k + 1] + this.vel[k + 1] * dt);
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as BufferAttribute).needsUpdate = true;

    for (const tr of this.tracers) {
      if (tr.t >= 1) continue;
      tr.t += dt / 0.07;
      const m = tr.mesh.material as MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - tr.t) * 0.9;
      if (tr.t >= 1) tr.mesh.visible = false;
    }
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t += dt / 0.45;
      const e = 1 - (1 - Math.min(1, r.t)) ** 3;
      r.mesh.scale.setScalar(0.2 + e * r.max);
      (r.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 1 - r.t) * 0.8;
      if (r.t >= 1) r.mesh.visible = false;
    }
  }
}
