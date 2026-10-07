import type { DrillId } from '../core/coach';
import type { Game } from '../core/game';
import { MAX_LEVEL, type Thresholds } from '../core/progress';
import type { StyleTuning } from '../world/brain';
import type { Drill } from './drill';
import { EchoDrill, type EchoParams } from './echo';
import { FlickDrill, PinDrill, type FlickParams } from './flick';
import { CornerWatchDrill } from './placement';
import { TriadDrill } from './switching';
import { CrossfireDrill, DuelistDrill, type DuelParams } from './tracking';

export interface DrillDef {
  id: DrillId;
  name: string;
  skill: string;
  kicker: string;
  /** Field Manual chapter that explains this skill. */
  chapter: string;
  oneLiner: string;
  job: string[];
  scoring: string;
  measures: string[];
  tips: string[];
  stars: Thresholds;
  levels: string[];
  make: (g: Game, level: number) => Drill;
}

/** Clamp a level to 1..n for a drill with `n` levels. */
const clampLevel = (level: number, n: number) => Math.min(n, Math.max(1, Math.round(level)));
/** Most drills have MAX_LEVEL levels; Duelist, Blink and Triad go further. */
const L = (level: number) => clampLevel(level, MAX_LEVEL);

// ------------------------------------------------------------------ tracking ladder (Duelist, Crossfire)

interface DuelRow extends DuelParams {
  label: string;
}

const duelRow = (
  style: 'smooth' | 'duel',
  speed: number,
  jump: number,
  crouch: number,
  min: number,
  max: number,
  near: number,
  far: number,
  label: string,
): DuelRow => ({ style, tuning: { speed, jump, crouch, min, max } satisfies Partial<StyleTuning>, near, far, label });

const DUEL: DuelRow[] = [
  duelRow('smooth', 0.55, 0, 0, 1.0, 1.8, 13, 16, 'Slow, long strafes, far away'),
  duelRow('smooth', 0.65, 0, 0, 0.9, 1.6, 12, 15, 'A little quicker'),
  duelRow('smooth', 0.8, 0, 0, 0.7, 1.4, 11, 14, 'Quicker strafes'),
  duelRow('duel', 0.8, 0.04, 0, 0.25, 0.95, 11, 14, 'Real side-to-side dodging (ADAD) begins'),
  duelRow('duel', 0.85, 0.06, 0.03, 0.22, 0.9, 10, 13, 'Dodges get shorter; the odd jump'),
  duelRow('duel', 0.9, 0.08, 0.05, 0.2, 0.85, 10, 13, 'Jumps and crouches'),
  duelRow('duel', 0.95, 0.1, 0.07, 0.18, 0.8, 9, 12, 'Closer, faster'),
  duelRow('duel', 1.0, 0.12, 0.09, 0.17, 0.75, 8, 11, 'Full Overwatch speed (5.5 m/s)'),
  duelRow('duel', 1.0, 0.14, 0.11, 0.16, 0.7, 7, 10, 'Close-range duel'),
  duelRow('duel', 1.0, 0.16, 0.13, 0.14, 0.62, 6, 9, 'Point-blank, maximum dodging'),
  // 11–15: speed stays at Overwatch's 5.5 m/s; dodges get shorter and less readable.
  duelRow('duel', 1.0, 0.18, 0.15, 0.13, 0.58, 6, 9, 'Shorter dodges, more jumps'),
  duelRow('duel', 1.0, 0.2, 0.17, 0.12, 0.52, 6, 8, 'Sharp, uneven rhythm'),
  duelRow('duel', 1.0, 0.22, 0.19, 0.11, 0.47, 5, 8, 'Close and twitchy'),
  duelRow('duel', 1.0, 0.24, 0.21, 0.1, 0.42, 5, 7, 'Almost no warning before each turn'),
  duelRow('duel', 1.0, 0.26, 0.23, 0.09, 0.38, 4, 7, 'Mirror match: point-blank, constant dodging'),
];

// ------------------------------------------------------------------ flick ladders

const flickRow = (radius: number, minDeg: number, maxDeg: number, limit: number, count: number, screen: boolean): FlickParams => ({
  radius,
  minDeg,
  maxDeg,
  limit,
  count,
  minDist: screen ? 11 : 10,
  maxDist: screen ? 17 : 20,
  screen,
});

