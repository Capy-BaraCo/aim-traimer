import {
  HalfFloatType,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { verticalFovFromOw } from '../core/sens';
import type { FxLevel } from '../core/store';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uGrain: { value: 0.022 },
    uVignette: { value: 0.28 },
    uAberration: { value: 0.01 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // Aberration grows with r² so the crosshair region stays razor sharp.
      vec2 off = c * r2 * uAberration;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col *= 1.0 - uVignette * smoothstep(0.08, 0.5, r2);
      col += (hash(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly vmScene = new Scene();
  readonly vmCamera: PerspectiveCamera;
  showViewmodel = true;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fx: FxLevel = 'full';
  private renderScale = 1;
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.camera = new PerspectiveCamera(verticalFovFromOw(103), 16 / 9, 0.03, 2000);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new PerspectiveCamera(60, 16 / 9, 0.01, 10);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setFov(owHorizontalFov: number): void {
    this.camera.fov = verticalFovFromOw(owHorizontalFov);
    this.camera.updateProjectionMatrix();
  }

  setQuality(fx: FxLevel, renderScale: number): void {
    const changed = fx !== this.fx || renderScale !== this.renderScale || (!this.composer && fx !== 'off');
    this.fx = fx;
    this.renderScale = renderScale;
    if (changed) {
      this.buildComposer();
      this.resize();
    }
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    if (this.fx === 'off') return;

    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const vm = new RenderPass(this.vmScene, this.vmCamera);
    vm.clear = false;
    vm.clearDepth = true;
    composer.addPass(vm);
    if (this.fx === 'full') {
      this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.82);
      composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.grade) this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render(dt: number): void {
    this.time += dt;
    const vmVisible = this.showViewmodel;
    this.vmScene.visible = vmVisible;
    if (this.composer) {
      if (this.grade) this.grade.uniforms.uTime.value = this.time;
      this.composer.render(dt);
      return;
    }
    const r = this.renderer;
    r.autoClear = false;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.camera);
    if (vmVisible) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}
