/**
 * Weapons, modelled on Overwatch heroes. Every bullet is hitscan (it lands the instant you click,
 * where you aim) but is a real, separate shot: it has a fire rate, can spread, and loses damage with
 * distance. Numbers are close to Overwatch 2's, not exact copies — patches change them often.
 */

export type WeaponId = 'rail' | 'pulse' | 'pistols' | 'peacekeeper' | 'viper';
export type ShotSound = 'rail' | 'pulse' | 'pistols' | 'revolver' | 'rifle';

/** How a weapon fires in one mode (hip fire, or scoped). */
export interface FireMode {
  /** Shots per second. */
  rate: number;
  body: number;
  head: number;
  /** Random cone half-angle, degrees (0 = every bullet goes exactly where you aim). */
  spread: number;
  /** Damage drops linearly from full at `start` metres to `min` × damage at `end`. */
  falloff?: { start: number; end: number; min: number };
  /** Spread that builds while firing (Soldier-style): +`per`° a shot, up to `max`, recovering `recover`°/s. */
  bloom?: { per: number; max: number; recover: number };
}

export interface WeaponSpec extends FireMode {
  id: WeaponId;
  name: string;
  /** Who it plays like. */
  hero: string;
  blurb: string;
  /** Hold to fire (true) or click per shot. */
  auto: boolean;
  sound: ShotSound;
  /** Right mouse: aim down sights. */
  scope?: FireMode & { zoom: number };
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rail: {
    id: 'rail',
    name: 'Training rail',
    hero: 'Neutral',
    blurb: 'One clean shot, no spread, no fall-off. Measures pure aim.',
    auto: false,
    rate: 3.2,
    body: 70,
    head: 140,
    spread: 0,
    sound: 'rail',
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse rifle',
    hero: 'Soldier: 76',
    blurb: 'Hold to fire, 9 rounds a second. First shots are precise; spread builds if you hold on.',
    auto: true,
    rate: 9,
    body: 18,
    head: 36,
    spread: 0,
    falloff: { start: 30, end: 50, min: 0.5 },
    bloom: { per: 0.22, max: 2.2, recover: 5 },
    sound: 'pulse',
  },
  pistols: {
    id: 'pistols',
    name: 'Pulse pistols',
    hero: 'Tracer',
    blurb: '40 tiny bullets a second with wide spread and steep fall-off. Get close and stay close.',
    auto: true,
    rate: 40,
    body: 6,
    head: 12,
    spread: 2.8,
    falloff: { start: 11, end: 20, min: 0.3 },
    sound: 'pistols',
  },
  peacekeeper: {
    id: 'peacekeeper',
    name: 'Peacekeeper',
    hero: 'Cassidy',
    blurb: 'A heavy revolver: two shots a second, no spread. Make each one count.',
    auto: false,
    rate: 2,
    body: 70,
    head: 140,
    spread: 0,
    falloff: { start: 20, end: 40, min: 0.5 },
    sound: 'revolver',
  },
  viper: {
    id: 'viper',
    name: 'Viper',
    hero: 'Ashe',
    blurb: 'Quick, light hip fire — or hold right mouse to scope in for a slow, hard-hitting shot.',
    auto: false,
    rate: 4,
    body: 40,
    head: 80,
    spread: 1,
    falloff: { start: 20, end: 40, min: 0.5 },
    sound: 'rifle',
    scope: { zoom: 1.5, rate: 1.4, body: 75, head: 150, spread: 0, falloff: { start: 30, end: 50, min: 0.5 } },
  },
};

/** Damage multiplier at `dist` metres for a mode with fall-off. */
export function falloffAt(mode: FireMode, dist: number): number {
  const f = mode.falloff;
  if (!f || dist <= f.start) return 1;
  if (dist >= f.end) return f.min;
  return 1 - ((dist - f.start) / (f.end - f.start)) * (1 - f.min);
}

/** A random point in a disc of `radius`, for spreading a bullet (uniform over the cone's face). */
export function spreadOffset(radius: number, rand = Math.random): [number, number] {
  if (radius <= 0) return [0, 0];
  const r = radius * Math.sqrt(rand());
  const a = rand() * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Which weapons make sense in each drill. The first is the default. */
export const LOADOUTS: Record<string, WeaponId[]> = {
  duelist: ['pulse', 'pistols', 'peacekeeper', 'viper'],
  crossfire: ['pulse', 'pistols', 'peacekeeper', 'viper'],
  triad: ['pulse', 'pistols', 'peacekeeper', 'viper'],
  corner: ['rail', 'peacekeeper', 'viper', 'pulse'],
  blink: ['rail', 'peacekeeper', 'viper'],
  snap: ['rail', 'peacekeeper', 'viper'],
  echo: ['rail', 'peacekeeper', 'viper'],
  pin: ['rail', 'peacekeeper', 'viper'],
};