const BLINK: FlickParams[] = [
  flickRow(0.36, 4, 14, 1.8, 18, true),
  flickRow(0.34, 4, 16, 1.7, 18, true),
  flickRow(0.32, 5, 18, 1.6, 20, true),
  flickRow(0.3, 5, 20, 1.5, 20, true),
  flickRow(0.28, 6, 22, 1.4, 20, true),
  flickRow(0.26, 6, 24, 1.3, 22, true),
  flickRow(0.24, 6, 26, 1.2, 22, true),
  flickRow(0.22, 7, 28, 1.1, 22, true),
  flickRow(0.2, 7, 30, 1.0, 24, true),
  flickRow(0.18, 8, 32, 0.9, 24, true),
  flickRow(0.17, 8, 32, 0.85, 24, true),
  flickRow(0.16, 8, 34, 0.8, 26, true),
  flickRow(0.15, 9, 34, 0.75, 26, true),
  flickRow(0.14, 9, 36, 0.7, 28, true),
  flickRow(0.13, 10, 36, 0.65, 28, true),
];

const SNAP: FlickParams[] = [
  flickRow(0.45, 25, 70, 3.2, 14, false),
  flickRow(0.42, 25, 80, 3.0, 14, false),
  flickRow(0.4, 30, 90, 2.8, 16, false),
  flickRow(0.38, 30, 100, 2.6, 16, false),
  flickRow(0.35, 35, 110, 2.4, 16, false),
  flickRow(0.33, 35, 120, 2.2, 18, false),
  flickRow(0.31, 40, 130, 2.0, 18, false),
  flickRow(0.29, 40, 140, 1.9, 18, false),
  flickRow(0.27, 45, 150, 1.8, 20, false),
  flickRow(0.25, 45, 160, 1.7, 20, false),
];

// Echo: the training wheels (repeating beacon, direction arc) come off as you level up.
const echoRow = (radius: number, minDeg: number, maxDeg: number, limit: number, beacon: number, arc: EchoParams['arc']): EchoParams => ({
  radius,
  minDeg,
  maxDeg,
  limit,
  count: 14,
  beacon,
  arc,
  minDist: 10,
  maxDist: 17,
});

const ECHO: EchoParams[] = [
  echoRow(0.44, 70, 140, 3.4, 0.4, 'all'),
  echoRow(0.42, 80, 150, 3.2, 0.45, 'all'),
  echoRow(0.4, 90, 160, 3.0, 0.5, 'spawn'),
  echoRow(0.38, 90, 170, 2.9, 0.6, 'spawn'),
  echoRow(0.36, 90, 175, 2.8, 0.7, 'none'),
  echoRow(0.34, 100, 178, 2.6, 0.9, 'none'),
  echoRow(0.32, 100, 180, 2.5, 1.2, 'none'),
  echoRow(0.3, 110, 180, 2.4, 0, 'none'),
  echoRow(0.28, 110, 180, 2.2, 0, 'none'),
  echoRow(0.26, 120, 180, 2.0, 0, 'none'),
];

const echoLabel = (p: EchoParams) =>
  `${p.minDeg}–${p.maxDeg}° round · ${p.beacon ? `ticks every ${p.beacon.toFixed(1)} s` : 'one ping only'}${p.arc === 'all' ? ' · arc shows every sound' : p.arc === 'spawn' ? ' · arc on the first ping' : ''} · ${p.limit.toFixed(1)} s`;

const size = (r: number) => (r >= 0.34 ? 'Big' : r >= 0.28 ? 'Medium' : r >= 0.22 ? 'Small' : 'Head-sized');
const flickLabel = (p: FlickParams) => `${size(p.radius)} targets · ${p.minDeg}–${p.maxDeg}° away · ${p.limit.toFixed(1)} s each`;

const PIN = Array.from({ length: 10 }, (_, i) => ({
  radius: 0.2 - i * 0.011,
  minDist: 22 + i * 0.9,
  maxDist: 27 + i,
  drift: i < 5 ? 0 : (i - 4) * 0.16,
}));

const TRIAD = Array.from({ length: 15 }, (_, i) => ({
  count: i < 6 ? 3 : 4,
  hp: 100 + i * 11,
  duelShare: Math.min(1, 0.1 + i * 0.1),
  // Caps at Overwatch's full strafe speed (1.0) on level 10; past that, tougher and tankier.
  speed: Math.min(1, 0.6 + i * 0.045),
}));

