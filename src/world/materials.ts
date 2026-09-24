import { AdditiveBlending, Color, ShaderMaterial, type IUniform } from 'three';
import { PALETTE } from './palette';

/**
 * "Hard-light" target material: unlit, fresnel rim, slow rising scan bands.
 * Unlit keeps the silhouette readable against any background; the rim gives it volume.
 */
export function hardLightMaterial(core: Color = PALETTE.targetCore, rim: Color = PALETTE.targetRim): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uCore: { value: core.clone() },
    uRim: { value: rim.clone() },
    uHit: { value: 0 },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uIntensity: { value: 1.35 },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uRim;
      uniform float uHit;
      uniform float uTime;
      uniform float uFade;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float f = 1.0 - abs(dot(n, v));
        float rim = pow(f, 2.2);
        float band = smoothstep(0.42, 0.5, abs(fract(vWorld.y * 5.0 - uTime * 0.9) - 0.5)) * 0.12;
        vec3 col = mix(uCore, uRim, rim) + uRim * band;
        col = mix(col, vec3(1.0), uHit);
        gl_FragColor = vec4(col * uIntensity * uFade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Additive soft glow used for sparks, rings and tracers. */
export function glowMaterial(color: Color, opacity = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(uColor * uOpacity, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
