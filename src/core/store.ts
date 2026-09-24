import type { Focus } from './metrics';

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

export interface Profile {
  settings: Settings;
  history: CalibrationRecord[];
  bests: Record<string, number>;
  seenIntro: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  dpi: 800,
  sens: 5,
  fov: 103,
  rawInput: true,
  invertY: false,
  inputScale: 1,
  crosshair: { style: 'cross', color: '#3dffc8', length: 7, thickness: 2, gap: 4, outline: true },
  volume: 0.6,
  fx: 'full',
  renderScale: 1,
  showFps: true,
  showScope: true,
  focus: 'balanced',
  rounds: 7,
  blind: true,
  viewmodel: true,
};

const KEY = 'azimuth.profile.v1';

function load(): Profile {
  const fresh: Profile = { settings: structuredClone(DEFAULT_SETTINGS), history: [], bests: {}, seenIntro: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      settings: {
        ...fresh.settings,
        ...parsed.settings,
        crosshair: { ...fresh.settings.crosshair, ...parsed.settings?.crosshair },
      },
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bests: parsed.bests ?? {},
      seenIntro: !!parsed.seenIntro,
    };
  } catch {
    return fresh;
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
}

export const store = new Store();