const CORNER = Array.from({ length: 10 }, (_, i) => ({
  exposure: [Math.max(0.4, 1.5 - i * 0.12), Math.max(0.6, 2.1 - i * 0.16)] as [number, number],
  peeks: 12,
  hp: 140,
}));

export const DRILL_DEFS: DrillDef[] = [
  {
    id: 'duelist',
    name: 'Duelist',
    skill: 'Tracking',
    kicker: 'TRACKING',
    chapter: 'tracking',
    oneLiner: 'An enemy dodges left and right. Keep your crosshair on them while holding the trigger.',
    job: [
      'Hold the left mouse button the whole time.',
      'Keep your crosshair on their chest and follow them as they dodge.',
      'When they jump or crouch, stay with them.',
    ],
    scoring: 'Your score is the percentage of time your crosshair was on them while you were firing.',
    measures: ['Time on target', 'How many milliseconds behind their dodges you react', 'Whether your crosshair sits low or high', 'How shaky your aim is'],
    tips: ['Relax your grip — tense hands make jerky aim.', 'Watch their body, not your crosshair.'],
    stars: [35, 50, 65],
    levels: DUEL.map((d) => d.label),
    make: (g, level) => {
      const n = clampLevel(level, DUEL.length);
      return new DuelistDrill(g, DUEL[n - 1], n);
    },
  },
  {
    id: 'blink',
    name: 'Blink',
    skill: 'Short flicks',
    kicker: 'SHORT FLICKS',
    chapter: 'flicking',
    oneLiner: 'Targets pop up on your screen, close to your crosshair. Snap to each one and click.',
    job: ['Look at the new target.', 'Move to it in one smooth motion.', 'Stop on it, then click once.'],
    scoring: 'Your score combines how many you hit, how fast, and how few shots you wasted.',
    measures: [
      'Where your first movement stops: short of the target, on it, or past it',
      'How long before your hand starts moving',
      'How long the flick takes vs. the fixing afterwards',
      'Where your misses go: early, late or to the side',
    ],
    tips: ['Short flicks are mostly wrist and fingers.', "Don't click while the crosshair is still sliding."],
    stars: [45, 60, 75],
    levels: BLINK.map(flickLabel),
    make: (g, level) => {
      const n = clampLevel(level, BLINK.length);
      return new FlickDrill(g, 'blink', 'Blink', 'SHORT FLICKS', BLINK[n - 1], n);
    },
  },
  {
    id: 'snap',
    name: 'Snap',
    skill: 'Wide flicks',
    kicker: 'WIDE FLICKS',
    chapter: 'flicking',
    oneLiner: 'Targets appear anywhere around you — even behind. Turn, stop on it, click.',
    job: ['Find the target — check your sides, it can be behind you.', 'Turn to it in one big movement.', 'Stop, fix if you need to, then click.'],
    scoring: 'Your score combines how many you hit, how fast, and how few shots you wasted.',
    measures: ['Where your big movements land: short, on target or past it', 'Short vs. wide flicks compared', 'Left vs. right, up vs. down', 'Reaction, flick and fix-up time'],
    tips: ['Big turns come from the elbow and shoulder, not the wrist.', 'Aim to stop on the target, not just reach it.'],
    stars: [45, 60, 75],
    levels: SNAP.map(flickLabel),
    make: (g, level) => new FlickDrill(g, 'snap', 'Snap', 'WIDE FLICKS', SNAP[L(level) - 1], L(level)),
  },
  {
    id: 'echo',
    name: 'Echo',
    skill: 'Sound awareness',
    kicker: 'SOUND AWARENESS',
    chapter: 'listening',
    oneLiner: 'Targets appear beside and behind you. Listen, turn the short way, flick.',
    job: ['Put headphones on.', 'When you hear the ping, turn toward it straight away — the short way round.', 'Stop on the target and click.'],
    scoring: 'Hits and speed, with a bonus for turning the right way first.',
    measures: ['Whether your first turn went the short way', 'How soon after the sound you started turning', 'Sounds in front vs. behind: which fool you'],
    tips: ['Sounds behind you are duller than sounds in front.', 'Start turning on the sound — your eyes will catch the target on the way.'],
    stars: [35, 50, 65],
    levels: ECHO.map(echoLabel),
    make: (g, level) => new EchoDrill(g, ECHO[L(level) - 1], L(level)),
  },
  {
    id: 'pin',
    name: 'Pin',
    skill: 'Precision',
    kicker: 'PRECISION',
    chapter: 'precision',
    oneLiner: 'Tiny targets far away. Slow down, line it up, click.',
    job: ['Move close to the target quickly.', 'Slow down for the last bit — use your fingers.', 'Click only when you are right on it.'],
    scoring: 'Your score is hits × accuracy: wasted shots cost you.',
    measures: ['Hits and accuracy', 'Time per target', 'How still your crosshair is when you click'],
    tips: ['Rest your wrist on the desk for fine control.', 'A tiny pause beats a miss.'],
    stars: [35, 50, 65],
    levels: PIN.map((p, i) => `${(p.radius * 2 * 100).toFixed(0)} cm targets at ${Math.round(p.minDist)}–${Math.round(p.maxDist)} m${p.drift ? ' · drifting' : ''}${i === 9 ? ' · hardest' : ''}`),
    make: (g, level) => new PinDrill(g, PIN[L(level) - 1], L(level)),
  },
  {
    id: 'triad',
    name: 'Triad',
    skill: 'Target switching',
    kicker: 'TARGET SWITCHING',
    chapter: 'switching',
    oneLiner: 'Several enemies at once. Take one down, move straight to the next.',
    job: ['Hold fire on one enemy until it drops.', 'Move to the closest next enemy right away.', 'Repeat as fast as you can.'],
    scoring: 'Your score is eliminations, boosted by accuracy.',
    measures: ['Time between a kill and your next hit', 'Accuracy while switching'],
    tips: ['Look for the next target while the current one is dying.', 'Closest first, unless someone is almost dead.'],
    stars: [40, 55, 70],
    levels: TRIAD.map((t) => `${t.count} enemies · ${t.hp} health · ${Math.round(t.duelShare * 100)}% dodgers`),
    make: (g, level) => {
      const n = clampLevel(level, TRIAD.length);
      return new TriadDrill(g, TRIAD[n - 1], n);
    },
  },
  {
    id: 'corner',
    name: 'Corner Watch',
    skill: 'Crosshair placement',
    kicker: 'CROSSHAIR PLACEMENT',
    chapter: 'placement',
    oneLiner: 'Enemies peek out from behind three walls. Keep your crosshair where their head will appear.',
    job: [
      "You can't move — just aim.",
      'Rest your crosshair on the edge of a wall, at head height.',
      'When a head appears, shoot it before it hides again.',
    ],
    scoring: 'Your score is how many you got, reduced if your crosshair was far away when they appeared.',
    measures: ['How far your crosshair was from each head when it appeared', 'Whether you rest too low or too high', 'Time to kill'],
    tips: ['Wall edges, head height — always.', 'Switch between walls in one quick move.'],
    stars: [40, 60, 75],
    levels: CORNER.map((c) => `They stay out ${c.exposure[0].toFixed(1)}–${c.exposure[1].toFixed(1)} s`),
    make: (g, level) => new CornerWatchDrill(g, CORNER[L(level) - 1], L(level)),
  },
  {
    id: 'crossfire',
    name: 'Crossfire',
    skill: 'Moving while aiming',
    kicker: 'MOVEMENT × AIM',
    chapter: 'movement',
    oneLiner: 'The same duel as Duelist, with one rule: your shots only count while you are moving.',
    job: ['Hold A or D to strafe while shooting, and keep changing direction.', 'Keep your crosshair on the enemy while your body moves.', 'Standing still = no damage.'],
    scoring: 'Your score is time on target multiplied by time spent moving.',
    measures: ['Time on target', 'Time spent moving', 'Reaction to their dodges'],
    tips: ['Your hand cancels out your own movement — that is the skill.', 'Uneven rhythms are harder to hit than steady ones.'],
    stars: [30, 45, 60],
    levels: DUEL.slice(0, MAX_LEVEL).map((d) => d.label),
    make: (g, level) => new CrossfireDrill(g, DUEL[L(level) - 1], L(level)),
  },
];

export const drillDef = (id: string): DrillDef | undefined => DRILL_DEFS.find((d) => d.id === id);

/** How many levels a drill has (most have MAX_LEVEL). */
export const levelCount = (id: string): number => drillDef(id)?.levels.length ?? MAX_LEVEL;
