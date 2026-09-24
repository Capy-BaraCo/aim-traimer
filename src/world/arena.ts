import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { Box } from './collide';
import { PALETTE, SUN_DIR } from './palette';
import { canvasTexture, FONTS } from './text';

export const PLAY_RADIUS = 34;
const PROTRACTOR_R = 30;

/** Bearing (0° = straight ahead at spawn, clockwise from above) → world XZ. */
export function bearingXZ(deg: number, r: number): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.sin(a), z: -r * Math.cos(a) };
}

/** Bearing of a world direction. */
export function bearingOf(x: number, z: number): number {
  const d = (Math.atan2(x, -z) * 180) / Math.PI;
  return (d + 360) % 360;
}

export interface Fin {
  bearing: number;
  radius: number;
  width: number;
  box: Box;
}

export class Arena {
  readonly root = new Group();
  readonly colliders: Box[] = [];
  readonly fins: Fin[] = [];
  private readonly sky: Mesh;
  private readonly halo: Group;
  private readonly groundUniforms = { uCam: { value: new Vector3() } };
  private readonly timeUniform = { value: 0 };
  readonly sun: DirectionalLight;

  constructor(scene: Scene) {
    scene.add(this.root);
    scene.fog = new FogExp2(PALETTE.fog.getHex(), 0.0062);
    scene.background = PALETTE.horizon.clone();

    this.sky = this.buildSky();
    this.root.add(this.sky);
    this.root.add(this.buildGround());

    const hemi = new HemisphereLight(PALETTE.zenith.clone().lerp(new Color('#ffffff'), 0.62), PALETTE.bone, 1.7);
    this.root.add(hemi);

    this.sun = new DirectionalLight(PALETTE.sun, 2.9);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -46;
    sc.right = 46;
    sc.top = 46;
    sc.bottom = -46;
    sc.near = 10;
    sc.far = 260;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.root.add(this.sun, this.sun.target);

    this.buildStructures();
    this.buildMonoliths();
    this.buildGroundLabels();
    this.buildHorizon();
    this.halo = this.buildHalo();
    this.buildDust();
  }

  update(dt: number, camPos: Vector3): void {
    this.timeUniform.value += dt;
    this.sky.position.copy(camPos);
    this.groundUniforms.uCam.value.copy(camPos);
    this.halo.rotation.z += dt * 0.012;
  }

  // ---------------------------------------------------------------------------------------------

