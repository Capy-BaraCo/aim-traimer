/**
 * Seeded Chart generator for Overdrive (T6; D4, D7, D12, D14, D18, D19, R2):
 * generate(analysis, structure, preset, level, songId) → Chart.
 * Pure: no DOM, no WebAudio, so it runs in vitest (node) and wherever a chart is needed.
 *
 * Same inputs, same Chart: every choice comes from one mulberry32 stream seeded by
 * hash(songId, preset id, level) and drawn in a fixed order. "N beats" is always measured along
 * the song's own Beats (interpolated between neighbours, extrapolated with the nearest interval at
 * the ends, and bridged across silent gaps with the local period), never as N × 60 / bpm, because
 * real songs drift.
 *
 * Fun first (D19): the preset matrix and D18's feel are the starting point, and a run gets musical
 * shape on top of them. Everything is placed on one timeline (the Board) that checks the rules
 * below for every target, so a target that doesn't fit is left out (a rest):
 *  1. Moments (confident beat grid only). A fill into every Peak that follows another Section: a
 *     burst of 3–5 orbs on the eighths before its first downbeat, rising towards the drop, then a
 *     diamond on that downbeat (D18), echoed by a circle a beat later on every second peak from
 *     level 4. A three-orb pickup closes each Build phrase that doesn't run into a peak, and a
 *     diamond on the last downbeat ends the song.
 *  2. Patterns, phrase by phrase (4 Bars):
 *     - Rhythm. Each Bar's count is the row's Targets per Bar (ramped across a Build) × the level's
 *       density, spread evenly over the phrase. Slots sit on the row's slot grid (D18), chosen by a
 *       priority per phrase: the onset strength at that place in the Bar across the phrase times a
 *       metric weight (downbeat, beat 3, backbeats, off-beats, and the "and" of 2 and 4 in peaks),
 *       so the rhythm follows the groove, repeats as a motif and grows as a Build ramps. The
 *       phrase's last Bar varies it (in a peak it anticipates a beat by an eighth: syncopation),
 *       and quiet Bars in steady Sections rest. A tap whose slot an earlier burst took moves to the
 *       best free slot left in its Bar, so a burst counts as one target.
 *     - Movement. Positions follow a pattern per phrase (sweep, zigzag, arc, ring, cross, stairs)
 *       answered in the next Bar, mirrored (call and response) or moved along (a sequence); sparse
 *       phrases unfold one pattern over the whole phrase instead.
 *     - Big events first. Strafers and holds (only one alive at a time) and triangles (which need a
 *       clear turn) are planned before the phrase's other notes, on its strongest beats, so they
 *       get their share; the order between the two alternates at random.
 *     - Types come from the row's weights, pulled back towards them whenever they drift, so the mix
 *       holds where long targets don't fit; shapes from the flick split, with a diamond on the
 *       phrase's strongest onsets (accents). Decoys stand beside the real target that follows
 *       them, where a hurried flick stops.
 * Rules every target obeys:
 *  - targetTime is on a Beat or the eighth between two Beats (confident grid), else on an onset peak.
 *  - landTime = targetTime − leadBeats rounded to the row's land grid (D18, never below 1 beat);
 *    triangles get one more beat to turn, and holds always land HOLD_LEAD (1) beat before they set
 *    off. launchTime = landTime − flyInBeats. windowEnd per type as types.ts says; a strafer lives
 *    the level's strafer life (two Bars) in a steady Section with room for it, else one Bar.
 *  - At most maxConcurrent targets on screen together ([launchTime, windowEnd) overlaps); never two
 *    strafers or holds alive at once ([landTime, windowEnd) overlaps); hit moments at least the
 *    level's gap apart (a beat at levels 1–3, an eighth above); a clear turn around every triangle
 *    with nothing to track during it; no two targets covering the same spot; and at levels 1–3
 *    nothing to click while you are tracking.
 *  - Positions stay in the readable view (±22–35° bearing by level, a pitch band kept above the
 *    floor, 11–15.5 m); triangles 60–150° to the side; peekers behind the chart's two walls, which
 *    stand beyond every other target so they never hide one. No windowEnd passes the song's end (D12).
 * Low confidence (R2) or no downbeats: slots are onset peaks, a beat is 60 / bpm, and there are no
 * grids, fills or moments.
 */
