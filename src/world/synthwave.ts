import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { FxLevel } from '../core/store';
import type { Wall } from '../rhythm/types';
import { bearingXZ } from './arena';
import { Box } from './collide';

/**
 * The Overdrive scene (D6): a retro sunset sky with a striped sun, mountains on the horizon and a
 * neon grid floor that scrolls one cell per beat and glows on the beat. Everything is driven by a
 * song-time getter and the beat list; nothing here knows about the drill or the audio engine.
 *
 * Look rules: the playable view (about ±35° bearing, −10..+15° pitch, 10–18 m out) stays dark and
 * uncluttered so neon targets read against it. The brightest things are the sun and the grid.
 */

export interface SynthwaveConfig {
  /** Seconds of song time (may be negative during a count-in). */
  songTime: () => number;
  /** Beat times in seconds of song time, ascending. */
  beats: number[];
  /** Chart walls: drawn in the scene and used as colliders. */
  walls: Wall[];
}

/** Grid cell size in metres: the floor moves exactly this far per beat. */
export const GRID_CELL = 2;
const WALL_THICKNESS = 0.7;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------ pure

/**
 * Continuous beat position: `i + fraction` where beats[i] <= t < beats[i+1]. Locked to the actual
 * beat times, so the floor follows the song even if its tempo drifts. Before the first beat and
 * after the last it extrapolates with the nearest beat interval (so it goes negative before beat 0).
 * Fewer than two beats means no tempo, so no scroll (0).
 */
export function beatPosition(beats: readonly number[], t: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  const frac = (from: number, to: number): number => (to > from ? (t - from) / (to - from) : 0);
  if (t < beats[0]) return frac(beats[0], beats[1]);
  if (t >= beats[n - 1]) return n - 1 + frac(beats[n - 1], 2 * beats[n - 1] - beats[n - 2]);
  // Last i with beats[i] <= t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + frac(beats[lo], beats[lo + 1]);
}

/** How far the grid has moved toward the player, in metres. One `GRID_CELL` per beat. */
export function gridOffset(beats: readonly number[], t: number, cell = GRID_CELL): number {
  return beatPosition(beats, t) * cell;
}

/** Flash level 1 → 0 across a beat: sharp attack on the beat, gone well before the next one. */
export function beatFlash(beats: readonly number[], t: number): number {
  if (beats.length < 2) return 0;
  const p = beatPosition(beats, t);
  const k = 1 - (p - Math.floor(p)) / 0.6;
  return k > 0 ? k * k : 0;
}

/** The collider for a chart wall: a slab facing the spawn, like the arena's peek fins. */
export function wallBox(w: Wall): Box {
  const { x, z } = bearingXZ(w.bearing, w.distance);
  return new Box(new Vector3(x, w.height / 2, z), new Vector3(w.width / 2, w.height / 2, WALL_THICKNESS / 2), -w.bearing * DEG);
}

/**
 * Swap the contents of `live` for `replacement` in place (never reassign: the player's and every
 * figure's Mover hold this same array). Returns what was there, to hand to `restoreColliders`.
 */
export function swapColliders(live: Box[], replacement: readonly Box[]): Box[] {
  const stash = live.splice(0, live.length, ...replacement);
  return stash;
}

export function restoreColliders(live: Box[], stash: readonly Box[]): void {
  live.splice(0, live.length, ...stash);
}

// ---------------------------------------------------------------------------------------- scene

const C = {
  zenith: new Color('#06021a'),
  mid: new Color('#22094f'),
  horizon: new Color('#c4206f'),
  floor: new Color('#05020f'),
  magenta: new Color('#ff2bd6'),
  cyan: new Color('#19e6ff'),
  sunTop: new Color('#ffb04a'),
  sunBottom: new Color('#ff2d95'),
  mountain: new Color('#0a0420'),
  mountainLit: new Color('#1b0a44'),
};