  private buildSky(): Mesh {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: PALETTE.horizon },
        uZenith: { value: PALETTE.zenith },
        uGround: { value: PALETTE.groundHaze },
        uSun: { value: PALETTE.sun },
        uSunDir: { value: SUN_DIR },
        uTime: this.timeUniform,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uGround;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.6));
          col = mix(col, uGround, smoothstep(0.0, -0.06, h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(sd, 1400.0) * 6.0 + pow(sd, 60.0) * 0.45 + pow(sd, 6.0) * 0.12);
          // A slow hairline "scan" band drifting up the sky: the instrument is on.
          float scan = smoothstep(0.004, 0.0, abs(fract(h * 3.0 - uTime * 0.01) - 0.5) - 0.497);
          col = mix(col, col * 1.04, scan * smoothstep(0.02, 0.2, h));
          col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const sky = new Mesh(new SphereGeometry(900, 48, 24), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    return sky;
  }

  private buildGround(): Mesh {
    const mat = new MeshStandardMaterial({ color: PALETTE.bone, roughness: 0.96, metalness: 0 });
    const uCam = this.groundUniforms.uCam;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uInk = { value: PALETTE.ink };
      shader.uniforms.uSignal = { value: PALETTE.signal };
      shader.uniforms.uCam = uCam;
      shader.uniforms.uPlayR = { value: PLAY_RADIUS };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${DIAL_GLSL}`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 gp = vWPos.xz;
          diffuseColor.rgb *= 0.9 + 0.1 * vnoise(gp * 0.07) + 0.04 * vnoise(gp * 0.9);
          vec4 dial = dialPattern(gp);
          diffuseColor.rgb = mix(diffuseColor.rgb, dial.rgb, dial.a);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSignal * dialGlow * 0.55;',
        );
    };
    const ground = new Mesh(new PlaneGeometry(1800, 1800, 1, 1), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    return ground;
  }

  private buildStructures(): void {
    const concrete = new MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.88, metalness: 0.02 });
    const trim = new MeshBasicMaterial({ color: PALETTE.signal });
    const edge = new LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.55 });

    const add = (x: number, z: number, w: number, h: number, d: number, yaw: number, withTrim: boolean): Box => {
      const geo = new BoxGeometry(w, h, d);
      const m = new Mesh(geo, concrete);
      m.position.set(x, h / 2, z);
      m.rotation.y = yaw;
      m.castShadow = true;
      m.receiveShadow = true;
      const lines = new LineSegments(new EdgesGeometry(geo), edge);
      m.add(lines);
      if (withTrim) {
        const t = new Mesh(new BoxGeometry(w + 0.02, 0.06, d + 0.02), trim);
        t.position.y = h / 2 - 0.12;
        m.add(t);
      }
      this.root.add(m);
      const box = new Box(new Vector3(x, h / 2, z), new Vector3(w / 2, h / 2, d / 2), yaw);
      this.colliders.push(box);
      return box;
    };

    // Peek fins: tall slabs facing the spawn. Figures hide behind them in the corner drill.
    for (const bearing of [-38, 0, 38]) {
      const r = 20;
      const { x, z } = bearingXZ(bearing, r);
      const width = 3.6;
      const box = add(x, z, width, 3.2, 0.7, (-bearing * Math.PI) / 180, true);
      this.fins.push({ bearing, radius: r, width, box });
    }

    // Plinths behind spawn for hopping practice (0.7 m: clears with a 5.72 m/s jump).
    for (const [bearing, r] of [
      [135, 9],
      [180, 11.5],
      [225, 9],
    ] as const) {
      const { x, z } = bearingXZ(bearing, r);
      add(x, z, 2.6, 0.7, 2.6, (-bearing * Math.PI) / 180, false);
    }

    // Low cover to the flanks (crouch height).
    for (const bearing of [90, 270]) {
      const { x, z } = bearingXZ(bearing, 13);
      add(x, z, 4.2, 1.05, 0.8, (-bearing * Math.PI) / 180, true);
    }
  }

  private buildMonoliths(): void {
    const geo = new BoxGeometry(1, 1, 1);
    for (let i = 0; i < 12; i++) {
      const bearing = i * 30;
      const cardinal = bearing % 90 === 0;
      const h = cardinal ? 26 : 17;
      const w = cardinal ? 6.5 : 4.6;
      const label = String(bearing).padStart(3, '0');
      const tex = canvasTexture(256, 1024, (g) => {
        g.fillStyle = '#16140f';
        g.fillRect(0, 0, 256, 1024);
        g.strokeStyle = 'rgba(233,225,210,0.28)';
        g.lineWidth = 2;
        for (let y = 60; y < 1024; y += 24) {
          const long = (y / 24) % 5 === 0;
          g.beginPath();
          g.moveTo(22, y);
          g.lineTo(long ? 62 : 40, y);
          g.stroke();
        }
        g.fillStyle = '#ff4b1f';
        g.font = `900 132px ${FONTS.display}`;
        g.textAlign = 'center';
        g.fillText(label, 142, 180);
        g.fillStyle = 'rgba(233,225,210,0.8)';
        g.font = `400 22px ${FONTS.mono}`;
        g.fillText('BRG°', 142, 222);
        if (cardinal) {
          g.font = `700 84px ${FONTS.display}`;
          g.fillStyle = 'rgba(233,225,210,0.9)';
          g.fillText(['N', 'E', 'S', 'W'][bearing / 90], 142, 960);
        }
      });
      const face = new MeshStandardMaterial({
        map: tex,
        emissive: new Color('#ffffff'),
        emissiveMap: tex,
        emissiveIntensity: 0.85,
        roughness: 0.8,
      });
      const side = new MeshStandardMaterial({ color: '#1c1a16', roughness: 0.85 });
      // BoxGeometry groups: +x, -x, +y, -y, +z, -z. The +z face looks back at the dial centre.
      const m = new Mesh(geo, [side, side, side, side, face, side]);
      m.scale.set(w, h, 1.6);
      const { x, z } = bearingXZ(bearing, 84);
      m.position.set(x, h / 2, z);
      m.rotation.y = (-bearing * Math.PI) / 180;
      this.root.add(m);
    }
  }

  private buildGroundLabels(): void {
    const mk = (text: string, size: number, color: string, weight: number, family: string, w = 512, h = 256) =>
      canvasTexture(w, h, (g) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = color;
        g.font = `${weight} ${size}px ${family}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2);
      });
    const place = (tex: ReturnType<typeof mk>, bearing: number, r: number, width: number, height: number, opacity: number) => {
      const mat = new MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: DoubleSide,
      });
      const m = new Mesh(new PlaneGeometry(width, height), mat);
      const { x, z } = bearingXZ(bearing, r);
      m.position.set(x, 0.02, z);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = (-bearing * Math.PI) / 180;
      this.root.add(m);
    };
    for (let b = 0; b < 360; b += 30) {
      place(mk(String(b).padStart(3, '0'), 180, '#16140f', 900, FONTS.display), b, PROTRACTOR_R + 5.6, 5, 2.5, 0.8);
    }
    for (const r of [10, 20]) {
      place(mk(`${r} M`, 120, '#16140f', 400, FONTS.mono), 4, r - 0.8, 2.4, 1.2, 0.55);
      place(mk(`${r} M`, 120, '#16140f', 400, FONTS.mono), 184, r - 0.8, 2.4, 1.2, 0.55);
    }
  }

  private buildHorizon(): void {
    // Distant megaliths: scale cues that fade into the haze.
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshStandardMaterial({ color: '#2a2621', roughness: 1 });
    const count = 22;
    const mesh = new InstancedMesh(geo, mat, count);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const bearing = (i / count) * 360 + rnd() * 12;
      const r = 230 + rnd() * 220;
      const h = 30 + rnd() * rnd() * 150;
      const { x, z } = bearingXZ(bearing, r);
      s.set(8 + rnd() * 30, h, 8 + rnd() * 18);
      p.set(x, h / 2 - 2, z);
      q.setFromAxisAngle(new Vector3(0, 1, 0), rnd() * Math.PI);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    this.root.add(mesh);
  }

  private buildHalo(): Group {
    // An orbital ring hanging in the sky ahead of spawn: segmented so its slow spin is visible.
    const g = new Group();
    const seg = new BoxGeometry(1, 1, 1);
    const hot = new MeshBasicMaterial({ color: PALETTE.signal, fog: false });
    const pale = new MeshBasicMaterial({ color: new Color('#fff3e4'), fog: false });
    const addRing = (radius: number, n: number, mat: MeshBasicMaterial, thick: number, fill: number) => {
      const inst = new InstancedMesh(seg, mat, n);
      const o = new Object3D();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        o.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
        o.rotation.set(0, 0, a + Math.PI / 2);
        o.scale.set(((Math.PI * 2 * radius) / n) * fill, thick, thick);
        o.updateMatrix();
        inst.setMatrixAt(i, o.matrix);
      }
      g.add(inst);
    };
    addRing(150, 96, hot, 5, 0.66);
    addRing(166, 192, pale, 1.8, 0.4);
    g.position.set(90, 330, -720);
    g.rotation.set(-0.65, 0.12, 0);
    this.root.add(g);
    return g;
  }

  private buildDust(): Points {
    const n = 900;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 46;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: this.timeUniform, uColor: { value: new Color('#fff0dc') } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.08 + aSeed * 0.18), 14.0);
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.6;
          p.z += cos(uTime * 0.23 + aSeed * 23.0) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.2 + aSeed * 2.2) * (26.0 / -mv.z);
          vA = (0.25 + 0.55 * aSeed) * smoothstep(0.0, 1.5, p.y) * smoothstep(14.0, 11.0, p.y);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    this.root.add(pts);
    return pts;
  }
}

