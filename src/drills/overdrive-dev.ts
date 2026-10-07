/**
 * Dev builds only: play Overdrive from the browser console before the song screen exists (T17).
 * Game loads this module lazily inside `if (import.meta.env.DEV)`, so none of it (the click track
 * included, D11) ever reaches a production build.
 *
 *   await __overdrive(level = 5, url = '/Better%20by%20Moonlight.mp3')
 *       Fetch a song, put it through the real library path (add, then prepare: decode + analysis),
 *       generate its chart at `level` and play it. Your test song lives in the repo root and is
 *       git-excluded; never commit it.
 *   await __overdrive.test(level = 5)
 *       A hand-written chart with one target of each kind (and every flick shape) over a click track
 *       generated in code at 120 BPM.
 *   __overdrive.off()           quit back to the menu
 *   __overdrive.drill()         the running OverdriveDrill (its `trace` lists what happened when)
 *   __overdrive.report()        the last run's report
 * Aim and fire without the mouse (headless checks, or without pointer lock):
 *   __overdrive.aim(bearing, pitch) · .aimAt(index, part = 0) · .click() · .hold() · .release()
 *
 * Starting play needs a click (pointer lock and audio both need one), so if the call didn't come
 * from one it waits for your next click anywhere on the page.
 */
import { add as addSong, prepare } from '../core/songs';
import { store } from '../core/store';
import type { Game } from '../core/game';
import { generate, peekPosition } from '../rhythm/generator';
import { presetById } from '../rhythm/presets';
import type { Chart, ChartTarget, TargetKind, Wall } from '../rhythm/types';
import type { App } from '../ui/app';
import type { DrillReport } from './drill';
import { makeOverdrive, OverdriveDrill, type OverdriveContext } from './overdrive';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------ test chart (pure)

/** Tempo of the test chart and its click track. */
export const TEST_BPM = 120;
const BEAT = 60 / TEST_BPM;
/** Beats in the click track (the chart ends a little before). */
const TEST_BEATS = 54;

/** Beat times of the test song: beat k at k × 0.5 s. */
export function testBeats(): number[] {
  return Array.from({ length: TEST_BEATS }, (_, k) => k * BEAT);
}

/**
 * A hand-written Chart: one target of each kind, plus every flick shape, at level 5 and 120 BPM.
 * Times are given in beats: [launch, land, target, end]. Each target has the stage to itself
 * (except the decoy, which stands beside the circle that follows it, as in a real chart).
 */
export function testChart(level = 5): Chart {
  const b = (beat: number) => beat * BEAT;
  const times = (launch: number, land: number, target: number, end: number) => ({
    launchTime: b(launch),
    landTime: b(land),
    targetTime: b(target),
    windowEnd: b(end),
  });
  const wall: Wall = { bearing: -20, distance: 17, width: 2.6, height: 2.4 };
  const holdPath = [
    { bearing: -14, pitch: 3, distance: 13 },
    { bearing: -5, pitch: 9, distance: 13 },
    { bearing: 4, pitch: 3, distance: 13 },
    { bearing: 13, pitch: 9, distance: 13 },
  ];
  const orbs = [0, 1, 2, 3].map((k) => ({ time: b(20 + k / 2), position: { bearing: -14 + k * 4.5, pitch: 3.5 + k * 1.5, distance: 12 } }));
  const targets: ChartTarget[] = [
    { kind: 'flick', shape: 'circle', ...times(5, 6, 8, 9), position: { bearing: -10, pitch: 3, distance: 13 } },
    { kind: 'flick', shape: 'diamond', ...times(9, 10, 12, 13), position: { bearing: 12, pitch: 6, distance: 12 } },
    // Wide flick: well off screen to the right, with an extra beat to turn (T6).
    { kind: 'flick', shape: 'triangle', ...times(12, 13, 16, 17), position: { bearing: 105, pitch: 2, distance: 13 } },
    { kind: 'burst', ...times(17, 18, 20, 22.5), position: { bearing: -7.25, pitch: 5.75, distance: 12 }, orbs },
    // Strafer: lives 8 beats from landing.
    { kind: 'strafer', ...times(22, 23, 24, 31), position: { bearing: 8, pitch: 0, distance: 13 }, speed: 0.8, health: 110 },
    // Hold: lands 1 beat before it sets off (HOLD_LEAD), then reaches a path point on each beat.
    { kind: 'hold', ...times(31, 32, 33, 36), position: holdPath[0], path: holdPath },
    { kind: 'peeker', ...times(37, 38, 40, 41), position: peekPosition(wall, 1), wall: 0, side: 1 },
    { kind: 'decoy', ...times(41, 42, 44, 45), position: { bearing: 6, pitch: 0, distance: 12 } },
    { kind: 'flick', shape: 'circle', ...times(43, 44, 46, 47), position: { bearing: 13, pitch: 4, distance: 12 } },
    // A diamond on the last downbeat to finish, like the generator's flourish.
    { kind: 'flick', shape: 'diamond', ...times(45, 46, 48, 49), position: { bearing: 0, pitch: 5, distance: 13 } },
  ];
  return { songId: 'test-click-track', preset: 'mixed', difficulty: 'normal', level, duration: b(51), targets, walls: [wall] };
}

