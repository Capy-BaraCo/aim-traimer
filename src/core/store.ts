import type { WeaponId } from './weapons';
import type { FlickRecord } from './analytics';
import type { Focus } from './metrics';
import {
  applyRun,
  dayKey,
  rankFor,
  totalStars,
  type DrillProgress,
  type RunOutcome,
  type SessionRecord,
  type Thresholds,
} from './progress';

export type CrosshairStyle = 'cross' | 'dot' | 'circle' | 'crossdot';
export type FxLevel = 'off' | 'lite' | 'full';

export interface CrosshairSettings {
  style: CrosshairStyle;
  color: string;
  length: number;
  thickness: number;
  gap: number;
  outline: boolean;
}

export interface Settings {
  dpi: number;
  sens: number;
  /** Overwatch-style horizontal FOV at 16:9, 80–103. */
  fov: number;
  rawInput: boolean;
  invertY: boolean;
  /** Fudge factor for browsers that report scaled mouse deltas. 1 = trust the browser. */
  inputScale: number;
  crosshair: CrosshairSettings;
  volume: number;
  fx: FxLevel;
  renderScale: number;
  showFps: boolean;
  showScope: boolean;
  focus: Focus;
  rounds: number;
  blind: boolean;
  viewmodel: boolean;
  /** Real-time coaching cues during drills. */
  coachCues: boolean;
  /** Colour of every target (orbs and enemies), as #rrggbb. */
  targetColor: string;
  /** Sensitivity while scoped, % of hip-fire sensitivity. */
  scopedSens: number;
  /** Weapon picked for each drill (drill id → weapon id). */
  loadout: Record<string, WeaponId>;
  /** Arena lighting. */
  theme: Theme;
  /** HRTF 3D audio for headphones; off = plain stereo panning for speakers. */
  spatialAudio: boolean;
  /** Positional sounds when targets appear (Snap, Echo, calibration wide flicks). */
  targetSounds: boolean;
  /** Which sections a PSA sample contains. */
  calSections: { track: boolean; short: boolean; wide: boolean };
}

export interface CalibrationRecord {
  at: string;
  base: number;
  result: number;
  dpi: number;
  focus: Focus;
  rounds: number;
  agreement: number;
}

export interface TrackSnapshot {
  at: string;
  drill: string;
  acc: number;
  delayMs: number | null;
  trail: number;
  vertical: number;
  jitter: number;
}

/** One Echo run, boiled down. Rates are 0..1 (NaN when there was nothing to judge). */
export interface HearingSnapshot {
  at: string;
  rate: number;
  front: number;
  behind: number;
  turnMs: number;
}

export interface PlacementSnapshot {
  at: string;
  error: number;
  vertical: number;
}

export interface Profile {
  settings: Settings;
  history: CalibrationRecord[];
  bests: Record<string, number>;
  seenIntro: boolean;
  progress: Record<string, DrillProgress>;
  sessions: SessionRecord[];
  /** Rolling log of recent flicks from drills (heavy fields stripped). */
  flickLog: FlickRecord[];
  trackLog: TrackSnapshot[];
  placementLog: PlacementSnapshot[];
  hearLog: HearingSnapshot[];
  /** Days (YYYY-MM-DD) with at least one completed drill. */
  days: string[];
}

export interface CommitResult extends RunOutcome {
  rankBefore: string;
  rankAfter: string;
  totalStars: number;
}

export type Theme = 'day' | 'night';

export const DEFAULT_TARGET_COLOR = '#ff3d12';

/** A #rrggbb colour (what the colour picker and swatches produce). */
export const isHex = (x: unknown): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);

export const DEFAULT_SETTINGS: Settings = {
  dpi: 800,
  sens: 5,
  fov: 103,
  rawInput: true,
  invertY: false,
  inputScale: 1,
  crosshair: { style: 'cross', color: '#3dffc8', length: 7, thickness: 2, gap: 4, outline: true },
  targetColor: DEFAULT_TARGET_COLOR,
  scopedSens: 67,
  loadout: {},
  theme: 'day',
  volume: 0.6,
  fx: 'full',
  renderScale: 1,
  showFps: true,
  showScope: true,
  focus: 'balanced',
  rounds: 7,
  blind: true,
  viewmodel: true,
  coachCues: true,
  spatialAudio: true,
  targetSounds: true,
  calSections: { track: true, short: true, wide: true },
};

const KEY = 'azimuth.profile.v1';

const freshProfile = (): Profile => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  history: [],
  bests: {},
  seenIntro: false,
  progress: {},
  sessions: [],
  flickLog: [],
  trackLog: [],
  placementLog: [],
  hearLog: [],
  days: [],
});

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Fill in anything missing from a saved (possibly older or hand-edited) profile. */
function normalise(parsed: Partial<Profile>): Profile {
  const fresh = freshProfile();
  return {
    settings: {
      ...fresh.settings,
      ...parsed.settings,
      crosshair: { ...fresh.settings.crosshair, ...parsed.settings?.crosshair },
      loadout: { ...parsed.settings?.loadout },
      theme: parsed.settings?.theme === 'night' ? 'night' : 'day',
      targetColor: isHex(parsed.settings?.targetColor) ? parsed.settings!.targetColor : fresh.settings.targetColor,
      calSections: { ...fresh.settings.calSections, ...parsed.settings?.calSections },
    },
    history: arr(parsed.history),
    bests: parsed.bests ?? {},
    seenIntro: !!parsed.seenIntro,
    progress: parsed.progress ?? {},
    sessions: arr(parsed.sessions),
    flickLog: arr(parsed.flickLog),
    trackLog: arr(parsed.trackLog),
    placementLog: arr(parsed.placementLog),
    hearLog: arr(parsed.hearLog),
    days: arr(parsed.days),
  };
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalise(JSON.parse(raw) as Partial<Profile>) : freshProfile();
  } catch {
    return freshProfile();
  }
}

