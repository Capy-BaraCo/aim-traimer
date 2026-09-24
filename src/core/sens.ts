/**
 * Overwatch mouse maths.
 *
 * Overwatch turns the camera 0.0066° per mouse count per sensitivity unit, on both axes.
 * Every other number in the app (eDPI, cm/360, conversions) derives from that constant.
 */

export const OW_YAW_DEG = 0.0066;
export const CM_PER_INCH = 2.54;
export const OW_SENS_MIN = 0.01;
export const OW_SENS_MAX = 100;

export const degPerCount = (sens: number): number => OW_YAW_DEG * sens;

export const edpi = (sens: number, dpi: number): number => sens * dpi;

export const inchesPer360 = (sens: number, dpi: number): number => 360 / (OW_YAW_DEG * sens * dpi);

export const cmPer360 = (sens: number, dpi: number): number => inchesPer360(sens, dpi) * CM_PER_INCH;

/** Degrees the camera turns for one centimetre of mouse travel. */
export const degPerCm = (sens: number, dpi: number): number => 360 / cmPer360(sens, dpi);

export const sensForCmPer360 = (cm: number, dpi: number): number =>
  (360 * CM_PER_INCH) / (OW_YAW_DEG * dpi * cm);

/** Keep the same physical feel (cm/360) when changing mouse DPI. */
export const sensForNewDpi = (sens: number, oldDpi: number, newDpi: number): number => (sens * oldDpi) / newDpi;

/** Overwatch accepts two decimals. */
export const roundSens = (sens: number): number => Math.round(sens * 100) / 100;

export const clampSens = (sens: number): number => Math.min(OW_SENS_MAX, Math.max(OW_SENS_MIN, sens));

/**
 * Millimetres of mouse travel needed to sweep a given visual angle.
 * Handy for making tiny numbers tangible ("that head is 0.8 mm of mousepad wide").
 */
export const mmForDegrees = (deg: number, sens: number, dpi: number): number =>
  ((deg / degPerCount(sens)) / dpi) * CM_PER_INCH * 10;

export interface GameYaw {
  id: string;
  name: string;
  /** Degrees per count per sensitivity unit. */
  yaw: number;
  decimals: number;
}

/** Games whose yaw constant is stable and well documented. */
export const GAMES: readonly GameYaw[] = [
  { id: 'cs2', name: 'Counter-Strike 2', yaw: 0.022, decimals: 3 },
  { id: 'valorant', name: 'VALORANT', yaw: 0.07, decimals: 3 },
  { id: 'apex', name: 'Apex Legends', yaw: 0.022, decimals: 2 },
  { id: 'tf2', name: 'Team Fortress 2', yaw: 0.022, decimals: 2 },
  { id: 'quake', name: 'Quake Champions', yaw: 0.022, decimals: 3 },
];

export const owToGame = (owSens: number, game: GameYaw): number => (owSens * OW_YAW_DEG) / game.yaw;
export const gameToOw = (sens: number, game: GameYaw): number => (sens * game.yaw) / OW_YAW_DEG;

export type AimStyle = 'wrist' | 'hybrid' | 'arm';

/** Community rule-of-thumb windows (cm/360). Starting points for PSA, not targets. */
export const STYLE_BANDS: Record<AimStyle, { range: [number, number]; label: string; blurb: string }> = {
  wrist: {
    range: [18, 28],
    label: 'Wrist',
    blurb: 'Pivot at the wrist. Fast turns and snappy tank/mobility play, but fine tracking gets harder.',
  },
  hybrid: {
    range: [28, 42],
    label: 'Hybrid',
    blurb: 'Wrist for small corrections, forearm for big turns. Where most hitscan players end up.',
  },
  arm: {
    range: [42, 65],
    label: 'Arm',
    blurb: 'Big muscles drive every move. Very stable tracking; needs a large mousepad and space.',
  },
};

export function styleFor(cm: number): AimStyle {
  if (cm < STYLE_BANDS.wrist.range[1]) return 'wrist';
  if (cm < STYLE_BANDS.hybrid.range[1]) return 'hybrid';
  return 'arm';
}

/** Angular radius (degrees) of a sphere of radius r seen from distance d. */
export const angularRadiusDeg = (r: number, d: number): number =>
  (Math.asin(Math.min(1, r / Math.max(d, r))) * 180) / Math.PI;

/**
 * Overwatch's FOV slider is horizontal FOV at 16:9. Three.js wants vertical FOV, which we then hold
 * constant for any aspect ratio (Hor+), matching how the game behaves on 16:9 and wider screens.
 */
export function verticalFovFromOw(hfovDeg: number): number {
  const h = (hfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / (16 / 9)) * 180) / Math.PI;
}

export const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits) : '—';
