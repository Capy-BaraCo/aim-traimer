import { Color, Vector3 } from 'three';

/** One source of truth for the world's look. UI tokens in CSS mirror these. */
export const PALETTE = {
  ink: new Color('#14120f'),
  bone: new Color('#efe9dd'),
  dust: new Color('#b9ae9a'),
  signal: new Color('#ff4b1f'),
  cobalt: new Color('#3148ff'),
  horizon: new Color('#f1d9bd'),
  zenith: new Color('#6d7493'),
  groundHaze: new Color('#d9c9b3'),
  sun: new Color('#ffd0a8'),
  fog: new Color('#e6d3bc'),
  concrete: new Color('#d7cebf'),
  targetCore: new Color('#ff3d12'),
  targetRim: new Color('#ffe3c9'),
};

/** Low, warm sun behind bearing ~200°: long shadows across the dial. */
export const SUN_DIR = new Vector3(-0.36, 0.4, 0.84).normalize();
