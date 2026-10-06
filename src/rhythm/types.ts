/**
 * Overdrive (rhythm drill) data types: songs, analysis, structure, style presets and charts.
 *
 * Types and `as const` lists only. Pure: no DOM, no WebAudio, no runtime logic, so every
 * module under src/rhythm (and its vitest tests) can import this in node.
 *
 * All times are seconds of song time unless a field says otherwise (glossary: Song time).
 */

// ---------------------------------------------------------------------------------------------
// Shared lists
// ---------------------------------------------------------------------------------------------

/** Glossary: Difficulty. Lowercase ids; the UI labels them Easy / Normal / Hard / Expert. */
export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Glossary: Section. Intro and outro are positional (first and last section only); the middle
 * sections are classified by energy as calm, build or peak.
 */
export const SECTION_KINDS = ['intro', 'calm', 'build', 'peak', 'outro'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Glossary: Target type (D2). `kind` on ChartTarget. */
export const TARGET_KINDS = ['flick', 'burst', 'strafer', 'hold', 'peeker', 'decoy'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Flick shapes (D14): circle = normal on-screen flick, diamond = small precision, triangle = wide off-screen flick. */
export const FLICK_SHAPES = ['circle', 'diamond', 'triangle'] as const;
export type FlickShape = (typeof FLICK_SHAPES)[number];

/**
 * Glossary: Style preset id. Only 'mixed' ships in this version (D8); the roadmap presets
 * (Quick taps, Tracker, Incoming) will be added here, so the list stays open to extension.
 * The type is a string-literal union seeded from this list.
 */
export const PRESET_IDS = ['mixed'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

// ---------------------------------------------------------------------------------------------
// Song and analysis
// ---------------------------------------------------------------------------------------------

/**
 * Glossary: Song. Library metadata for one audio file the player added (never built in, D11).
 * The audio bytes live in IndexedDB, not here and not in localStorage.
 */
export interface SongMeta {
  /** SHA-256 hex of the file bytes. */
  id: string;
  /** File name without its extension. */
  name: string;
  mime: string;
  /** Length in seconds. */
  duration: number;
  /** ISO date string of when it was added. */
  addedAt: string;
  /** The Style preset chosen when the song was added (D7). */
  preset: PresetId;
  /** The Difficulty chosen for the song (D9). */
  difficulty: Difficulty;
}

/**
 * Result of tempo, beat and onset analysis of one Song's audio (T3). Glossary: Song, Beat.
 * It has no downbeats; those belong to Structure.
 */
export interface Analysis {
  /** Analysis algorithm version, stamped so cached results can be invalidated. */
  version: number;
  sampleRate: number;
  /** Seconds. */
  duration: number;
  bpm: number;
  /** Beat times in seconds (glossary: Beat). */
  beats: number[];
  /** Per-beat RMS energy, one value per entry of `beats`. */
  beatEnergy: number[];
  /** Onset-strength envelope (spectral flux), one value per frame. */
  onsetEnv: Float32Array;
  /** Seconds per `onsetEnv` frame. */
  onsetHop: number;
  /** 0..1: how sure the tempo and beat tracking are. */
  confidence: number;
}

/** A stretch of the Song (glossary: Section): at least 4 bars, bar-aligned. */
export interface Section {
  /** Index into `Structure.bars` of the first bar. */
  startBar: number;
  /** Index of the bar after the last one (exclusive). */
  endBar: number;
  kind: SectionKind;
}

/** Bars and Sections of a Song (T4), derived from its Analysis. Glossary: Bar, Section. */
export interface Structure {
  /** Downbeat times in seconds (the first beat of each bar). */
  downbeats: number[];
  /** Bar start times in seconds. */
  bars: number[];
  sections: Section[];
}

// ---------------------------------------------------------------------------------------------
// Style preset
// ---------------------------------------------------------------------------------------------

/** What the generator does in one Section kind (glossary: Style preset). */
export interface PresetRow {
  /** Chance of each Target type for one spawn in this Section kind; sums to 1 (V5). 0 = never. */
  weights: Record<TargetKind, number>;
  /**
   * Targets per bar before the level's density multiplier, ramped linearly from `from` on the
   * section's first bar to `to` on its last (V5: build 2 → 4; other kinds have from = to).
   * A Burst counts as one target.
   */
  perBar: { from: number; to: number };
}

/**
 * Named multipliers on the level table's target parameters (D7). Omitted means 1. Names are
 * generic; T5's level table defines what each one scales:
 *  - density: targets per bar.
 *  - targetRadius: target size.
 *  - window: hit window length (leadBeats / afterBeats).
 *  - straferSpeed: Strafer movement speed.
 *  - straferHealth: Strafer health (e.g. 1.5 for a Tracker preset).
 *  - holdBeats: how many beats a Hold lasts.
 * T5 may extend this list to match the level table.
 */
export type PresetParams = Partial<
  Record<'density' | 'targetRadius' | 'window' | 'straferSpeed' | 'straferHealth' | 'holdBeats', number>
>;

/**
 * Glossary: Style preset. Data that shapes a Chart: Target type weights and targets per bar for
 * each Section kind, the flick shape split, and optional multipliers on target parameters.
 * Presets are data (D7); the MVP ships Mixed only (D8, V5).
 */
export interface Preset {
  id: PresetId;
  name: string;
  rows: Record<SectionKind, PresetRow>;
  /** Chance of each Flick shape when a flick is picked (D14); sums to 1. */
  flickShapes: Record<FlickShape, number>;
  params?: PresetParams;
}

// ---------------------------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------------------------

/**
 * Where a Target is, seen from the player's start point.
 *  - bearing: degrees clockwise from straight ahead, matching dirFrom() in src/drills/common.ts.
 *  - pitch: degrees up. Ignored for figures (strafer, peeker, decoy): their position is the
 *    ground point they stand on.
 *  - distance: metres.
 */
export interface TargetPosition {
  bearing: number;
  pitch: number;
  distance: number;
}

/**
 * Fields every Target has (glossary: Target, Target beat, Hit window). All times are seconds
 * of song time.
 *  - launchTime: when it starts flying in (landTime minus 1 beat, D4).
 *  - landTime: when it lands and the Hit window opens (targetTime minus leadBeats).
 *  - targetTime: the Target beat, the moment a hit scores Perfect.
 *  - windowEnd: end of the Hit window (targetTime plus afterBeats). A target not hit by then is
 *    missed and removed. For strafers, holds and peekers it is instead the end of their life
 *    (see each type), so windowEnd is always when the target vanishes.
 * These base times are the only timing fields: type-specific fields never repeat them.
 */
export interface TargetBase {
  kind: TargetKind;
  launchTime: number;
  landTime: number;
  targetTime: number;
  windowEnd: number;
  position: TargetPosition;
}

/** Circle, diamond or triangle flick (D2, D14). */
export interface FlickTarget extends TargetBase {
  kind: 'flick';
  shape: FlickShape;
}

/**
 * A cluster of orbs, each with its own beat. Counts as ONE target in density. `position` is the
 * cluster centre; orb positions are absolute, not offsets. targetTime is the first orb's time
 * and windowEnd is afterBeats past the last orb's time.
 */
export interface BurstTarget extends TargetBase {
  kind: 'burst';
  orbs: { time: number; position: TargetPosition }[];
}

/**
 * A player figure that strafes in time with the music. It lives from landTime until windowEnd,
 * which the generator sets from the level's strafer life (8 beats) rather than afterBeats.
 */
export interface StraferTarget extends TargetBase {
  kind: 'strafer';
  /** Multiplier on the bot's movement speed (StyleTuning.speed in src/world/brain.ts). */
  speed: number;
  /** Health to remove before it counts as killed. */
  health: number;
}

/**
 * An orb that follows a path whose progress depends only on song time (not on frame time), so
 * it is fully determined by the clock. It lands at path[0] (= position) and waits there until
 * targetTime, then travels to the last point, arriving at windowEnd; the generator sets
 * windowEnd = targetTime + the level's hold length rather than afterBeats.
 */
export interface HoldTarget extends TargetBase {
  kind: 'hold';
  /** Path points, at least two; path[0] equals position. */
  path: TargetPosition[];
}

/**
 * A figure that peeks out from behind a Wall. It shows on the target beat and ducks back on
 * the next beat, which is its windowEnd (the level's "peeker shows for 1 beat").
 */
export interface PeekerTarget extends TargetBase {
  kind: 'peeker';
  /** Index into `Chart.walls`. */
  wall: number;
  /** Which edge of the wall it peeks round: -1 left, 1 right. */
  side: -1 | 1;
}

/** A friendly-coloured figure that must not be shot. No parameters beyond the base. */
export interface DecoyTarget extends TargetBase {
  kind: 'decoy';
}

/** Glossary: Target (`ChartTarget`). A union discriminated on `kind` (Target type, D2). */
export type ChartTarget =
  | FlickTarget
  | BurstTarget
  | StraferTarget
  | HoldTarget
  | PeekerTarget
  | DecoyTarget;

/** Cover that Peekers hide behind. Bearing in degrees, distance and size in metres. */
export interface Wall {
  bearing: number;
  distance: number;
  width: number;
  height: number;
}

/**
 * Glossary: Chart. The timed list of Targets (and walls) for one Song at one Style preset and
 * Level, generated deterministically from them (D7).
 */
export interface Chart {
  /** SongMeta.id of the Song it was built for. */
  songId: string;
  preset: PresetId;
  difficulty: Difficulty;
  /** The drill level (1-10) the chart was built at, inside the difficulty's band. */
  level: number;
  /** Song length in seconds. */
  duration: number;
  /** Sorted by targetTime. */
  targets: ChartTarget[];
  walls: Wall[];
}