type Listener = (p: Profile) => void;

class Store {
  private profile = load();
  private listeners = new Set<Listener>();

  get(): Profile {
    return this.profile;
  }

  get settings(): Settings {
    return this.profile.settings;
  }

  update(fn: (p: Profile) => void): void {
    fn(this.profile);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.profile));
    } catch {
      // Private mode / blocked storage: keep working in memory.
    }
    for (const l of this.listeners) l(this.profile);
  }

  /** Everything this browser knows about you, as a backup file's contents. */
  exportJson(): string {
    return JSON.stringify({ app: 'azimuth', version: 2, exportedAt: new Date().toISOString(), profile: this.profile }, null, 2);
  }

  /** Replace the profile with a backup made by exportJson (or a bare profile object). */
  importJson(text: string): { ok: true } | { ok: false; reason: string } {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: "That file isn't valid JSON." };
    }
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const prof = (obj && 'profile' in obj ? obj.profile : obj) as Partial<Profile> | null;
    if (!prof || typeof prof !== 'object' || !('settings' in prof || 'progress' in prof)) {
      return { ok: false, reason: "That file doesn't look like an Azimuth backup." };
    }
    const next = normalise(prof);
    this.update((p) => Object.assign(p, next));
    return { ok: true };
  }

  setSettings(patch: Partial<Settings>): void {
    this.update((p) => Object.assign(p.settings, patch));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recordBest(id: string, score: number): boolean {
    const prev = this.profile.bests[id] ?? -Infinity;
    if (score <= prev) return false;
    this.update((p) => (p.bests[id] = score));
    return true;
  }

  /** Save a finished drill run: level progress, stars, rank, streak and analytics logs. */
  commitRun(
    drill: string,
    level: number,
    score: number,
    thresholds: Thresholds,
    maxLevel: number,
    extras: {
      flicks?: FlickRecord[];
      track?: Omit<TrackSnapshot, 'at' | 'drill'>;
      placement?: Omit<PlacementSnapshot, 'at'>;
      hearing?: Omit<HearingSnapshot, 'at'>;
    } = {},
  ): CommitResult {
    let result!: CommitResult;
    this.update((p) => {
      const before = totalStars(p.progress);
      const prog = (p.progress[drill] ??= { levels: {}, runs: 0, lastLevel: level });
      const outcome = applyRun(prog, level, score, thresholds, maxLevel);
      const after = totalStars(p.progress);
      const at = new Date().toISOString();
      p.sessions.push({ at, drill, level, score, stars: outcome.stars });
      if (p.sessions.length > 400) p.sessions.splice(0, p.sessions.length - 400);
      const today = dayKey();
      if (!p.days.includes(today)) p.days.push(today);
      if (p.days.length > 400) p.days.splice(0, p.days.length - 400);
      if (extras.flicks?.length) {
        p.flickLog.push(...extras.flicks.map(slimFlick));
        if (p.flickLog.length > 300) p.flickLog.splice(0, p.flickLog.length - 300);
        // Replays only need recent flicks; older ones keep their numbers but drop the timed path.
        for (let i = 0; i < p.flickLog.length - 80; i++) {
          p.flickLog[i].trace = undefined;
          p.flickLog[i].shots = undefined;
        }
      }
      if (extras.track) {
        p.trackLog.push({ at, drill, ...extras.track });
        if (p.trackLog.length > 120) p.trackLog.splice(0, p.trackLog.length - 120);
      }
      if (extras.placement) {
        p.placementLog.push({ at, ...extras.placement });
        if (p.placementLog.length > 120) p.placementLog.splice(0, p.placementLog.length - 120);
      }
      if (extras.hearing) {
        p.hearLog.push({ at, ...extras.hearing });
        if (p.hearLog.length > 120) p.hearLog.splice(0, p.hearLog.length - 120);
      }
      p.bests[drill] = Math.max(p.bests[drill] ?? 0, score);
      result = { ...outcome, rankBefore: rankFor(before).name, rankAfter: rankFor(after).name, totalStars: after };
    });
    return result;
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Keep what the Logbook needs; drop paths and profiles to stay small in localStorage. */
function slimFlick(f: FlickRecord): FlickRecord {
  return {
    ...f,
    distance: r3(f.distance),
    radius: r3(f.radius),
    dirDeg: Math.round(f.dirDeg),
    reactionMs: Math.round(f.reactionMs),
    ballisticMs: Math.round(f.ballisticMs),
    correctionMs: Math.round(f.correctionMs),
    totalMs: Math.round(f.totalMs),
    endAlong: r3(f.endAlong),
    endPerp: r3(f.endPerp),
    curve: r3(f.curve),
    peakSpeed: Math.round(f.peakSpeed),
    peakAt: r3(f.peakAt),
    clickSpeed: Math.round(f.clickSpeed),
    misses: f.misses.map((m) => ({ along: r3(m.along), perp: r3(m.perp) })),
    path: [],
    profile: f.profile.map(r3),
  };
}

export const store = new Store();