import { DIFFICULTY_BANDS, levelParams, type LevelParams } from './levels';
import {
  DIFFICULTIES, FLICK_SHAPES, TARGET_KINDS,
  type Analysis, type BurstTarget, type Chart, type ChartTarget, type DecoyTarget, type Difficulty,
  type FlickShape, type FlickTarget, type HoldTarget, type PeekerTarget, type Preset,
  type PresetRow, type SectionKind, type StraferTarget, type Structure, type TargetKind,
  type TargetPosition, type Wall,
} from './types';

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Why a target is in a Chart. Only 'pattern' targets are drawn from the preset's type weights;
 * the rest are the moments on top: 'fill' (the run into a peak), 'drop' (the peak's first
 * downbeat) and 'flourish' (build pickups and the song's last downbeat).
 */
export type TargetRole = 'pattern' | 'fill' | 'drop' | 'flourish';

/** A Chart and the role of each of its targets (same order as chart.targets). */
export interface Composition {
  chart: Chart;
  roles: TargetRole[];
}

/** Below this Analysis.confidence the beat grid is not trusted: slots are onset peaks (R2). */
export const MIN_GRID_CONFIDENCE = 0.4;
/** How far (m) a strafer may move to either side of its position; T15's strafe lane should keep to it. */
export const STRAFE_LANE = 2.5;
/** Beats a hold waits at path[0] before it sets off: its lead at every level (landTime = targetTime − HOLD_LEAD beats). */
export const HOLD_LEAD = 1;
/** A peeker hides PEEK_DEPTH (m) behind its wall's middle and steps PEEK_STEP (m) past the wall's edge to peek, as in Corner Watch. */
export const PEEK_DEPTH = 1.25;
export const PEEK_STEP = 0.85;

/** The Chart for a Song at a Style preset and Level (D7): deterministic for the same inputs. */
export function generate(analysis: Analysis, structure: Structure, preset: Preset, level: number, songId: string): Chart {
  return compose(analysis, structure, preset, level, songId).chart;
}

/** generate(), plus the role of every target (for tests, and for cues that celebrate drops). */
export function compose(analysis: Analysis, structure: Structure, preset: Preset, level: number, songId: string): Composition {
  return new Composer(analysis, structure, preset, level, songId).run();
}

/** The 32-bit seed for a chart: hash(songId, preset id, level) (D7). */
export function chartSeed(songId: string, presetId: string, level: number): number {
  return hash32(`${songId}\u0000${presetId}\u0000${level}`);
}

/** Where a peeker hides: PEEK_DEPTH behind the middle of its wall (a ground point). */
export function hidePosition(wall: Wall): TargetPosition {
  return wallPoint(wall, 0);
}

/** Where a peeker stands when out: PEEK_DEPTH behind its wall, side × (half the width + PEEK_STEP) along it (-1 left, 1 right). */
export function peekPosition(wall: Wall, side: -1 | 1): TargetPosition {
  return wallPoint(wall, side * (wall.width / 2 + PEEK_STEP));
}

// ---------------------------------------------------------------------------------------------
// Tunables (the header says why each rule exists)
// ---------------------------------------------------------------------------------------------

/** A beat interval over this × the median of its neighbours is a gap (silence), bridged with virtual beats. */
const GAP_RATIO = 1.6;
/** Bars per phrase: motifs repeat and answer inside one. */
const PHRASE_BARS = 4;
/** A Bar this many dB under its Section's median is a quiet moment: steady Sections rest there. */
const QUIET_DB = 6;
/** Nothing lands in the first second of the song, so the player can settle. */
const START_GRACE = 1;
/**
 * Type and shape mix. Counts fade by MIX_FADE per pick, so the mix is that of the last ~50 targets
 * of a Section kind. A type behind its share is pulled in (× e^(MIX_PULL × deficit)); a type ahead
 * of it by more than MIX_SLACK + MIX_SHARE × the recent count sits out, so where long targets can't
 * fit the others fill in, but only so far (about 5 points) before a slot rests instead.
 */
const MIX_FADE = 1 - 1 / 48;
const MIX_PULL = 2;
const MIX_SLACK = 0.75;
const MIX_SHARE = 0.04;
/**
 * A steady Section's strafers stay two Bars (the level's strafer life) only while its strafers and
 * holds would fill at most this share of the time at full count; otherwise one Bar, so both keep
 * their shares (only one tracking target is ever alive).
 */
const LONG_STRAFE_DEMAND = 0.7;
/** Mean targets per Bar from which a motif repeats every Bar; below it one pattern unfolds over the phrase. */
const BAR_MOTIF_COUNT = 2.5;
/** Onset peaks (low confidence): a local maximum over ±PEAK_RADIUS frames, at least PEAK_FLOOR and PEAK_OVER_MEDIAN × the median non-zero frame. */
const PEAK_RADIUS = 5;
const PEAK_FLOOR = 0.12;
const PEAK_OVER_MEDIAN = 3;
/** Onset strength at a slot: the strongest frame within ±this many frames (about 20 ms). */
const STRENGTH_RADIUS = 2;
/** Low confidence: burst orbs sit on consecutive onset peaks at least this far apart (s) and at most this many beats apart. */
const ORB_MIN_SECONDS = 0.09;
const ORB_MAX_BEATS = 0.75;

/** The shortest time (s) between two hit moments, at level 1 and level 10: roughly a small flick and settle. */
const MIN_GAP_SECONDS_EASY = 0.32;
const MIN_GAP_SECONDS_EXPERT = 0.26;

/** Player and figure geometry in metres (OW stand heights, src/world/movement.ts). */
const EYE_HEIGHT = 1.65;
const FIGURE_HEIGHT = 1.9;
const FIGURE_HALF_WIDTH = 0.45;
/** The lowest an orb's centre may sit above the floor, so none sinks into the grid. */
const ORB_FLOOR = 0.6;
/** Distance band (m) of every target but peekers. */
const NEAR = 11;
const FAR = 15.5;
/** Walls stand beyond FAR (front face at 16.65 m), so they never hide another target. */
const WALL_DISTANCE = 17;
const WALL_WIDTH = 2.6;
const WALL_HEIGHT = 2.4;

const DEG = Math.PI / 180;
const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Median of a numeric list (0 when empty). */
function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const s = Array.from(values).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The q-quantile (0..1) of a numeric list, nearest rank (0 when empty). */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Reflect x back into [-1, 1]. */
function fold(x: number): number {
  let v = x;
  for (let i = 0; i < 4 && (v > 1 || v < -1); i++) v = v > 1 ? 2 - v : -2 - v;
  return clamp(v, -1, 1);
}

/** 32-bit FNV-1a with a final avalanche, so similar ids give unrelated seeds. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG with floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The Difficulty band a Level sits in (D9). */
function difficultyOf(level: number): Difficulty {
  for (const d of DIFFICULTIES) if (level >= DIFFICULTY_BANDS[d].from && level <= DIFFICULTY_BANDS[d].to) return d;
  return 'easy';
}

/** A ground point `along` metres along a wall's face (positive = right), PEEK_DEPTH behind its middle. */
function wallPoint(wall: Wall, along: number): TargetPosition {
  const b = wall.bearing * DEG;
  const r = wall.distance + PEEK_DEPTH;
  // Radial (away from the player) and tangent (to the right) unit vectors in XZ, as bearingXZ.
  const x = r * Math.sin(b) + along * Math.cos(b);
  const z = -r * Math.cos(b) + along * Math.sin(b);
  return { bearing: Math.atan2(x, -z) / DEG, pitch: 0, distance: Math.hypot(x, z) };
}

// ---------------------------------------------------------------------------------------------
// Beat grid
// ---------------------------------------------------------------------------------------------

/**
 * The timeline "beats" are measured on: the analysis Beats plus virtual beats bridging silent
 * gaps (or, with no trusted grid, a uniform 60 / bpm grid of virtual beats). Positions are in
 * beats: k is beat k, k + 0.5 the eighth half-way to the next.
 */
class Grid {
  private constructor(
    readonly times: number[],
    /** The beat is one of analysis.beats (audible), not a virtual one. */
    readonly real: boolean[],
    /** Its index in analysis.beats (-1 for virtual beats). */
    readonly source: number[],
  ) {}

  static fromBeats(beats: number[]): Grid {
    const clean: number[] = [];
    const index: number[] = [];
    beats.forEach((t, i) => {
      if (Number.isFinite(t) && (clean.length === 0 || t > clean[clean.length - 1] + EPS)) {
        clean.push(t);
        index.push(i);
      }
    });
    const intervals = clean.slice(1).map((t, i) => t - clean[i]);
    const times: number[] = [];
    const real: boolean[] = [];
    const source: number[] = [];
    for (let i = 0; i < clean.length; i++) {
      times.push(clean[i]);
      real.push(true);
      source.push(index[i]);
      if (i + 1 >= clean.length) break;
      const d = intervals[i];
      const local = median(intervals.slice(Math.max(0, i - 4), i).concat(intervals.slice(i + 1, i + 5)));
      if (local > 0 && d > GAP_RATIO * local) {
        const k = Math.round(d / local) - 1;
        for (let j = 1; j <= k; j++) {
          times.push(clean[i] + (j * d) / (k + 1));
          real.push(false);
          source.push(-1);
        }
      }
    }
    return new Grid(times, real, source);
  }

  static uniform(period: number, duration: number): Grid {
    const n = Math.max(2, Math.ceil(Math.max(0, duration) / period) + 2);
    const times = Array.from({ length: n }, (_, i) => i * period);
    return new Grid(times, times.map(() => false), times.map(() => -1));
  }

  get length(): number {
    return this.times.length;
  }

  /** Song time of a position, interpolated between beats and extrapolated past the ends. */
  at(pos: number): number {
    const t = this.times;
    const n = t.length;
    if (n < 2) return (t[0] ?? 0) + pos * 0.5;
    if (pos <= 0) return t[0] + pos * (t[1] - t[0]);
    if (pos >= n - 1) return t[n - 1] + (pos - (n - 1)) * (t[n - 1] - t[n - 2]);
    const k = Math.floor(pos);
    const frac = pos - k;
    return frac === 0 ? t[k] : t[k] + frac * (t[k + 1] - t[k]);
  }

  /** Position of a song time (the inverse of at). */
  pos(time: number): number {
    const t = this.times;
    const n = t.length;
    if (n < 2) return (time - (t[0] ?? 0)) / 0.5;
    if (time <= t[0]) return (time - t[0]) / (t[1] - t[0]);
    if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]) / (t[n - 1] - t[n - 2]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - t[lo]) / (t[lo + 1] - t[lo]);
  }

  /** An audible slot: a real Beat, or the eighth between two neighbouring real Beats. */
  audible(pos: number): boolean {
    const k = Math.floor(pos + EPS);
    const frac = pos - k;
    if (k < 0 || k >= this.times.length) return false;
    if (Math.abs(frac) < EPS) return this.real[k];
    if (Math.abs(frac - 0.5) < EPS) return k + 1 < this.times.length && this.real[k] && this.real[k + 1];
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Mix
// ---------------------------------------------------------------------------------------------

/** Keeps a weighted mix close to its weights: picks are random but pulled towards each key's recent share. */
class Quota<K extends string> {
  private readonly counts = new Map<string, Map<K, number>>();

  /**
   * Keys to try for one pick, most wanted first. Keys too far past their share are left out, or
   * with `all` put last (by weight) instead. The `strict` key never runs ahead to fill in.
   */
  order(group: string, weights: Record<K, number>, keys: readonly K[], random: () => number, all = false, strict?: K): K[] {
    const counts = this.group(group);
    let total = 0;
    for (const n of counts.values()) total += n;
    const pool: { key: K; w: number }[] = [];
    const late: K[] = [];
    for (const key of keys) {
      const weight = weights[key];
      if (!(weight > 0)) continue;
      const deficit = weight * (total + 1) - (counts.get(key) ?? 0);
      const slack = MIX_SLACK + (key === strict ? 0 : MIX_SHARE * total);
      if (deficit > -slack) pool.push({ key, w: weight * Math.exp(MIX_PULL * Math.min(deficit, 8)) });
      else if (all) late.push(key);
    }
    late.sort((a, b) => weights[b] - weights[a]);
    const out: K[] = [];
    while (pool.length > 0) {
      let sum = 0;
      for (const c of pool) sum += c.w;
      let r = random() * sum;
      let i = 0;
      while (i < pool.length - 1 && (r -= pool[i].w) >= 0) i++;
      out.push(pool[i].key);
      pool.splice(i, 1);
    }
    return out.concat(late);
  }

  /** How far `key` is behind its share once `upcoming` more picks are made (negative: ahead). */
  owed(group: string, key: K, weight: number, upcoming: number): number {
    const counts = this.group(group);
    let total = 0;
    for (const n of counts.values()) total += n;
    return weight * (total + upcoming) - (counts.get(key) ?? 0);
  }

  add(group: string, key: K): void {
    const counts = this.group(group);
    for (const [k, n] of counts) counts.set(k, n * MIX_FADE);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  private group(group: string): Map<K, number> {
    let counts = this.counts.get(group);
    if (!counts) {
      counts = new Map();
      this.counts.set(group, counts);
    }
    return counts;
  }
}

// ---------------------------------------------------------------------------------------------
// The Board: placed targets and the rules between them
// ---------------------------------------------------------------------------------------------

interface Span {
  from: number;
  to: number;
}

/** A rectangle on screen in degrees (bearing b0..b1, pitch p0..p1). */
interface Print {
  b0: number;
  b1: number;
  p0: number;
  p1: number;
}

/** A target with the facts the rules check. All times in seconds. */
interface Item {
  target: ChartTarget;
  role: TargetRole;
  /** On screen: [launchTime, windowEnd). */
  launch: number;
  end: number;
  /** Strafers and holds: alive, [landTime, windowEnd). */
  alive?: Span;
  /** The crosshair is taken: a strafer's life, a hold's travel. */
  busy?: Span;
  /** Triangles: the turn there and back. */
  turn?: Span;
  /** Hit moments (a flick or peeker's targetTime, each burst orb) and the clear zone around them. */
  marks?: number[];
  zone?: Span;
  /** Positions of the first and last hit moment, for the next flick's distance. */
  first?: TargetPosition;
  last?: TargetPosition;
  triangle?: boolean;
  prints: Print[];
  /** Peekers: which wall (-1 left, 1 right). */
  wallSide?: -1 | 1;
  /** Everything above lies inside [lo, hi). */
  lo: number;
  hi: number;
}

const overlaps = (a: Span, b: Span): boolean => a.from < b.to - EPS && b.from < a.to - EPS;
const inside = (t: number, s: Span): boolean => t > s.from + EPS && t < s.to - EPS;
const printsMeet = (a: Print, b: Print): boolean => a.b0 < b.b1 && b.b0 < a.b1 && a.p0 < b.p1 && b.p0 < a.p1;

/** Fill in an Item's [lo, hi) from its spans. */
function bounded(item: Omit<Item, 'lo' | 'hi'>): Item {
  let lo = item.launch;
  let hi = item.end;
  for (const s of [item.alive, item.busy, item.turn, item.zone]) {
    if (!s) continue;
    lo = Math.min(lo, s.from);
    hi = Math.max(hi, s.to);
  }
  return { ...item, lo, hi };
}

class Board {
  /** Sorted by lo. */
  readonly items: Item[] = [];
  private longest = 0;

  /** Items whose [lo, hi) meets [from, to). */
  near(from: number, to: number): Item[] {
    const list = this.items;
    let a = 0;
    let b = list.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (list[mid].lo < to) a = mid + 1;
      else b = mid;
    }
    const out: Item[] = [];
    for (let i = a - 1; i >= 0; i--) {
      const it = list[i];
      if (it.lo < from - this.longest) break;
      if (it.hi > from) out.push(it);
    }
    return out;
  }

  /** The time rules: on-screen cap, tracking, hit-moment gaps, triangle turns, one peeker per wall. */
  fits(c: Item, maxConcurrent: number, tapsWhileTracking: boolean): boolean {
    const others = this.near(c.lo, c.hi);
    const onScreen = others.filter((o) => o.launch < c.end - EPS && o.end > c.launch + EPS);
    if (onScreen.length >= maxConcurrent) {
      const points = [c.launch];
      for (const o of onScreen) if (o.launch > c.launch && o.launch < c.end) points.push(o.launch);
      for (const x of points) {
        let n = 1;
        for (const o of onScreen) if (o.launch <= x + EPS && x < o.end - EPS) n++;
        if (n > maxConcurrent) return false;
      }
    }
    for (const o of others) {
      if (c.alive && o.alive && overlaps(c.alive, o.alive)) return false;
      if (c.alive && o.turn && overlaps(c.alive, o.turn)) return false;
      if (c.turn && o.alive && overlaps(c.turn, o.alive)) return false;
      if (c.zone && o.zone && overlaps(c.zone, o.zone)) return false;
      if (c.wallSide !== undefined && c.wallSide === o.wallSide && c.launch < o.end - EPS && o.launch < c.end - EPS) return false;
      if (!tapsWhileTracking) {
        const busy = o.busy;
        if (c.marks && busy && c.marks.some((m) => inside(m, busy))) return false;
        const mine = c.busy;
        if (mine && o.marks && o.marks.some((m) => inside(m, mine))) return false;
      }
    }
    return true;
  }

  /** The space rule: nothing on screen at the same time covers the same spot. */
  clear(c: Item): boolean {
    for (const o of this.near(c.launch, c.end)) {
      if (!(o.launch < c.end - EPS && o.end > c.launch + EPS)) continue;
      for (const a of c.prints) for (const b of o.prints) if (printsMeet(a, b)) return false;
    }
    return true;
  }

  add(item: Item): void {
    const list = this.items;
    let a = 0;
    let b = list.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (list[mid].lo <= item.lo) a = mid + 1;
      else b = mid;
    }
    list.splice(a, 0, item);
    this.longest = Math.max(this.longest, item.hi - item.lo);
  }

  remove(item: Item): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** The tap whose last hit moment comes latest before `time`. */
  previousTap(time: number): Item | undefined {
    let best: Item | undefined;
    let bestTime = -Infinity;
    for (const o of this.near(time - 12, time)) {
      const marks = o.marks;
      if (!marks || marks.length === 0) continue;
      const lastMark = marks[marks.length - 1];
      if (lastMark < time - EPS && lastMark > bestTime) {
        bestTime = lastMark;
        best = o;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------------------------
// Level feel
// ---------------------------------------------------------------------------------------------

interface Feel {
  p: LevelParams;
  /** 0 at level 1, 1 at level 10. */
  f: number;
  /** The readable view: bearing ±bearingMax, pitch pitchMin..pitchMax (degrees). */
  bearingMax: number;
  pitchMin: number;
  pitchMax: number;
  /** Degrees between consecutive taps: at least minJump, at most maxJump per beat between them (up to two beats). */
  minJump: number;
  maxJump: number;
  /** Degrees between any two targets on screen together. */
  minSep: number;
  /** Beats between hit moments. */
  minGap: number;
  /** Beats kept clear either side of a triangle, to turn there and back. */
  turnGuard: number;
  /** Degrees past 60 a triangle may be. */
  triangleArc: number;
  burstOrbs: [number, number];
  /** Degrees between neighbouring burst orbs. */
  orbStep: number;
  fillOrbs: number;
  /** Degrees a hold travels. */
  holdTravel: number;
  /** Bearing of the two walls (±). */
  wallBearing: number;
  /** Levels 4+ may ask for a click while you track. */
  tapsWhileTracking: boolean;
}

function feelFor(p: LevelParams, level: number, period: number): Feel {
  const f = (level - 1) / 9;
  // Beats are the wrong unit on fast songs: half a beat at 174 BPM is 0.17 s, too quick to flick to a new
  // target. So the gap is also a minimum time, in half beats (rounded up, with a little give so a 120 BPM song is unchanged).
  const gapBeats = Math.max(level <= 3 ? 1 : 0.5, Math.ceil((lerp(MIN_GAP_SECONDS_EASY, MIN_GAP_SECONDS_EXPERT, f) / period) * 2 - 0.2) / 2);
  return {
    p,
    f,
    bearingMax: lerp(22, 35, f),
    pitchMin: lerp(-5, -10, f),
    pitchMax: lerp(9, 15, f),
    minJump: 7,
    maxJump: lerp(24, 50, f),
    minSep: 6,
    minGap: gapBeats,
    turnGuard: lerp(2, 1, f),
    triangleArc: lerp(30, 90, f),
    burstOrbs: level <= 3 ? [3, 3] : level <= 7 ? [3, 4] : [4, 5],
    orbStep: lerp(3.5, 5, f),
    fillOrbs: Math.round(lerp(3, 5, f)),
    holdTravel: lerp(16, 30, f),
    wallBearing: lerp(16, 24, f),
    tapsWhileTracking: level > 3,
  };
}

// ---------------------------------------------------------------------------------------------
// Bars, phrases and motifs
// ---------------------------------------------------------------------------------------------

interface Slot {
  /** Grid position in beats. */
  pos: number;
  time: number;
  /** Eighths from the Bar's downbeat (confident grid); -1 otherwise. */
  offset: number;
  /** Onset strength at the slot, 0..1. */
  strength: number;
}

interface Bar {
  index: number;
  kind: SectionKind;
  row: PresetRow;
  inSection: number;
  sectionBars: number;
  inPhrase: number;
  phraseBars: number;
  slots: Slot[];
  quiet: boolean;
  /** Grid position of its downbeat (confident grid; NaN otherwise). */
  downbeat: number;
  /** Grid position where the next Bar starts (confident grid; NaN otherwise). */
  next: number;
}

interface Phrase {
  bars: Bar[];
  kind: SectionKind;
}

const FAMILIES = ['sweep', 'zigzag', 'arc', 'ring', 'cross', 'stairs'] as const;
type Family = (typeof FAMILIES)[number];
const HOLD_SHAPES = ['glide', 'arc', 'wave', 'orbit'] as const;
type HoldShape = (typeof HOLD_SHAPES)[number];

interface Motif {
  /** Pattern of the phrase, and of its last Bar (the variation). */
  a: Family;
  b: Family;
  dir: 1 | -1;
  twist: number;
  /** Call and response (the next Bar mirrors) or a sequence (the next Bar moves along). */
  mirror: boolean;
  /** Pattern centre (degrees) and size (0..1 of the view). */
  cb: number;
  cp: number;
  scale: number;
  depth: number;
  /** Slot offsets in order of preference, for the phrase and for its last Bar. */
  priority: number[];
  priorityB: number[];
  /** Onset strength from which a slot is an accent. */
  accent: number;
  /** Phase of the count rounding, so counts spread evenly. */
  draw: number;
}

/** Point j of n in a movement pattern, in [-1, 1]² (u right, v up). */
function patternPoint(family: Family, j: number, n: number, dir: 1 | -1, twist: number): [number, number] {
  const t = n > 1 ? j / (n - 1) : 0.5;
  switch (family) {
    case 'sweep':
      return [dir * (-0.85 + 1.7 * t), twist * (-0.4 + 0.8 * t)];
    case 'zigzag':
      return [dir * (j % 2 === 0 ? -0.7 : 0.7), (twist >= 0 ? 1 : -1) * (-0.45 + 0.9 * t)];
    case 'arc': {
      const a = Math.PI * (1 - t);
      return [dir * 0.85 * Math.cos(a), -0.35 + 0.95 * Math.sin(a) * (twist >= 0 ? 1 : 0.6)];
    }
    case 'ring': {
      const a = twist * Math.PI + (dir * 2 * Math.PI * j) / Math.max(n, 4);
      return [0.75 * Math.cos(a), 0.75 * Math.sin(a)];
    }
    case 'cross': {
      const points: [number, number][] = [[0, 0.75], [0.75, 0], [0, -0.75], [-0.75, 0]];
      const [u, v] = points[(j + (twist >= 0 ? 0 : 2)) % 4];
      return [dir * u, v];
    }
    case 'stairs':
      return [dir * (-0.65 + 1.3 * t), (twist >= 0 ? 1 : -1) * (-0.7 + 1.4 * t)];
  }
}

/** Metric weight of a slot offset (eighths from the downbeat): downbeat, beat 3, beats 2 and 4, off-beats. */
function metric(offset: number, kind: SectionKind): number {
  if (offset % 2 === 1) return kind === 'peak' && offset % 4 === 3 ? 0.55 : 0.4;
  if (offset % 8 === 0) return 1;
  if (offset % 8 === 4) return 0.85;
  return 0.75;
}

const isTurnaround = (bar: Bar): boolean => bar.phraseBars >= 3 && bar.inPhrase === bar.phraseBars - 1;

// ---------------------------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------------------------

class Composer {
  private readonly level: number;
  private readonly feel: Feel;
  private readonly random: () => number;
  private readonly duration: number;
  /** No trusted beat grid: slots are onset peaks (R2). */
  private readonly onsets: boolean;
  private readonly grid: Grid;
  /** Seconds per beat on the uniform grid (onset mode). */
  private readonly period: number;
  private readonly peaks: number[] = [];
  private readonly board = new Board();
  private readonly kinds = new Quota<TargetKind>();
  private readonly shapes = new Quota<FlickShape>();
  private readonly walls: Wall[] = [];
  private readonly wallOf = new Map<number, number>();
  private readonly peekSide = new Map<number, -1 | 1>();
  private triangleSide: -1 | 1 = 1;
  /** The phrase's decoys, moved next to their real targets once the phrase is placed. */
  private decoys: { item: Item; slot: Slot; row: PresetRow }[] = [];

  constructor(
    private readonly analysis: Analysis,
    private readonly structure: Structure,
    private readonly preset: Preset,
    level: number,
    private readonly songId: string,
  ) {
    this.level = clamp(Math.trunc(Number.isFinite(level) ? level : 1), 1, 10);
    const bpmForFeel = Number.isFinite(analysis.bpm) && analysis.bpm >= 30 && analysis.bpm <= 300 ? analysis.bpm : 120;
    this.feel = feelFor(levelParams(this.level, preset), this.level, 60 / bpmForFeel);
    this.random = mulberry32(chartSeed(songId, preset.id, this.level));
    this.duration = Number.isFinite(analysis.duration) && analysis.duration > 0 ? analysis.duration : 0;
    const bpm = Number.isFinite(analysis.bpm) && analysis.bpm >= 30 && analysis.bpm <= 300 ? analysis.bpm : 120;
    this.period = 60 / bpm;
    const beats = Array.isArray(analysis.beats) ? analysis.beats : [];
    this.onsets = !(analysis.confidence >= MIN_GRID_CONFIDENCE && structure.downbeats.length > 0 && beats.length >= 4);
    this.grid = this.onsets ? Grid.uniform(this.period, this.duration) : Grid.fromBeats(beats);
    if (this.onsets) this.peaks = this.onsetPeaks();
  }

  run(): Composition {
    if (this.duration > 0) {
      const sections = this.buildBars();
      if (!this.onsets) this.moments(sections);
      this.patterns(sections);
    }
    return this.finish();
  }

  // -- Bars ------------------------------------------------------------------------------------

  /** Bars grouped by Section, each with its slots, phrase place and quietness. */
  private buildBars(): Bar[][] {
    const starts = this.structure.bars.filter((t) => Number.isFinite(t));
    const count = starts.length;
    const given = this.structure.sections.filter((s) => s.endBar > s.startBar && s.startBar < count);
    const sections = given.length > 0 ? given : count > 0 ? [{ startBar: 0, endBar: count, kind: 'calm' as SectionKind }] : [];
    let lastReal = -1;
    for (let k = 0; k < this.grid.length; k++) if (this.grid.real[k]) lastReal = k;
    const out: Bar[][] = [];
    for (const section of sections) {
      const from = Math.max(0, section.startBar);
      const to = Math.min(count, section.endBar);
      const length = to - from;
      if (length <= 0) continue;
      const row = this.preset.rows[section.kind];
      const phrases = Math.max(1, Math.floor(length / PHRASE_BARS));
      const bars: Bar[] = [];
      for (let b = from; b < to; b++) {
        const i = b - from;
        const phrase = Math.min(phrases - 1, Math.floor(i / PHRASE_BARS));
        const bar: Bar = {
          index: b, kind: section.kind, row, inSection: i, sectionBars: length,
          inPhrase: i - phrase * PHRASE_BARS,
          phraseBars: phrase === phrases - 1 ? length - phrase * PHRASE_BARS : PHRASE_BARS,
          slots: [], quiet: false, downbeat: NaN, next: NaN,
        };
        if (this.onsets) {
          const end = b + 1 < count ? starts[b + 1] : Math.min(this.duration, starts[b] + 4 * this.period);
          bar.slots = this.peaksIn(starts[b], end);
        } else {
          const start = Math.round(this.grid.pos(starts[b]));
          const next = b + 1 < count ? Math.round(this.grid.pos(starts[b + 1])) : lastReal + 1;
          bar.downbeat = start;
          bar.next = next;
          for (let k = Math.max(0, start); k < Math.min(next, this.grid.length); k++) {
            if (this.grid.real[k]) bar.slots.push(this.slotAt(k, (k - start) * 2));
            if (row.slotGrid === 0.5 && this.grid.audible(k + 0.5)) bar.slots.push(this.slotAt(k + 0.5, (k - start) * 2 + 1));
          }
        }
        bars.push(bar);
      }
      if (section.kind === 'intro' || section.kind === 'calm' || section.kind === 'outro') {
        const levels = bars.map((bar) => this.loudness(bar, starts));
        const usable = levels.filter((v) => Number.isFinite(v));
        const middle = median(usable);
        bars.forEach((bar, i) => { bar.quiet = Number.isFinite(levels[i]) && levels[i] < middle - QUIET_DB; });
      }
      out.push(bars);
    }
    return out;
  }

  private slotAt(pos: number, offset: number): Slot {
    const time = this.grid.at(pos);
    return { pos, time, offset, strength: this.strengthAt(time) };
  }

  /** Onset strength near a time: the strongest frame within ±STRENGTH_RADIUS. */
  private strengthAt(time: number): number {
    const { onsetEnv: env, onsetHop: hop } = this.analysis;
    if (!(hop > 0) || !env || env.length === 0) return 0;
    const f = Math.round(time / hop);
    let best = 0;
    for (let i = Math.max(0, f - STRENGTH_RADIUS); i <= Math.min(env.length - 1, f + STRENGTH_RADIUS); i++) best = Math.max(best, env[i]);
    return best;
  }

  /** A Bar's level in dB: its Beats' energy (confident grid) or its onset energy. */
  private loudness(bar: Bar, starts: number[]): number {
    let power = 0;
    let n = 0;
    if (this.onsets) {
      const { onsetEnv: env, onsetHop: hop } = this.analysis;
      if (!(hop > 0) || !env) return NaN;
      const from = Math.round(starts[bar.index] / hop);
      const to = Math.round((bar.index + 1 < starts.length ? starts[bar.index + 1] : starts[bar.index] + 4 * this.period) / hop);
      for (let f = Math.max(0, from); f < Math.min(env.length, to); f++, n++) power += env[f] * env[f];
    } else {
      for (let k = Math.max(0, bar.downbeat); k < Math.min(bar.next, this.grid.length); k++) {
        const i = this.grid.source[k];
        const e = i >= 0 ? this.analysis.beatEnergy[i] : undefined;
        if (e === undefined || !Number.isFinite(e)) continue;
        power += e * e;
        n++;
      }
    }
    return n > 0 ? 10 * Math.log10(Math.max(1e-12, power / n)) : NaN;
  }

  /** Onset peaks (R2): local maxima of the onset envelope that stand out, at their frame times. */
  private onsetPeaks(): number[] {
    const { onsetEnv: env, onsetHop: hop } = this.analysis;
    if (!(hop > 0) || !env || env.length === 0) return [];
    const nonzero: number[] = [];
    for (let i = 0; i < env.length; i++) if (env[i] > 0) nonzero.push(env[i]);
    const floor = Math.max(PEAK_FLOOR, PEAK_OVER_MEDIAN * median(nonzero));
    const out: number[] = [];
    for (let f = 0; f < env.length; f++) {
      const v = env[f];
      if (!(v >= floor)) continue;
      let peak = true;
      for (let g = Math.max(0, f - PEAK_RADIUS); g <= Math.min(env.length - 1, f + PEAK_RADIUS) && peak; g++) {
        if (g < f ? env[g] >= v : env[g] > v) peak = false;
      }
      if (peak) out.push(f * hop);
    }
    return out;
  }

  private peaksIn(from: number, to: number): Slot[] {
    const out: Slot[] = [];
    for (const time of this.peaks) {
      if (time < from) continue;
      if (time >= to) break;
      out.push({ pos: this.grid.pos(time), time, offset: -1, strength: this.strengthAt(time) });
    }
    return out;
  }

  /** The first onset peak after `time`, within ORB_MIN_SECONDS..ORB_MAX_BEATS. */
  private nextPeak(time: number): number | undefined {
    const list = this.peaks;
    let a = 0;
    let b = list.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (list[mid] < time + ORB_MIN_SECONDS) a = mid + 1;
      else b = mid;
    }
    const t = list[a];
    return t !== undefined && t <= time + ORB_MAX_BEATS * this.period ? t : undefined;
  }

  // -- Random helpers --------------------------------------------------------------------------

  private range(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  private int(a: number, b: number): number {
    return a + Math.floor(this.random() * (b - a + 1));
  }

  private sign(): 1 | -1 {
    return this.random() < 0.5 ? -1 : 1;
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)];
  }

  // -- Space -----------------------------------------------------------------------------------

  /** The lowest pitch an orb at `distance` may have and stay above the floor. */
  private floorPitch(distance: number): number {
    return Math.atan2(ORB_FLOOR - EYE_HEIGHT, distance) / DEG;
  }

  private midPitch(): number {
    return (this.feel.pitchMin + this.feel.pitchMax) / 2;
  }

  /** Clamp an orb position into the readable view. */
  private inView(at: TargetPosition): TargetPosition {
    const { bearingMax, pitchMin, pitchMax } = this.feel;
    const distance = clamp(at.distance, NEAR, FAR);
    return {
      bearing: clamp(at.bearing, -bearingMax, bearingMax),
      pitch: clamp(at.pitch, Math.max(pitchMin, this.floorPitch(distance)), pitchMax),
      distance,
    };
  }

  /** Clamp a figure's ground point into the view, leaving `lane` metres either side. */
  private onGround(at: TargetPosition, lane = 0, near = NEAR): TargetPosition {
    const distance = clamp(at.distance, near, FAR);
    const room = Math.max(0, this.feel.bearingMax - Math.atan2(lane + FIGURE_HALF_WIDTH, distance) / DEG);
    return { bearing: clamp(at.bearing, -room, room), pitch: 0, distance };
  }

  private orbPrint(at: TargetPosition): Print {
    const r = this.feel.minSep / 2;
    return { b0: at.bearing - r, b1: at.bearing + r, p0: at.pitch - r, p1: at.pitch + r };
  }

  private figurePrint(at: TargetPosition, lane = 0): Print {
    const half = Math.atan2(FIGURE_HALF_WIDTH + lane, at.distance) / DEG + 1;
    return {
      b0: at.bearing - half,
      b1: at.bearing + half,
      p0: Math.atan2(-EYE_HEIGHT, at.distance) / DEG - 1,
      p1: Math.atan2(FIGURE_HEIGHT - EYE_HEIGHT, at.distance) / DEG + 1,
    };
  }

  /** Alternatives when a spot is taken: mirrored, then moved sideways and up or down. */
  private nudges(at: TargetPosition, figure: boolean): TargetPosition[] {
    const step = figure ? 8 : this.feel.minSep * 1.3;
    const fix = (p: TargetPosition): TargetPosition => (figure ? this.onGround(p) : this.inView(p));
    return [
      { ...at, bearing: -at.bearing },
      { ...at, bearing: at.bearing + step },
      { ...at, bearing: at.bearing - step },
      { ...at, pitch: at.pitch + step },
      { ...at, pitch: at.pitch - step },
      { ...at, bearing: at.bearing + 2 * step },
      { ...at, bearing: at.bearing - 2 * step },
      { ...at, bearing: -at.bearing + step, pitch: at.pitch + step },
    ].map(fix);
  }

  /** Keep a flick a real flick from the previous tap, but no further than the level allows. */
  private jump(at: TargetPosition, slot: Slot): TargetPosition {
    const prev = this.board.previousTap(slot.time);
    const marks = prev?.marks;
    if (!prev || !prev.last || prev.triangle || !marks) return at;
    const beats = slot.pos - this.grid.pos(marks[marks.length - 1]);
    const allowed = this.feel.maxJump * clamp(beats, 1, 2);
    const from = prev.last;
    const db = at.bearing - from.bearing;
    const dp = at.pitch - from.pitch;
    const dist = Math.hypot(db, dp);
    if (dist > allowed) {
      const k = allowed / dist;
      return this.inView({ ...at, bearing: from.bearing + db * k, pitch: from.pitch + dp * k });
    }
    if (dist < this.feel.minJump) {
      const a = dist > EPS ? Math.atan2(dp, db) : from.bearing > 0 ? Math.PI : 0;
      return this.inView({ ...at, bearing: from.bearing + Math.cos(a) * this.feel.minJump, pitch: from.pitch + Math.sin(a) * this.feel.minJump });
    }
    return at;
  }

  /**
   * Orbs in a line from `start` at `angle` (radians, 0 = right, up positive), `orbStep` apart:
   * turned back if that keeps more of it in view, then slid inwards so every orb is in view and
   * none is squashed against an edge.
   */
  private line(start: TargetPosition, angle: number, count: number): TargetPosition[] {
    const { orbStep: step, bearingMax, pitchMax } = this.feel;
    const lowest = Math.max(this.feel.pitchMin, this.floorPitch(start.distance));
    const along = (a: number): TargetPosition[] => Array.from({ length: count }, (_, i) => ({
      bearing: start.bearing + Math.cos(a) * step * i,
      pitch: start.pitch + Math.sin(a) * step * i,
      distance: start.distance,
    }));
    const outside = (points: TargetPosition[]): number => points.reduce((sum, p) => sum
      + Math.max(0, Math.abs(p.bearing) - bearingMax) + Math.max(0, lowest - p.pitch) + Math.max(0, p.pitch - pitchMax), 0);
    const forward = along(angle);
    const back = along(angle + Math.PI);
    return this.slideIn(outside(back) < outside(forward) ? back : forward);
  }

  /** Move a group of orb positions (all at one distance) as one so that all of them are in view. */
  private slideIn(points: TargetPosition[]): TargetPosition[] {
    const { bearingMax, pitchMax } = this.feel;
    const lowest = Math.max(this.feel.pitchMin, this.floorPitch(points[0].distance));
    const bearings = points.map((p) => p.bearing);
    const pitches = points.map((p) => p.pitch);
    const slide = (lo: number, hi: number, min: number, max: number): number => (hi > max ? max - hi : lo < min ? min - lo : 0);
    const db = slide(Math.min(...bearings), Math.max(...bearings), -bearingMax, bearingMax);
    const dp = slide(Math.min(...pitches), Math.max(...pitches), lowest, pitchMax);
    return points.map((p) => this.inView({ ...p, bearing: p.bearing + db, pitch: p.pitch + dp }));
  }

  // -- Time ------------------------------------------------------------------------------------

  /** leadBeats rounded to the row's land grid (D18), never below 1 beat; unrounded without a grid. */
  private lead(row: PresetRow): number {
    const lead = Math.max(1, this.feel.p.leadBeats);
    if (this.onsets) return lead;
    return Math.max(1, Math.round(lead / row.landGrid) * row.landGrid);
  }

  /** launchTime and landTime for a target beat at `pos` with `lead` beats. */
  private arrive(pos: number, lead: number): { launch: number; land: number } {
    return { launch: this.grid.at(pos - lead - this.feel.p.flyInBeats), land: this.grid.at(pos - lead) };
  }

  /** In the song: launches after 0, lands after the grace, hits before the end. */
  private inSong(launch: number, land: number, target: number): boolean {
    return launch >= 0 && land >= START_GRACE && target < this.duration - 0.05;
  }

  /** The clear zone around hit moments from `first` to `last` (grid positions). */
  private zone(first: number, last: number, before: number, after: number): Span {
    return { from: this.grid.at(first - before), to: this.grid.at(last + after) };
  }

  // -- Target makers (null when the timing doesn't fit the song) ---------------------------------

  private flick(slot: Slot, row: PresetRow, at: TargetPosition, shape: FlickShape, role: TargetRole): Item | null {
    const triangle = shape === 'triangle';
    const { launch, land } = this.arrive(slot.pos, this.lead(row) + (triangle ? 1 : 0));
    if (!this.inSong(launch, land, slot.time)) return null;
    const end = Math.min(this.duration, this.grid.at(slot.pos + this.feel.p.afterBeats));
    const position = triangle ? at : this.inView(at);
    const target: FlickTarget = { kind: 'flick', shape, launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position };
    const guard = triangle ? this.feel.turnGuard : this.feel.minGap / 2;
    return bounded({
      target, role, launch, end,
      marks: [slot.time],
      zone: this.zone(slot.pos, slot.pos, guard, guard),
      turn: triangle ? this.zone(slot.pos, slot.pos, this.feel.turnGuard, this.feel.turnGuard) : undefined,
      first: position, last: position, triangle,
      prints: [this.orbPrint(position)],
    });
  }

  /** A burst with an orb on each of `points`, on consecutive eighths (or onset peaks) from the slot. */
  private burst(slot: Slot, row: PresetRow, points: TargetPosition[], role: TargetRole): Item | null {
    const times: number[] = [slot.time];
    const spots: number[] = [slot.pos];
    for (let i = 1; i < points.length; i++) {
      if (this.onsets) {
        const next = this.nextPeak(times[i - 1]);
        if (next === undefined) return null;
        times.push(next);
        spots.push(this.grid.pos(next));
      } else {
        const pos = slot.pos + 0.5 * i;
        if (!this.grid.audible(pos)) return null;
        times.push(this.grid.at(pos));
        spots.push(pos);
      }
    }
    const { launch, land } = this.arrive(slot.pos, this.lead(row));
    const last = spots[spots.length - 1];
    if (!this.inSong(launch, land, times[times.length - 1])) return null;
    const end = Math.min(this.duration, this.grid.at(last + this.feel.p.afterBeats));
    const orbs = points.map((p, i) => ({ time: times[i], position: this.inView(p) }));
    const centre = {
      bearing: orbs.reduce((s, o) => s + o.position.bearing, 0) / orbs.length,
      pitch: orbs.reduce((s, o) => s + o.position.pitch, 0) / orbs.length,
      distance: orbs[0].position.distance,
    };
    const target: BurstTarget = { kind: 'burst', launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position: centre, orbs };
    const gap = this.feel.minGap / 2;
    return bounded({
      target, role, launch, end,
      marks: times,
      zone: this.zone(slot.pos, last, gap, gap),
      first: orbs[0].position, last: orbs[orbs.length - 1].position,
      prints: orbs.map((o) => this.orbPrint(o.position)),
    });
  }

  /** A hold travels towards the middle of the view (`prefer` decides near the middle). */
  private hold(slot: Slot, at: TargetPosition, shape: HoldShape, prefer: 1 | -1, lift: 1 | -1, role: TargetRole): Item | null {
    // A hold lands one beat before it sets off at every level: there is nothing to click, and
    // the shorter wait leaves more room for tracking (one strafer or hold alive at a time).
    const { launch, land } = this.arrive(slot.pos, HOLD_LEAD);
    if (!this.inSong(launch, land, slot.time)) return null;
    const beats = this.feel.p.holdBeats;
    const full = this.grid.at(slot.pos + beats);
    const end = Math.min(this.duration, full);
    if (end - slot.time < 0.6 * (full - slot.time)) return null;
    const start = this.inView(at);
    const dir: 1 | -1 = start.bearing > 4 ? -1 : start.bearing < -4 ? 1 : prefer;
    const path = this.holdPath(start, shape, dir, lift, Math.max(2, Math.round(beats) + 1));
    const target: HoldTarget = { kind: 'hold', launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position: path[0], path };
    const prints: Print[] = [];
    path.forEach((p, i) => {
      prints.push(this.orbPrint(p));
      const q = path[i + 1];
      if (q) prints.push(this.orbPrint({ bearing: (p.bearing + q.bearing) / 2, pitch: (p.pitch + q.pitch) / 2, distance: p.distance }));
    });
    return bounded({ target, role, launch, end, alive: { from: land, to: end }, busy: { from: slot.time, to: end }, prints });
  }

  /**
   * A hold's path: one point per beat from its target beat, so its turns fall on the beats, slid
   * as a whole into the view.
   *  - glide: a straight run across, gently sloped.
   *  - arc: a rainbow over (or under) the straight line.
   *  - wave: up and down on every beat.
   *  - orbit: three quarters of a loop.
   */
  private holdPath(start: TargetPosition, shape: HoldShape, dir: 1 | -1, lift: 1 | -1, n: number): TargetPosition[] {
    const travel = this.feel.holdTravel;
    const out: TargetPosition[] = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      let b = start.bearing + dir * travel * s;
      let p = start.pitch;
      switch (shape) {
        case 'glide':
          p += lift * travel * 0.3 * s;
          break;
        case 'arc':
          p += lift * travel * 0.3 * Math.sin(Math.PI * s);
          break;
        case 'wave':
          if (i > 0 && i < n - 1) p += travel * 0.2 * (i % 2 === 1 ? lift : -lift);
          break;
        case 'orbit': {
          const r = travel * 0.32;
          const a = (dir > 0 ? Math.PI : 0) - dir * lift * 1.5 * Math.PI * s;
          b = start.bearing + dir * r + r * Math.cos(a);
          p = start.pitch + r * 0.9 * Math.sin(a);
          break;
        }
      }
      out.push({ bearing: b, pitch: p, distance: start.distance });
    }
    return this.slideIn(out);
  }

  private strafer(slot: Slot, bar: Bar, at: TargetPosition, life: number, role: TargetRole): Item | null {
    const lead = this.lead(bar.row);
    const { launch, land } = this.arrive(slot.pos, lead);
    if (!this.inSong(launch, land, slot.time)) return null;
    const p = this.feel.p;
    const full = this.grid.at(slot.pos - lead + life);
    const end = Math.min(this.duration, full);
    if (end - land < 0.6 * (full - land)) return null;
    const position = this.onGround({ ...at, distance: Math.max(12, at.distance) }, STRAFE_LANE, 12);
    const target: StraferTarget = {
      kind: 'strafer', launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position,
      speed: p.straferSpeed, health: Math.round(p.straferHealth * (life / p.straferLifeBeats)),
    };
    return bounded({ target, role, launch, end, alive: { from: land, to: end }, busy: { from: land, to: end }, prints: [this.figurePrint(position, STRAFE_LANE)] });
  }

  private peeker(slot: Slot, row: PresetRow, wallSide: -1 | 1, role: TargetRole): Item | null {
    const { launch, land } = this.arrive(slot.pos, this.lead(row));
    if (!this.inSong(launch, land, slot.time)) return null;
    const end = Math.min(this.duration, this.grid.at(slot.pos + this.feel.p.peekerBeats));
    const side = this.peekSide.get(wallSide) ?? (-wallSide as -1 | 1);
    const position = peekPosition(this.wallSpec(wallSide), side);
    const target: PeekerTarget = { kind: 'peeker', launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position, wall: -1, side };
    const gap = this.feel.minGap / 2;
    return bounded({
      target, role, launch, end,
      marks: [slot.time],
      zone: this.zone(slot.pos, slot.pos, gap, Math.max(gap, this.feel.p.peekerBeats - gap)),
      first: position, last: position,
      prints: [this.figurePrint(position)],
      wallSide,
    });
  }

  private decoy(slot: Slot, row: PresetRow, at: TargetPosition, role: TargetRole): Item | null {
    const { launch, land } = this.arrive(slot.pos, this.lead(row));
    if (!this.inSong(launch, land, slot.time)) return null;
    const end = Math.min(this.duration, this.grid.at(slot.pos + this.feel.p.afterBeats));
    const position = this.onGround(at);
    const target: DecoyTarget = { kind: 'decoy', launchTime: launch, landTime: land, targetTime: slot.time, windowEnd: end, position };
    return bounded({ target, role, launch, end, prints: [this.figurePrint(position)] });
  }

  /** The wall on one side of the view (made when its first peeker is placed). */
  private wallSpec(side: -1 | 1): Wall {
    return { bearing: side * this.feel.wallBearing, distance: WALL_DISTANCE, width: WALL_WIDTH, height: WALL_HEIGHT };
  }

  // -- Placing ---------------------------------------------------------------------------------

  /** Place the first of `make(at)` over `at` and its nudges (none for fixed spots) that keeps every rule. */
  private place(make: (at: TargetPosition) => Item | null, at: TargetPosition, nudge: 'orb' | 'figure' | 'fixed'): Item | undefined {
    const first = make(at);
    if (!first || !this.fits(first)) return undefined;
    if (this.board.clear(first)) return this.commit(first);
    if (nudge === 'fixed') return undefined;
    for (const spot of this.nudges(at, nudge === 'figure')) {
      const item = make(spot);
      if (item && this.board.clear(item) && this.fits(item)) return this.commit(item);
    }
    return undefined;
  }

  private fits(item: Item): boolean {
    return this.board.fits(item, this.feel.p.maxConcurrent, this.feel.tapsWhileTracking);
  }

  private commit(item: Item): Item {
    const target = item.target;
    if (target.kind === 'peeker' && item.wallSide !== undefined) {
      let index = this.wallOf.get(item.wallSide);
      if (index === undefined) {
        index = this.walls.length;
        this.walls.push(this.wallSpec(item.wallSide));
        this.wallOf.set(item.wallSide, index);
      }
      target.wall = index;
      this.peekSide.set(item.wallSide, (-target.side) as -1 | 1);
    }
    if (target.kind === 'flick' && target.shape === 'triangle') this.triangleSide = (-this.triangleSide) as -1 | 1;
    this.board.add(item);
    return item;
  }

  // -- Moments: fills, drops, pickups, the finale -----------------------------------------------

  private moments(sections: Bar[][]): void {
    const mid = this.midPitch();
    let peaks = 0;
    if (this.preset.fills) {
      for (let si = 1; si < sections.length; si++) {
        const bars = sections[si];
        const before = sections[si - 1][sections[si - 1].length - 1];
        if (bars[0].kind !== 'peak' || !before) continue;
        const down = bars[0].downbeat;
        if (!this.grid.audible(down)) continue;
        peaks++;
        const side: -1 | 1 = peaks % 2 === 1 ? -1 : 1;
        const drop = this.inView({ bearing: this.range(-4, 4), pitch: mid + 4, distance: 12.5 });
        // The fill: orbs rising from the side towards the drop, on the eighths before the downbeat.
        const runStart = this.inView({ bearing: side * this.feel.bearingMax * 0.6, pitch: mid - 3, distance: 13 });
        const runEnd = this.inView({ bearing: drop.bearing + side * 9, pitch: drop.pitch - 2, distance: 13 });
        // The run ends the level's gap before the downbeat: on the last eighth, or a beat early at levels 1-3.
        let filled = false;
        for (let n = this.feel.fillOrbs; n >= 3 && !filled; n--) {
          const first = down - this.feel.minGap - 0.5 * (n - 1);
          if (!this.grid.audible(first)) continue;
          const points = Array.from({ length: n }, (_, i) => {
            const s = i / (n - 1);
            return { bearing: lerp(runStart.bearing, runEnd.bearing, s), pitch: lerp(runStart.pitch, runEnd.pitch, s), distance: 13 };
          });
          filled = !!this.place(() => this.burst(this.slotAt(first, -1), before.row, points, 'fill'), runStart, 'fixed');
        }
        for (const pos of [down - this.feel.minGap, down - this.feel.minGap - 0.5]) {
          if (filled) break;
          if (this.grid.audible(pos)) filled = !!this.place((at) => this.flick(this.slotAt(pos, -1), before.row, at, 'circle', 'fill'), runEnd, 'orb');
        }
        // The drop, and on every second peak from level 4 its echo a beat later on the other side.
        this.place((at) => this.flick(this.slotAt(down, 0), bars[0].row, at, 'diamond', 'drop'), drop, 'orb');
        if (this.level >= 4 && peaks % 2 === 0 && this.grid.audible(down + 1)) {
          const echo = this.inView({ bearing: -Math.sign(drop.bearing || 1) * this.range(12, 18), pitch: drop.pitch - 1, distance: 12 });
          this.place((at) => this.flick(this.slotAt(down + 1, 2), bars[0].row, at, 'circle', 'drop'), echo, 'orb');
        }
      }
    }
    // Pickups: three orbs on the last eighths of each Build phrase that doesn't run into a peak.
    let pickups = 0;
    sections.forEach((bars, si) => {
      if (bars[0].kind !== 'build') return;
      for (const bar of bars) {
        if (bar.inPhrase !== bar.phraseBars - 1 || !Number.isFinite(bar.next)) continue;
        const last = bar === bars[bars.length - 1];
        if (last && (si + 1 >= sections.length || sections[si + 1][0].kind === 'peak')) continue;
        const first = bar.next - 1.5;
        if (first <= bar.downbeat || !this.grid.audible(first)) continue;
        const side: -1 | 1 = pickups++ % 2 === 0 ? 1 : -1;
        const start = this.inView({ bearing: side * this.range(10, 16), pitch: mid + 5, distance: 13 });
        this.place((at) => this.burst(this.slotAt(first, -1), bar.row, this.line(at, side > 0 ? Math.PI + 0.35 : -0.35, 3), 'flourish'), start, 'orb');
      }
    });
    // The finale: a diamond on the song's last downbeat.
    const lastBars = sections[sections.length - 1];
    const finale = lastBars?.[lastBars.length - 1];
    if (finale && this.grid.audible(finale.downbeat)) {
      this.place((at) => this.flick(this.slotAt(finale.downbeat, 0), finale.row, at, 'diamond', 'flourish'),
        this.inView({ bearing: this.range(-3, 3), pitch: mid + 3, distance: 13 }), 'orb');
    }
  }

  // -- Patterns --------------------------------------------------------------------------------

  private patterns(sections: Bar[][]): void {
    let previous: Family | undefined;
    for (const bars of sections) {
      for (let i = 0; i < bars.length;) {
        const phrase: Phrase = { bars: [], kind: bars[i].kind };
        do phrase.bars.push(bars[i++]);
        while (i < bars.length && bars[i].inPhrase > 0);
        const motif = this.motif(phrase, previous);
        previous = motif.a;
        this.phrase(phrase, motif);
      }
    }
  }

  private motif(phrase: Phrase, previous?: Family): Motif {
    const a = this.pick(FAMILIES.filter((f) => f !== previous));
    const b = this.pick(FAMILIES.filter((f) => f !== a));
    const strengths = phrase.bars.flatMap((bar) => bar.slots.map((s) => s.strength));
    const mid = this.midPitch();
    return {
      a, b,
      dir: this.sign(),
      twist: this.range(-1, 1),
      mirror: this.random() < 0.5,
      cb: this.range(-6, 6),
      cp: mid + this.range(-1.5, 2),
      scale: this.range(0.75, 1),
      depth: this.range(0, 2 * Math.PI),
      priority: this.priority(phrase),
      priorityB: this.priority(phrase),
      accent: Math.max(0.25, quantile(strengths, 0.85)),
      draw: this.random(),
    };
  }

  /** Slot offsets of a phrase by preference: onset strength there across the phrase × metric weight × a little chance. */
  private priority(phrase: Phrase): number[] {
    const byOffset = new Map<number, number[]>();
    for (const bar of phrase.bars) {
      for (const s of bar.slots) {
        const list = byOffset.get(s.offset) ?? [];
        list.push(s.strength);
        byOffset.set(s.offset, list);
      }
    }
    const scored = [...byOffset].map(([offset, strengths]) => ({
      offset,
      score: (0.3 + strengths.reduce((x, y) => x + y, 0) / strengths.length) * metric(offset, phrase.kind) * (0.75 + 0.5 * this.random()),
    }));
    scored.sort((x, y) => y.score - x.score || x.offset - y.offset);
    return scored.map((s) => s.offset);
  }

  /** Targets per Bar before rounding: the row's count, ramped across the Section, × density. */
  private base(bar: Bar): number {
    const { from, to } = bar.row.perBar;
    const t = bar.sectionBars > 1 ? bar.inSection / (bar.sectionBars - 1) : 1;
    return Math.max(0, (from + (to - from) * t) * this.feel.p.density);
  }

  private phrase(phrase: Phrase, motif: Motif): void {
    let carry = motif.draw;
    const counts = phrase.bars.map((bar) => {
      const before = Math.floor(carry);
      carry += this.base(bar);
      return Math.floor(carry) - before;
    });
    const total = counts.reduce((x, y) => x + y, 0);
    const byBar = total / phrase.bars.length >= BAR_MOTIF_COUNT;
    let j = 0;
    const plan = phrase.bars.map((bar, i) => {
      const n = counts[i];
      if (n <= 0 || bar.quiet) {
        j += n;
        return { bar, slots: [] as Slot[], anchors: [] as TargetPosition[] };
      }
      const slots = this.chooseSlots(bar, motif, n);
      const anchors = slots.map((_, k) => (byBar ? this.anchor(motif, bar, k, slots.length, true) : this.anchor(motif, bar, j + k, total, false)));
      j += byBar ? 0 : n;
      return { bar, slots, anchors };
    });
    const planned = new Set<Slot>();
    // Whichever goes first gets the clearer runs, so the order alternates at random.
    if (this.random() < 0.5) {
      this.turns(plan, phrase.kind, motif, planned);
      this.tracking(plan, phrase.kind, planned);
    } else {
      this.tracking(plan, phrase.kind, planned);
      this.turns(plan, phrase.kind, motif, planned);
    }
    const gap = this.feel.minGap - EPS;
    for (const { bar, slots, anchors } of plan) {
      slots.forEach((slot, k) => {
        if (planned.has(slot)) return;
        // A tap whose slot an earlier burst or turn has taken moves to the best free slot left in
        // the Bar, so a burst counts as one target and the Bar keeps its count where it can.
        const spare = (): Slot | undefined => this.slotOrder(bar, motif, false).find((s) => !slots.includes(s)
          && slots.every((other, i) => i <= k || Math.abs(other.pos - s.pos) >= gap) && this.tapFree(s));
        this.note(bar, slot, spare, anchors, k, motif);
      });
    }
    this.settleDecoys();
  }

  /**
   * Decoys stand where a hurried flick stops: beside the real tap nearest after them (or just
   * before), on the side the player comes from, a step further away so they never block it.
   */
  private settleDecoys(): void {
    for (const { item, slot, row } of this.decoys) {
      const t = slot.time;
      const beat = this.grid.at(slot.pos + 1) - t;
      let real: Item | undefined;
      let best = Infinity;
      for (const o of this.board.near(t - 2 * beat, t + 3 * beat)) {
        const marks = o.marks;
        if (!marks || o.triangle || !o.first) continue;
        const d = marks[0] - t;
        const score = d >= 0 ? d : -2 * d;
        if (d >= -beat && d <= 2 * beat && score < best) {
          best = score;
          real = o;
        }
      }
      if (!real?.first || !real.marks) continue;
      const to = real.first;
      const from = this.board.previousTap(real.marks[0])?.last ?? { bearing: 0, pitch: 0, distance: 13 };
      const side = Math.sign(from.bearing - to.bearing) || (to.bearing > 0 ? -1 : 1);
      const moved = this.decoy(slot, row, { bearing: to.bearing + side * this.range(6.5, 10), pitch: 0, distance: to.distance + 1.5 }, 'pattern');
      this.board.remove(item);
      this.board.add(moved && this.board.clear(moved) ? moved : item);
    }
    this.decoys = [];
  }

  /**
   * Strafers and holds, planned before the phrase's other notes because they need the longest
   * clear runs (only one is ever alive at a time): as many as keep their shares, the one furthest
   * behind its share first, each on the strongest free beat (downbeats first) of its own Bar.
   */
  private tracking(plan: { bar: Bar; slots: Slot[]; anchors: TargetPosition[] }[], kind: SectionKind, used: Set<Slot>): void {
    const weights = this.preset.rows[kind].weights;
    const upcoming = plan.reduce((n, p) => n + p.slots.length, 0);
    const owed = { strafer: 0, hold: 0 };
    for (const t of ['strafer', 'hold'] as const) {
      if (weights[t] > 0) owed[t] = this.kinds.owed(kind, t, weights[t], upcoming) + this.random();
    }
    const candidates = plan.flatMap(({ bar, slots, anchors }, i) => slots.map((slot, k) => ({ bar, slot, at: anchors[k], i })))
      .map((c) => ({ ...c, score: c.slot.strength + (c.slot.offset === 0 ? 1 : c.slot.offset % 4 === 0 ? 0.6 : c.slot.offset % 2 === 0 ? 0.3 : 0) + 0.2 * this.random() }))
      .sort((x, y) => y.score - x.score || x.slot.time - y.slot.time);
    const bars = new Set<number>();
    for (;;) {
      const t = owed.strafer >= 1 && (owed.hold < 1 || owed.strafer / weights.strafer >= owed.hold / weights.hold) ? 'strafer'
        : owed.hold >= 1 ? 'hold' : undefined;
      if (!t) break;
      const found = candidates.find(({ bar, slot, at, i }) => !used.has(slot) && !bars.has(i) && this.tryKind(t, bar, slot, at, at, false));
      if (!found) {
        owed[t] = 0;
        continue;
      }
      this.kinds.add(kind, t);
      used.add(found.slot);
      bars.add(found.i);
      owed[t] -= 1;
    }
  }

  /**
   * Strafer lives (beats) to try in a Section kind. Builds and peaks: one Bar, flipping on the
   * beat. Steady Sections: two Bars (the level's strafer life), or one where the next tracking
   * target is near, when the kind has room for its tracking (LONG_STRAFE_DEMAND), else one Bar.
   */
  private straferLives(kind: SectionKind): number[] {
    const p = this.feel.p;
    const half = Math.max(2, p.straferLifeBeats / 2);
    if (kind === 'build' || kind === 'peak') return [half];
    const row = this.preset.rows[kind];
    const perBar = ((row.perBar.from + row.perBar.to) / 2) * p.density;
    const holdAlive = HOLD_LEAD + p.holdBeats;
    const demand = (perBar * (row.weights.strafer * p.straferLifeBeats + row.weights.hold * holdAlive)) / 4;
    return demand <= LONG_STRAFE_DEMAND ? [p.straferLifeBeats, half] : [half];
  }

  /**
   * Triangles (D14), planned before the phrase's other notes so each gets its turn: enough to
   * keep the triangle share of the Section kind's flicks, counting the flicks this phrase should
   * bring (and no more than the flicks the kind is owed), on its strongest slots (downbeats and
   * accents), at most one per Bar and not in neighbouring Bars, alternating left and right. Adds
   * the slots used.
   */
  private turns(plan: { bar: Bar; slots: Slot[] }[], kind: SectionKind, motif: Motif, used: Set<Slot>): void {
    const flick = this.preset.rows[kind].weights.flick;
    const upcoming = plan.reduce((n, p) => n + p.slots.length, 0);
    const chance = this.random();
    let owed = Math.min(
      Math.floor(this.shapes.owed(kind, 'triangle', this.preset.flickShapes.triangle, upcoming * flick) + chance),
      Math.floor(this.kinds.owed(kind, 'flick', flick, upcoming) + chance),
    );
    const candidates = plan.flatMap(({ bar, slots }, i) => slots.map((slot) => ({ bar, slot, i })))
      .map((c) => ({ ...c, score: c.slot.strength + (c.slot.offset === 0 ? 0.3 : 0) + (c.slot.strength >= motif.accent ? 0.3 : 0) + 0.1 * this.random() }))
      .sort((x, y) => y.score - x.score || x.slot.time - y.slot.time);
    const bars: number[] = [];
    for (const { bar, slot, i } of candidates) {
      if (owed < 1) break;
      if (used.has(slot) || bars.some((b) => Math.abs(b - i) < 2)) continue;
      const side = this.triangleSide;
      const spot = { bearing: side * (60 + this.range(0, this.feel.triangleArc)), pitch: this.range(0, 8), distance: this.range(11, 14) };
      if (this.place(() => this.flick(slot, bar.row, spot, 'triangle', 'pattern'), spot, 'fixed')) {
        this.kinds.add(bar.kind, 'flick');
        this.shapes.add(bar.kind, 'triangle');
        owed--;
        used.add(slot);
        bars.push(i);
      }
    }
  }

  /** Up to n slots for a Bar: the motif's rhythm, at least the level's gap apart. */
  private chooseSlots(bar: Bar, motif: Motif, n: number): Slot[] {
    const gap = this.feel.minGap - EPS;
    const fits = (s: Slot, chosen: Slot[]): boolean => chosen.every((c) => Math.abs(c.pos - s.pos) >= gap);
    const chosen: Slot[] = [];
    for (const s of this.slotOrder(bar, motif, true)) {
      if (chosen.length >= n) break;
      if (fits(s, chosen)) chosen.push(s);
    }
    // Syncopation: a peak phrase's last Bar pulls one beat forward onto the eighth before it.
    if (!this.onsets && isTurnaround(bar) && bar.kind === 'peak' && chosen.length >= 2 && chosen.every((s) => s.offset % 2 === 0)) {
      const sorted = chosen.slice().sort((x, y) => y.pos - x.pos);
      for (const s of sorted) {
        if (s.offset === 0) continue;
        const early = bar.slots.find((e) => e.offset === s.offset - 1);
        const rest = chosen.filter((c) => c !== s);
        if (early && fits(early, rest)) {
          chosen.splice(chosen.indexOf(s), 1, early);
          break;
        }
      }
    }
    return chosen.sort((x, y) => x.pos - y.pos);
  }

  /** A Bar's slots by preference: the motif's rhythm (confident grid) or onset strength, with a little chance if `jitter`. */
  private slotOrder(bar: Bar, motif: Motif, jitter: boolean): Slot[] {
    if (this.onsets) {
      return bar.slots.map((s) => ({ s, score: s.strength * (jitter ? 0.75 + 0.5 * this.random() : 1) }))
        .sort((x, y) => y.score - x.score || x.s.time - y.s.time).map((x) => x.s);
    }
    const order: Slot[] = [];
    for (const offset of isTurnaround(bar) ? motif.priorityB : motif.priority) {
      const slot = bar.slots.find((s) => s.offset === offset);
      if (slot) order.push(slot);
    }
    return order;
  }

  /** No hit moment near the slot yet: a tap could go there. */
  private tapFree(slot: Slot): boolean {
    const gap = this.feel.minGap / 2;
    const zone = this.zone(slot.pos, slot.pos, gap, gap);
    return this.board.near(zone.from, zone.to).every((o) => !o.zone || !overlaps(o.zone, zone));
  }

  /** Where note j of n goes in the phrase's movement pattern (bar motif or phrase-long pattern). */
  private anchor(motif: Motif, bar: Bar, j: number, n: number, byBar: boolean): TargetPosition {
    const turnaround = byBar && isTurnaround(bar);
    let [u, v] = patternPoint(turnaround ? motif.b : motif.a, j, n, motif.dir, motif.twist);
    if (byBar && !turnaround) {
      const k = bar.inPhrase;
      if (motif.mirror) {
        if (k % 2 === 1) u = -u;
      } else {
        u += 0.2 * k * motif.dir;
        v += k % 2 === 1 ? 0.12 : -0.06 * k;
      }
    } else if (!byBar && motif.mirror && bar.inPhrase >= bar.phraseBars / 2) {
      u = -u;
    }
    const half = (this.feel.pitchMax - this.feel.pitchMin) / 2;
    return this.inView({
      bearing: motif.cb + fold(u) * this.feel.bearingMax * motif.scale,
      pitch: motif.cp + fold(v) * half * motif.scale,
      distance: 13.25 + 1.9 * Math.sin(motif.depth + 1.7 * j),
    });
  }

  /** One pattern note: the most wanted type that fits, or a rest. */
  private note(bar: Bar, slot: Slot, spare: () => Slot | undefined, anchors: TargetPosition[], k: number, motif: Motif): void {
    const at = anchors[k];
    const toward = anchors[k + 1] ?? anchors[k - 1] ?? at;
    const free = this.tapFree(slot);
    let moved: Slot | undefined | null = null;
    for (const kind of this.kinds.order(bar.kind, bar.row.weights, TARGET_KINDS, this.random, false, 'decoy')) {
      let use: Slot | undefined = slot;
      if (!free && (kind === 'flick' || kind === 'burst' || kind === 'peeker')) {
        if (moved === null) moved = spare();
        use = moved;
      }
      if (use && this.tryKind(kind, bar, use, at, toward, use.strength >= motif.accent)) {
        this.kinds.add(bar.kind, kind);
        return;
      }
    }
  }

  private tryKind(kind: TargetKind, bar: Bar, slot: Slot, at: TargetPosition, toward: TargetPosition, accent: boolean): boolean {
    const row = bar.row;
    switch (kind) {
      case 'flick': {
        // Triangles are planned per phrase (see turns); here a circle, or a diamond on an accent.
        const weights = { ...this.preset.flickShapes, triangle: 0 };
        let shapes = this.shapes.order(bar.kind, weights, FLICK_SHAPES, this.random, true);
        if (accent && shapes.includes('diamond')) shapes = ['diamond', ...shapes.filter((s) => s !== 'diamond')];
        for (const shape of shapes) {
          if (this.place((p) => this.flick(slot, row, p, shape, 'pattern'), this.jump(at, slot), 'orb')) {
            this.shapes.add(bar.kind, shape);
            return true;
          }
        }
        return false;
      }
      case 'burst': {
        const start = this.jump(at, slot);
        const angle = Math.atan2(toward.pitch - start.pitch, toward.bearing - start.bearing) + this.range(-0.5, 0.5);
        for (let n = this.int(this.feel.burstOrbs[0], this.feel.burstOrbs[1]); n >= 3; n--) {
          if (this.place((p) => this.burst(slot, row, this.line(p, angle, n), 'pattern'), start, 'orb')) return true;
        }
        return false;
      }
      case 'hold': {
        const shape = this.pick(HOLD_SHAPES);
        const prefer = this.sign();
        const lift = this.sign();
        return !!this.place((p) => this.hold(slot, p, shape, prefer, lift, 'pattern'), this.jump(at, slot), 'orb');
      }
      case 'strafer': {
        const spot = this.onGround(at, STRAFE_LANE, 12);
        return this.straferLives(bar.kind).some((life) => !!this.place((p) => this.strafer(slot, bar, p, life, 'pattern'), spot, 'figure'));
      }
      case 'peeker': {
        const wallSide: -1 | 1 = at.bearing >= 0 ? 1 : -1;
        return !!(this.place(() => this.peeker(slot, row, wallSide, 'pattern'), at, 'fixed')
          || this.place(() => this.peeker(slot, row, (-wallSide) as -1 | 1, 'pattern'), at, 'fixed'));
      }
      case 'decoy': {
        // Placed near the pattern's next spot for now; settleDecoys moves it next to the real target.
        const side = Math.sign(at.bearing - toward.bearing) || this.sign();
        const spot = this.onGround({ bearing: toward.bearing + side * this.range(6.5, 10), pitch: 0, distance: toward.distance + 1.5 });
        const item = this.place((p) => this.decoy(slot, row, p, 'pattern'), spot, 'figure');
        if (item) this.decoys.push({ item, slot, row });
        return !!item;
      }
    }
  }

  // -- Output ----------------------------------------------------------------------------------

  private finish(): Composition {
    const items = this.board.items.slice().sort((a, b) => a.target.targetTime - b.target.targetTime || a.launch - b.launch);
    const pos = (p: TargetPosition): TargetPosition => ({ bearing: round2(p.bearing), pitch: round2(p.pitch), distance: round2(p.distance) });
    const targets = items.map((item): ChartTarget => {
      const t = item.target;
      switch (t.kind) {
        case 'burst':
          return { ...t, position: pos(t.position), orbs: t.orbs.map((o) => ({ time: o.time, position: pos(o.position) })) };
        case 'hold':
          return { ...t, position: pos(t.position), path: t.path.map(pos) };
        default:
          return { ...t, position: pos(t.position) };
      }
    });
    const chart: Chart = {
      songId: this.songId,
      preset: this.preset.id,
      difficulty: difficultyOf(this.level),
      level: this.level,
      duration: this.duration,
      targets,
      walls: this.walls.map((w) => ({ ...w, bearing: round2(w.bearing) })),
    };
    return { chart, roles: items.map((item) => item.role) };
  }
}