/**
 * A click track as mono PCM: a kick on every beat, a clap on beats 2 and 4, a hat on the off-beat
 * eighths and a high tick on each downbeat, so you can hear where the beat is. Deterministic.
 */
export function clickTrack(bpm = TEST_BPM, beats = TEST_BEATS, sampleRate = 44100): Float32Array<ArrayBuffer> {
  const beat = 60 / bpm;
  const pcm = new Float32Array(Math.ceil((beats * beat + 1) * sampleRate));
  let seed = 0x2f6b9a1;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const voice = (at: number, dur: number, f: (t: number) => number) => {
    const i0 = Math.round(at * sampleRate);
    const n = Math.round(dur * sampleRate);
    for (let i = 0; i < n && i0 + i < pcm.length; i++) pcm[i0 + i] += f(i / sampleRate);
  };
  for (let k = 0; k < beats; k++) {
    const at = k * beat;
    // Kick: a sine sweeping down from 150 to 45 Hz.
    voice(at, 0.25, (t) => 0.9 * Math.exp(-t / 0.07) * Math.sin(2 * Math.PI * (45 * t + (105 * 0.04) * (1 - Math.exp(-t / 0.04)))));
    if (k % 4 === 0) voice(at, 0.06, (t) => 0.25 * Math.exp(-t / 0.015) * Math.sin(2 * Math.PI * 1760 * t));
    if (k % 2 === 1) voice(at, 0.2, (t) => 0.35 * Math.exp(-t / 0.045) * noise());
    voice(at + beat / 2, 0.04, (t) => 0.12 * Math.exp(-t / 0.01) * noise());
  }
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.9 / peak;
  return pcm;
}

// ------------------------------------------------------------------------------------------ console hook

interface Hook {
  (level?: number, url?: string): Promise<void>;
  test(level?: number): Promise<void>;
  off(): void;
  drill(): OverdriveDrill | null;
  report(): DrillReport | null;
  aim(bearing: number, pitch: number): void;
  aimAt(index: number, part?: number): boolean;
  click(): void;
  hold(): void;
  release(): void;
}

const appOf = (): App => {
  const app = (window as unknown as { azimuth?: App }).azimuth;
  if (!app) throw new Error('[overdrive] The app is not up yet.');
  return app;
};