const SHADER_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export class Synthwave {
  readonly root = new Group();
  /** Colliders for the current chart's walls (empty when inactive). */
  readonly wallBoxes: Box[] = [];
  private cfg: SynthwaveConfig | null = null;
  private time = 0;

  private readonly sky: Mesh;
  private readonly floor: Mesh;
  private readonly mountains: Mesh;
  private readonly walls = new Group();
  private wallParts: { geo: BufferGeometry; edges: BufferGeometry }[] = [];
  private readonly wallFill = new MeshBasicMaterial({ color: '#0d0528' });
  private readonly wallEdge = new LineBasicMaterial({ color: C.cyan });

  private readonly uBeat = { value: 0 };
  private readonly uPhase = { value: 0 };
  private readonly uTime = { value: 0 };
  private readonly uSoft = { value: 0 };
  private readonly uCam = { value: new Vector3() };

  constructor(scene: Scene) {
    this.sky = this.buildSky();
    this.floor = this.buildFloor();
    this.mountains = this.buildMountains();
    this.root.add(this.sky, this.mountains, this.floor, this.walls);
    this.root.visible = false;
    scene.add(this.root);
  }

  get active(): boolean {
    return this.cfg !== null;
  }

  setFx(fx: FxLevel): void {
    // Bloom only exists at 'full'; without it the grid draws its own soft halo.
    this.uSoft.value = fx === 'full' ? 0 : 1;
    const mat = this.sky.material as ShaderMaterial;
    const stars = fx === 'full';
    if ((mat.defines.FX_STARS !== undefined) !== stars) {
      if (stars) mat.defines.FX_STARS = '';
      else delete mat.defines.FX_STARS;
      mat.needsUpdate = true;
    }
  }

  enter(cfg: SynthwaveConfig, fx: FxLevel): void {
    this.leave();
    this.cfg = cfg;
    this.setFx(fx);
    this.buildWalls(cfg.walls);
    this.root.visible = true;
    this.update(0, this.uCam.value);
  }

  leave(): void {
    this.cfg = null;
    this.root.visible = false;
    for (const p of this.wallParts) {
      p.geo.dispose();
      p.edges.dispose();
    }
    this.wallParts = [];
    this.walls.clear();
    this.wallBoxes.length = 0;
  }

  update(dt: number, camPos: Vector3): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.time += dt;
    this.uTime.value = this.time;
    this.uCam.value.copy(camPos);
    const t = cfg.songTime();
    const pos = beatPosition(cfg.beats, t);
    const flash = beatFlash(cfg.beats, t);
    this.uPhase.value = pos - Math.floor(pos);
    this.uBeat.value = flash;
    this.sky.position.copy(camPos);
    this.floor.position.set(camPos.x, 0, camPos.z);
    this.mountains.position.set(camPos.x, 0, camPos.z);
    this.wallEdge.color.copy(C.cyan).multiplyScalar(0.55 + 1.1 * flash);
  }

  // ------------------------------------------------------------------------------------------

  private buildWalls(walls: readonly Wall[]): void {
    for (const w of walls) {
      const geo = new BoxGeometry(w.width, w.height, WALL_THICKNESS);
      const edges = new EdgesGeometry(geo);
      const m = new Mesh(geo, this.wallFill);
      const box = wallBox(w);
      m.position.copy(box.center);
      m.rotation.y = box.yaw;
      m.add(new LineSegments(edges, this.wallEdge));
      this.walls.add(m);
      this.wallParts.push({ geo, edges });
      this.wallBoxes.push(box);
    }
  }

  private buildSky(): Mesh {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      defines: { FX_STARS: '' },
      uniforms: {
        uZenith: { value: C.zenith },
        uMid: { value: C.mid },
        uHorizon: { value: C.horizon },
        uSunTop: { value: C.sunTop },
        uSunBottom: { value: C.sunBottom },
        uBeat: this.uBeat,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunTop;
        uniform vec3 uSunBottom;
        uniform float uBeat;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          // Pink only hugs the horizon; at head height the sky is already deep purple.
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
          col = mix(col, uZenith, smoothstep(0.12, 0.8, h));
          col = mix(col, uZenith * 0.5, smoothstep(0.0, -0.1, h));
          col += uHorizon * 0.18 * uBeat * (1.0 - smoothstep(0.0, 0.3, h));

          // The sun sits on the horizon straight ahead (bearing 0). Gaps cut through its lower half.
          if (d.z < -0.01) {
            vec2 p = d.xy / -d.z;
            vec2 q = (p - vec2(0.0, 0.13)) / 0.2;
            float r = length(q);
            float v = q.y * 0.5 + 0.5;
            float gapW = mix(0.55, 0.0, smoothstep(0.0, 0.6, v));
            float gap = step(fract(v * 9.0), gapW);
            float disc = smoothstep(1.0, 0.97, r) * (1.0 - gap);
            vec3 sun = mix(uSunBottom, uSunTop, smoothstep(0.1, 0.9, v)) * (0.72 + 0.5 * uBeat);
            float halo = exp(-max(r - 1.0, 0.0) * 3.5) * (0.12 + 0.3 * uBeat);
            col += uSunBottom * halo * (1.0 - disc);
            col = mix(col, sun, disc);
          }

          #ifdef FX_STARS
          vec2 sp = vec2(atan(d.x, -d.z) * 45.0, h * 70.0);
          vec2 cell = floor(sp);
          float star = step(0.993, hash(cell)) * smoothstep(0.2, 0.0, length(fract(sp) - 0.5));
          col += vec3(0.8, 0.85, 1.0) * star * smoothstep(0.3, 0.5, h) * 0.8;
          #endif

          col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
          ${SHADER_TAIL}
        }
      `,
    });
    const sky = new Mesh(new SphereGeometry(900, 40, 20), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    return sky;
  }

  private buildFloor(): Mesh {
    const mat = new ShaderMaterial({
      fog: false,
      uniforms: {
        uFloor: { value: C.floor },
        uHorizon: { value: C.horizon },
        uMagenta: { value: C.magenta },
        uCyan: { value: C.cyan },
        uCell: { value: GRID_CELL },
        uPhase: this.uPhase,
        uBeat: this.uBeat,
        uSoft: this.uSoft,
        uCam: this.uCam,
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFloor;
        uniform vec3 uHorizon;
        uniform vec3 uMagenta;
        uniform vec3 uCyan;
        uniform float uCell;
        uniform float uPhase;
        uniform float uBeat;
        uniform float uSoft;
        uniform vec3 uCam;
        varying vec3 vW;
        // Pixel distance to the nearest integer line of g, and how blurred the cell is on screen.
        float gridDist(float g) { return abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-5); }
        void main() {
          float dist = length(vW.xz - uCam.xz);
          // Lines march toward the player: one cell per beat, locked to the beat phase.
          float gx = vW.x / uCell;
          float gz = vW.z / uCell - uPhase;
          float dx = gridDist(gx);
          float dz = gridDist(gz);
          float w = 1.3 + 0.8 * uSoft;
          // Lines close up into a smear in the distance: fade them out before they alias.
          float aa = 1.0 - smoothstep(0.25, 0.5, max(fwidth(gx), fwidth(gz)));
          float lx = (1.0 - clamp(dx / w, 0.0, 1.0)) + uSoft * exp(-dx * 0.45) * 0.35;
          float lz = (1.0 - clamp(dz / w, 0.0, 1.0)) + uSoft * exp(-dz * 0.45) * 0.35;
          float far = exp(-dist / 140.0);
          float gain = (0.5 + 1.1 * uBeat) * aa * far;
          vec3 col = uFloor + uCyan * lx * gain * 0.9 + uMagenta * lz * gain;
          // Far floor melts into a dim horizon glow.
          col = mix(col, uHorizon * 0.32, smoothstep(120.0, 600.0, dist));
          gl_FragColor = vec4(col, 1.0);
          ${SHADER_TAIL}
        }
      `,
    });
    const floor = new Mesh(new PlaneGeometry(1400, 1400, 1, 1), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.frustumCulled = false;
    return floor;
  }

  private buildMountains(): Mesh {
    const N = 120;
    const R = 430;
    const pos: number[] = [];
    const top: number[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i <= N; i++) {
      const a = (i % N) / N * Math.PI * 2;
      const { x, z } = bearingXZ(a / DEG, R);
      // Low straight ahead so the sun shows above the ridge; taller toward the flanks and rear.
      const off = Math.min(a, Math.PI * 2 - a);
      const scale = 0.12 + 0.88 * Math.min(1, Math.max(0, (off - 0.35) / 0.7));
      const peak = i % 2 === 0 ? 0.55 + 0.45 * rnd() : 0.2 + 0.3 * rnd();
      const h = 3 + peak * 85 * scale;
      pos.push(x, h, z, x, -6, z);
      top.push(1, 0);
    }
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aTop', new BufferAttribute(new Float32Array(top), 1));
    geo.setIndex(idx);
    const mat = new ShaderMaterial({
      side: DoubleSide,
      fog: false,
      uniforms: {
        uBody: { value: C.mountain },
        uLit: { value: C.mountainLit },
        uEdgeA: { value: C.magenta },
        uEdgeB: { value: C.cyan },
        uBeat: this.uBeat,
      },
      vertexShader: /* glsl */ `
        attribute float aTop;
        varying float vTop;
        varying float vY;
        void main() {
          vTop = aTop;
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBody;
        uniform vec3 uLit;
        uniform vec3 uEdgeA;
        uniform vec3 uEdgeB;
        uniform float uBeat;
        varying float vTop;
        varying float vY;
        void main() {
          vec3 col = mix(uBody, uLit, smoothstep(0.0, 1.0, vTop) * 0.7);
          float ridge = smoothstep(0.93, 1.0, vTop);
          vec3 edge = mix(uEdgeA, uEdgeB, smoothstep(0.0, 80.0, vY)) * (0.6 + 0.9 * uBeat);
          col = mix(col, edge, ridge);
          gl_FragColor = vec4(col, 1.0);
          ${SHADER_TAIL}
        }
      `,
    });
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }
}