const DIAL_GLSL = /* glsl */ `
  varying vec3 vWPos;
  uniform vec3 uInk;
  uniform vec3 uSignal;
  uniform vec3 uCam;
  uniform float uPlayR;
  float dialGlow = 0.0;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // Anti-aliased hairline that never gets thinner than a pixel (it fades instead): no shimmer.
  float wire(float d, float halfW, float fw) {
    float w = max(halfW, fw * 0.5);
    return (1.0 - smoothstep(w - fw * 0.5, w + fw * 0.5, d)) * (halfW / w);
  }

  vec4 dialPattern(vec2 p) {
    float r = length(p);
    float fw = max(fwidth(p.x), fwidth(p.y)) + 1e-4;
    float deg = degrees(atan(p.x, -p.y));
    deg = deg < 0.0 ? deg + 360.0 : deg;
    float ink = 0.0;
    float sig = 0.0;

    // Range rings: every 5 m, heavier every 25 m.
    float inRange = step(1.0, r) * (1.0 - step(60.5, r));
    ink += wire(abs(r - 5.0 * floor(r / 5.0 + 0.5)), 0.028, fw) * 0.42 * inRange;
    ink += wire(abs(r - 25.0 * floor(r / 25.0 + 0.5)), 0.07, fw) * 0.7 * inRange;

    // Spokes every 15°.
    float d15 = abs(deg - 15.0 * floor(deg / 15.0 + 0.5));
    ink += wire(radians(d15) * r, 0.02, fw) * 0.3 * smoothstep(2.0, 4.0, r) * (1.0 - smoothstep(52.0, 60.0, r));

    // Protractor band: 1° / 5° / 10° ticks outward from the base circle.
    float band = r - ${PROTRACTOR_R.toFixed(1)};
    float d1 = abs(deg - floor(deg + 0.5));
    float d5 = abs(deg - 5.0 * floor(deg / 5.0 + 0.5));
    float d10 = abs(deg - 10.0 * floor(deg / 10.0 + 0.5));
    float inBand = step(0.0, band);
    ink += wire(radians(d1) * r, 0.03, fw) * inBand * (1.0 - step(0.9, band)) * 0.85;
    ink += wire(radians(d5) * r, 0.05, fw) * inBand * (1.0 - step(1.7, band)) * 0.95;
    sig += wire(radians(d10) * r, 0.08, fw) * inBand * (1.0 - step(2.9, band));
    sig += wire(abs(band), 0.1, fw);

    // Cardinal wedges.
    float d90 = abs(deg - 90.0 * floor(deg / 90.0 + 0.5));
    sig += wire(radians(d90) * r, 0.16, fw) * step(3.2, band) * (1.0 - step(4.4, band));

    // Dashed boundary of the play space.
    float dash = step(0.5, fract(deg / 1.5));
    sig += wire(abs(r - uPlayR), 0.08, fw) * dash * 0.85;

    // Spawn rose.
    ink += wire(abs(r - 0.7), 0.02, fw) * 0.8;
    ink += (wire(abs(p.x), 0.012, fw) + wire(abs(p.y), 0.012, fw)) * (1.0 - step(1.3, r)) * 0.6;

    float fade = 1.0 - smoothstep(70.0, 170.0, length(p - uCam.xz));
    ink = clamp(ink, 0.0, 1.0) * fade;
    sig = clamp(sig, 0.0, 1.0) * fade;
    dialGlow = sig;
    float a = max(ink, sig);
    vec3 col = mix(uInk, uSignal, sig / max(ink + sig, 1e-4));
    return vec4(col, a);
  }
`;