export function exposeOverdriveHook(game: Game): void {
  let last: DrillReport | null = null;
  const press = game as unknown as { button(b: number, down: boolean): void };

  /** Start a run now if this is a click, else on the next click (pointer lock and audio need one). */
  const launch = async (ctx: OverdriveContext): Promise<void> => {
    const app = appOf();
    const make = () => makeOverdrive(app.game, ctx.chart.level, ctx);
    const onDone = (r: DrillReport) => {
      last = r;
      console.info('[overdrive] Run over. Score', r.score, r);
      console.table(Object.fromEntries(r.stats.map((s) => [s.label, `${s.value}${s.unit ? ` ${s.unit}` : ''}`])));
      app.endPlay();
      app.showReport(r, { retry: () => void start(), back: () => app.refresh() });
    };
    const start = async () => {
      app.game.audio.unlock();
      if (await app.game.input.lock(store.settings.rawInput)) {
        app.play(make, onDone, { label: 'Overdrive' }, () => app.refresh());
        return;
      }
      console.warn('[overdrive] No pointer lock (headless?): playing without mouse capture. Aim with __overdrive.aim()/.aimAt(), fire with .click()/.hold()/.release().');
      app.closeOverlay();
      document.body.classList.add('playing');
      app.game.startDrill(make(), onDone, { label: 'Overdrive' });
    };
    if ((navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive) {
      await start();
      return;
    }
    app.toast('Overdrive is ready. Click anywhere to play.');
    console.info('[overdrive] Ready: click anywhere on the page to play.');
    window.addEventListener('pointerdown', () => void start(), { once: true, capture: true });
  };

  const overdrive = (async (level = 5, url = '/Better%20by%20Moonlight.mp3') => {
    const app = appOf();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[overdrive] ${url}: HTTP ${res.status}. Put a song in the repo root (git-excluded) or pass its URL.`);
    const blob = await res.blob();
    const file = new File([blob], decodeURIComponent(url.split('/').pop() || 'song.mp3'), { type: blob.type });
    const t0 = performance.now();
    const { meta } = await addSong(file);
    const song = await prepare(meta.id, app.game.audio, (p) => console.debug(`[overdrive] ${p.stage} ${Math.round(p.fraction * 100)}%`));
    const chart = generate(song.analysis, song.structure, presetById(meta.preset), level, meta.id);
    const kinds: Partial<Record<TargetKind, number>> = {};
    for (const t of chart.targets) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
    console.info(
      `[overdrive] "${meta.name}": ${song.analysis.bpm.toFixed(1)} BPM, confidence ${song.analysis.confidence.toFixed(2)}, ` +
        `${song.structure.sections.map((s) => s.kind).join(' → ')}; level ${level} (${chart.difficulty}): ${chart.targets.length} targets`,
      kinds,
      `ready in ${Math.round(performance.now() - t0)} ms`,
    );
    await launch({ chart, buffer: song.buffer, beats: song.analysis.beats, songName: song.meta.name });
  }) as Hook;

  overdrive.test = async (level = 5) => {
    const pcm = clickTrack();
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: pcm.length, sampleRate: 44100 });
    buffer.copyToChannel(pcm, 0);
    await launch({ chart: testChart(level), buffer, beats: testBeats(), songName: 'Click track' });
  };

  overdrive.off = () => {
    const app = appOf();
    app.closeOverlay();
    app.endPlay();
    app.refresh();
  };

  overdrive.drill = () => (game.drill instanceof OverdriveDrill ? game.drill : null);
  overdrive.report = () => last;

  overdrive.aim = (bearing, pitch) => {
    game.yaw = -bearing * DEG;
    game.pitch = pitch * DEG;
  };
  overdrive.aimAt = (index, part = 0) => {
    const f = overdrive.drill()?.figureOf(index, part);
    if (!f) return false;
    const a = game.anglesTo(f.aimPoint());
    overdrive.aim(a.yaw, a.pitch);
    return true;
  };
  overdrive.click = () => {
    game.input.buttons |= 1;
    press.button(0, true);
    game.input.buttons &= ~1;
  };
  overdrive.hold = () => {
    game.input.buttons |= 1;
    press.button(0, true);
  };
  overdrive.release = () => {
    game.input.buttons &= ~1;
  };

  (window as unknown as { __overdrive: Hook }).__overdrive = overdrive;
}
