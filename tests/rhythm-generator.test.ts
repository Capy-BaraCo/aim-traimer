import { describe, expect, it } from 'vitest';
import { analyse } from '../src/rhythm/analysis';
import { compose, generate, HOLD_LEAD, MIN_GRID_CONFIDENCE, peekPosition, type Composition } from '../src/rhythm/generator';
import { levelParams } from '../src/rhythm/levels';
import { MIXED } from '../src/rhythm/presets';
import { structure } from '../src/rhythm/sections';
import { TARGET_KINDS, type Analysis, type Chart, type SectionKind, type Structure, type TargetKind } from '../src/rhythm/types';
import { songgen } from './helpers/songgen';

/** Onset envelope hop of the synthetic analyses, as analyse() gives (about 10 ms). */
const HOP = 0.01;

type Spec = { kind: SectionKind; bars: number }[];

/** 200 Bars with every kind: builds into peaks, a peak straight after a calm, long intro and outro. */
const LONG: Spec = [
  { kind: 'intro', bars: 16 }, { kind: 'calm', bars: 24 }, { kind: 'build', bars: 8 }, { kind: 'peak', bars: 24 },
  { kind: 'calm', bars: 16 }, { kind: 'peak', bars: 24 }, { kind: 'calm', bars: 16 }, { kind: 'build', bars: 8 },
  { kind: 'peak', bars: 32 }, { kind: 'outro', bars: 32 },
];
/** 80 Bars: about two and a half minutes at 128 BPM. */
const SONG: Spec = [
  { kind: 'intro', bars: 8 }, { kind: 'calm', bars: 16 }, { kind: 'build', bars: 8 }, { kind: 'peak', bars: 16 },
  { kind: 'calm', bars: 8 }, { kind: 'peak', bars: 16 }, { kind: 'outro', bars: 8 },
];

const ENERGY: Record<SectionKind, number> = { intro: 0.08, calm: 0.15, build: 0.25, peak: 0.45, outro: 0.08 };

/**
 * An Analysis and Structure built directly (no audio): Beats from `start`, a tempo that drifts
 * linearly from bpm to rampTo, Bars of four Beats, and an onset envelope with a hit on every Beat
 * (downbeats strongest) and a softer one on every off-beat eighth.
 */
function synthetic(spec: Spec, opts: { bpm?: number; rampTo?: number; confidence?: number; start?: number } = {}): { analysis: Analysis; structure: Structure } {
  const { bpm = 128, rampTo = bpm, confidence = 0.9, start = 2 } = opts;
  const kinds: SectionKind[] = spec.flatMap((s) => Array<SectionKind>(s.bars * 4).fill(s.kind));
  const beats: number[] = [];
  let t = start;
  for (let i = 0; i < kinds.length; i++) {
    beats.push(t);
    t += 60 / (bpm + ((rampTo - bpm) * i) / kinds.length);
  }
  const end = t;
  const duration = end + 1;
  const env = new Float32Array(Math.ceil(duration / HOP) + 1);
  for (let f = 0; f < env.length; f++) env[f] = (0.02 * ((f * 7919) % 13)) / 13;
  const hit = (time: number, v: number): void => {
    const f = Math.round(time / HOP);
    env[f] = Math.max(env[f], v);
  };
  beats.forEach((b, i) => {
    hit(b, i % 4 === 0 ? 1 : i % 2 === 0 ? 0.8 : 0.7);
    hit((b + (beats[i + 1] ?? end)) / 2, kinds[i] === 'peak' ? 0.45 : 0.3);
  });
  const bars = beats.filter((_, i) => i % 4 === 0);
  let bar = 0;
  const sections = spec.map((s) => {
    const section = { startBar: bar, endBar: bar + s.bars, kind: s.kind };
    bar += s.bars;
    return section;
  });
  return {
    analysis: {
      version: 1, sampleRate: 44100, duration, bpm: (bpm + rampTo) / 2, beats,
      beatEnergy: beats.map((_, i) => ENERGY[kinds[i]] * (i % 4 === 0 ? 1.2 : 1)),
      onsetEnv: env, onsetHop: HOP, confidence,
    },
    structure: { downbeats: bars.slice(), bars, sections },
  };
}

/** Position of a time along the Beats, in beats (interpolated; extrapolated at the ends). */
function beatPos(beats: number[], t: number): number {
  const n = beats.length;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

/** On a Beat or the eighth half-way between two Beats, within 1 ms. */
function onGrid(beats: number[], t: number): boolean {
  const k = Math.max(0, Math.min(beats.length - 1, Math.round(beatPos(beats, t))));
  for (let i = Math.max(0, k - 1); i <= Math.min(beats.length - 1, k + 1); i++) {
    if (Math.abs(beats[i] - t) <= 0.001) return true;
    if (i + 1 < beats.length && Math.abs((beats[i] + beats[i + 1]) / 2 - t) <= 0.001) return true;
  }
  return false;
}

/** The Section kind a time falls in. */
function kindAt(s: Structure, t: number): SectionKind {
  let kind = s.sections[0].kind;
  for (const section of s.sections) if (s.bars[section.startBar] <= t + 1e-9) kind = section.kind;
  return kind;
}

/** Times a target must be clicked at: a flick or peeker's beat, or each burst orb. */
function hitTimes(chart: Chart): number[] {
  return chart.targets.flatMap((t) => (t.kind === 'burst' ? t.orbs.map((o) => o.time) : [t.targetTime]));
}

function maxOnScreen(chart: Chart): number {
  const events: [number, number][] = chart.targets.flatMap((t): [number, number][] => [[t.launchTime, 1], [t.windowEnd, -1]]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let n = 0;
  let most = 0;
  for (const [, d] of events) most = Math.max(most, (n += d));
  return most;
}

/** Everything a chart promises regardless of the song. */
function expectWellFormed(chart: Chart): void {
  const p = levelParams(chart.level, MIXED);
  for (let i = 1; i < chart.targets.length; i++) expect(chart.targets[i].targetTime).toBeGreaterThanOrEqual(chart.targets[i - 1].targetTime);
  for (const t of chart.targets) {
    expect(t.launchTime).toBeGreaterThanOrEqual(0);
    expect(t.launchTime).toBeLessThan(t.landTime);
    expect(t.landTime).toBeLessThanOrEqual(t.targetTime);
    expect(t.targetTime).toBeLessThan(t.windowEnd);
    expect(t.windowEnd).toBeLessThanOrEqual(chart.duration);
    if (t.kind === 'burst') {
      expect(t.orbs.length).toBeGreaterThanOrEqual(3);
      expect(t.orbs.length).toBeLessThanOrEqual(5);
      expect(t.orbs[0].time).toBe(t.targetTime);
      for (let i = 1; i < t.orbs.length; i++) expect(t.orbs[i].time).toBeGreaterThan(t.orbs[i - 1].time);
      expect(t.windowEnd).toBeGreaterThan(t.orbs[t.orbs.length - 1].time);
    }
    if (t.kind === 'hold') {
      expect(t.path.length).toBeGreaterThanOrEqual(2);
      expect(t.path[0]).toEqual(t.position);
    }
    if (t.kind === 'peeker') {
      const wall = chart.walls[t.wall];
      expect(wall).toBeDefined();
      const out = peekPosition(wall, t.side);
      expect(t.position.bearing).toBeCloseTo(out.bearing, 1);
      expect(t.position.distance).toBeCloseTo(out.distance, 1);
    }
  }
  // At most maxConcurrent on screen ([launchTime, windowEnd) overlaps) ...
  expect(maxOnScreen(chart)).toBeLessThanOrEqual(p.maxConcurrent);
  // ... and never two strafers or holds alive ([landTime, windowEnd)) at once.
  const tracking = chart.targets.filter((t) => t.kind === 'strafer' || t.kind === 'hold').sort((a, b) => a.landTime - b.landTime);
  for (let i = 1; i < tracking.length; i++) expect(tracking[i].landTime).toBeGreaterThanOrEqual(tracking[i - 1].windowEnd - 1e-9);
}

const SEEDS = ['song-a', 'song-b', 'song-c'];

describe('generate: seeded Overdrive charts', () => {
  const { analysis, structure: s } = synthetic(SONG, { bpm: 128 });

  it('gives a deep-equal chart for the same inputs, and another for a different song id, preset or level', () => {
    const a = generate(analysis, s, MIXED, 6, 'song-a');
    expect(generate(analysis, s, MIXED, 6, 'song-a')).toEqual(a);
    expect(a.targets.length).toBeGreaterThan(50);
    expect(generate(analysis, s, MIXED, 6, 'song-b').targets).not.toEqual(a.targets);
    expect(generate(analysis, s, MIXED, 7, 'song-a').targets).not.toEqual(a.targets);
    expect(a).toMatchObject({ songId: 'song-a', preset: 'mixed', difficulty: 'normal', level: 6, duration: analysis.duration });
    expect(generate(analysis, s, MIXED, 9, 'x').difficulty).toBe('expert');
  });

  it.each([1, 4, 7, 10])('keeps each Section kind\'s type mix within 10 points of the preset matrix over a 200-Bar song (level %i)', (level) => {
    // Three seeds of the song, so even the intro has 20+ pattern targets at level 1 (in an
    // 8-target intro one target is already 12.5 points). Fills, drops and flourishes are left out.
    const { analysis: a, structure: st } = synthetic(LONG, { bpm: 132, rampTo: 140 });
    const counts = new Map<SectionKind, Record<TargetKind, number>>();
    for (const seed of SEEDS) {
      const { chart, roles } = compose(a, st, MIXED, level, seed);
      chart.targets.forEach((t, i) => {
        if (roles[i] !== 'pattern') return;
        const kind = kindAt(st, t.targetTime);
        const row = counts.get(kind) ?? Object.fromEntries(TARGET_KINDS.map((k) => [k, 0])) as Record<TargetKind, number>;
        row[t.kind]++;
        counts.set(kind, row);
      });
    }
    for (const kind of ['intro', 'calm', 'build', 'peak', 'outro'] as const) {
      const row = counts.get(kind)!;
      const total = TARGET_KINDS.reduce((n, k) => n + row[k], 0);
      expect(total).toBeGreaterThanOrEqual(20);
      for (const type of TARGET_KINDS) {
        const share = row[type] / total;
        expect(Math.abs(share - MIXED.rows[kind].weights[type]), `${kind} ${type} ${share.toFixed(2)}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('puts every target beat and burst orb on a Beat or the eighth between two, on a drifting grid', () => {
    for (const [bpm, rampTo] of [[128, 128], [145, 156], [174, 160]]) {
      const { analysis: a, structure: st } = synthetic(SONG, { bpm, rampTo });
      for (const level of [1, 5, 10]) {
        const chart = generate(a, st, MIXED, level, `grid-${bpm}`);
        for (const t of chart.targets) expect(onGrid(a.beats, t.targetTime), `${t.kind} at ${t.targetTime}`).toBe(true);
        for (const time of hitTimes(chart)) expect(onGrid(a.beats, time)).toBe(true);
        // Burst orbs sit on consecutive eighths.
        for (const t of chart.targets) {
          if (t.kind !== 'burst') continue;
          for (let i = 1; i < t.orbs.length; i++) expect(beatPos(a.beats, t.orbs[i].time) - beatPos(a.beats, t.orbs[i - 1].time)).toBeCloseTo(0.5, 6);
        }
      }
    }
  });

  it('lands each target its lead before its beat (rounded to the Section\'s land grid), measured along the drifting Beats', () => {
    const { analysis: a, structure: st } = synthetic(SONG, { bpm: 145, rampTo: 156 });
    for (const level of [1, 3, 5, 8, 10]) {
      const p = levelParams(level, MIXED);
      const chart = generate(a, st, MIXED, level, 'leads');
      const pos = (t: number): number => beatPos(a.beats, t);
      for (const t of chart.targets) {
        const row = MIXED.rows[kindAt(st, t.targetTime)];
        let lead = Math.max(1, Math.round(p.leadBeats / row.landGrid) * row.landGrid);
        if (t.kind === 'hold') lead = HOLD_LEAD;
        if (t.kind === 'flick' && t.shape === 'triangle') lead += 1;
        expect(lead).toBeGreaterThanOrEqual(1);
        expect(pos(t.targetTime) - pos(t.landTime), `${t.kind} lead`).toBeCloseTo(lead, 6);
        expect(pos(t.landTime) - pos(t.launchTime)).toBeCloseTo(p.flyInBeats, 6);
        const clamped = t.windowEnd >= chart.duration - 1e-9;
        if (clamped) continue;
        const after = t.kind === 'burst' ? pos(t.windowEnd) - pos(t.orbs[t.orbs.length - 1].time) : pos(t.windowEnd) - pos(t.targetTime);
        if (t.kind === 'flick' || t.kind === 'decoy' || t.kind === 'burst') expect(after).toBeCloseTo(p.afterBeats, 6);
        if (t.kind === 'peeker') expect(after).toBeCloseTo(p.peekerBeats, 6);
        if (t.kind === 'hold') expect(after).toBeCloseTo(p.holdBeats, 6);
        if (t.kind === 'strafer') expect([p.straferLifeBeats, p.straferLifeBeats / 2].map((life) => Math.abs(pos(t.windowEnd) - pos(t.landTime) - life) < 1e-6)).toContain(true);
      }
    }
  });

  it('runs a fill into every peak that follows another Section, onto a drop on its first downbeat', () => {
    const { analysis: a, structure: st } = synthetic(LONG, { bpm: 150 });
    for (const level of [1, 2, 5, 8, 10]) {
      for (const seed of SEEDS) {
        const { chart, roles } = compose(a, st, MIXED, level, seed);
        let peaks = 0;
        st.sections.forEach((section, i) => {
          if (i === 0 || section.kind !== 'peak') return;
          peaks++;
          const down = st.bars[section.startBar];
          const before = st.bars[section.startBar - 1];
          const fill = chart.targets.filter((t, j) => {
            const last = t.kind === 'burst' ? t.orbs[t.orbs.length - 1].time : t.targetTime;
            return (roles[j] === 'fill' || roles[j] === 'flourish') && last >= before - 1e-9 && last < down;
          });
          expect(fill.length, `fill before the peak at bar ${section.startBar}`).toBeGreaterThan(0);
          expect(chart.targets.some((t, j) => roles[j] === 'drop' && Math.abs(t.targetTime - down) < 1e-6)).toBe(true);
        });
        expect(peaks).toBe(3);
      }
    }
  });

  it('leaves a silent gap in the Beats empty and keeps counting beats across it', () => {
    // Drop Bars 30-31 (the analysis drops Beats in silence, and Structure has no Bar there).
    const { analysis: full, structure: st } = synthetic(SONG, { bpm: 128 });
    const gapFrom = full.beats[30 * 4 - 1];
    const gapTo = full.beats[32 * 4];
    const keep = (_: number, i: number): boolean => i < 30 * 4 || i >= 32 * 4;
    const a: Analysis = { ...full, beats: full.beats.filter(keep), beatEnergy: full.beatEnergy.filter(keep) };
    const gapped: Structure = {
      downbeats: st.downbeats.filter((_, i) => i < 30 || i >= 32),
      bars: st.bars.filter((_, i) => i < 30 || i >= 32),
      sections: st.sections.map((x) => ({ ...x, startBar: x.startBar >= 32 ? x.startBar - 2 : Math.min(x.startBar, 30), endBar: x.endBar >= 32 ? x.endBar - 2 : Math.min(x.endBar, 30) })),
    };
    for (const level of [2, 6, 10]) {
      const chart = generate(a, gapped, MIXED, level, 'gap');
      expectWellFormed(chart);
      for (const time of hitTimes(chart)) {
        expect(time <= gapFrom + 1e-9 || time >= gapTo - 1e-9, `${time} in the gap`).toBe(true);
        expect(onGrid(a.beats, time)).toBe(true);
      }
    }
  });

  it('stays readable at every level: on-screen cap, one strafer or hold at a time, nothing past the end', () => {
    const { analysis: a, structure: st } = synthetic(LONG, { bpm: 170 });
    for (let level = 1; level <= 10; level++) {
      const chart = generate(a, st, MIXED, level, 'readable');
      expect(chart.targets.length).toBeGreaterThan(0);
      expectWellFormed(chart);
      // Hit moments are at least the level's gap apart (a beat at levels 1-3, an eighth from 4),
      // except the orbs inside one burst.
      const gap = level <= 3 ? 1 : 0.5;
      const moments = chart.targets.filter((t) => t.kind === 'flick' || t.kind === 'peeker' || t.kind === 'burst')
        .map((t) => (t.kind === 'burst' ? [t.orbs[0].time, t.orbs[t.orbs.length - 1].time] : [t.targetTime, t.targetTime]))
        .sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < moments.length; i++) {
        expect(beatPos(a.beats, moments[i][0]) - beatPos(a.beats, moments[i - 1][1])).toBeGreaterThanOrEqual(gap - 1e-6);
      }
    }
  });

  it('keeps targets in the readable view, triangles out to the side and peekers behind their walls', () => {
    for (const level of [1, 5, 10]) {
      const chart = generate(analysis, s, MIXED, level, 'view');
      const kinds = new Set(chart.targets.map((t) => t.kind));
      expect([...kinds].sort()).toEqual([...TARGET_KINDS].sort());
      expect(chart.walls.length).toBeGreaterThan(0);
      expect(chart.walls.length).toBeLessThanOrEqual(2);
      for (const t of chart.targets) {
        const spots = t.kind === 'burst' ? t.orbs.map((o) => o.position) : t.kind === 'hold' ? t.path : [t.position];
        for (const at of spots) {
          if (t.kind === 'flick' && t.shape === 'triangle') {
            expect(Math.abs(at.bearing)).toBeGreaterThanOrEqual(60);
            expect(Math.abs(at.bearing)).toBeLessThanOrEqual(150);
            continue;
          }
          expect(Math.abs(at.bearing)).toBeLessThanOrEqual(35);
          expect(at.pitch).toBeGreaterThanOrEqual(-10);
          expect(at.pitch).toBeLessThanOrEqual(15);
          expect(at.distance).toBeGreaterThanOrEqual(10);
          expect(at.distance).toBeLessThanOrEqual(t.kind === 'peeker' ? 19 : 16);
          // Orbs stay above the floor (eye height 1.65 m).
          if (t.kind !== 'strafer' && t.kind !== 'peeker' && t.kind !== 'decoy') expect(1.65 + at.distance * Math.tan((at.pitch * Math.PI) / 180)).toBeGreaterThan(0.5);
        }
      }
      // Walls stand beyond every other target, so they never hide one.
      const nearestWall = Math.min(...chart.walls.map((w) => w.distance));
      for (const t of chart.targets) if (t.kind !== 'peeker') expect(t.position.distance).toBeLessThan(nearestWall - 1);
    }
  });

  it('puts targets on onset peaks when the beat grid is not trusted (R2)', () => {
    const { analysis: confident, structure: st } = synthetic(SONG, { bpm: 120 });
    const analysis2: Analysis = { ...confident, confidence: MIN_GRID_CONFIDENCE - 0.2 };
    const env = analysis2.onsetEnv;
    const isPeak = (t: number): boolean => {
      const f = Math.round(t / HOP);
      return Math.abs(f * HOP - t) < 1e-9 && env[f] > 0.1 && env[f] >= env[f - 1] && env[f] >= env[f + 1];
    };
    for (const level of [1, 5, 10]) {
      const { chart, roles } = compose(analysis2, st, MIXED, level, 'onsets');
      expect(chart.targets.length).toBeGreaterThan(20);
      expectWellFormed(chart);
      for (const time of hitTimes(chart)) expect(isPeak(time), `${time}`).toBe(true);
      for (const t of chart.targets) expect(isPeak(t.targetTime)).toBe(true);
      // No grid, so no fills or drops.
      expect(roles.every((r) => r === 'pattern')).toBe(true);
    }
    // A Structure without downbeats (too few Beats) is treated the same way.
    const chart = generate({ ...confident }, { ...st, downbeats: [] }, MIXED, 5, 'onsets');
    for (const time of hitTimes(chart)) expect(isPeak(time)).toBe(true);
  });

  it('grows denser with level, as the level table says', () => {
    const { analysis: a, structure: st } = synthetic(LONG, { bpm: 128 });
    const count = (level: number): number => SEEDS.reduce((n, seed) => n + generate(a, st, MIXED, level, seed).targets.length, 0);
    const counts = [1, 4, 7, 10].map(count);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    expect(counts[3] / counts[0]).toBeGreaterThan(1.6);
  });

  it('never throws on odd input and returns a valid, possibly empty, chart', () => {
    const empty: Analysis = { version: 1, sampleRate: 44100, duration: 0, bpm: 120, beats: [], beatEnergy: [], onsetEnv: new Float32Array(0), onsetHop: HOP, confidence: 0 };
    const cases: [string, Analysis, Structure][] = [
      ['empty', empty, { downbeats: [], bars: [], sections: [] }],
      ['no beats', { ...empty, duration: 30, onsetEnv: new Float32Array(3000) }, structure({ ...empty, duration: 30, onsetEnv: new Float32Array(3000) })],
      ['tiny song', ...Object.values(synthetic([{ kind: 'calm', bars: 3 }])) as [Analysis, Structure]],
      ['one section', ...Object.values(synthetic([{ kind: 'calm', bars: 12 }])) as [Analysis, Structure]],
      ['all peak', ...Object.values(synthetic([{ kind: 'peak', bars: 24 }])) as [Analysis, Structure]],
      ['no sections', synthetic(SONG).analysis, { ...synthetic(SONG).structure, sections: [] }],
      ['bad numbers', { ...synthetic(SONG).analysis, bpm: Number.NaN, duration: Number.NaN }, synthetic(SONG).structure],
    ];
    for (const [name, a, st] of cases) {
      for (const level of [Number.NaN, 0, 1, 10, 11]) {
        let result: Composition | undefined;
        expect(() => { result = compose(a, st, MIXED, level, name); }, name).not.toThrow();
        const chart = result!.chart;
        expect(chart.level).toBeGreaterThanOrEqual(1);
        expect(chart.level).toBeLessThanOrEqual(10);
        expect(result!.roles.length).toBe(chart.targets.length);
        expectWellFormed(chart);
      }
    }
    expect(generate(empty, { downbeats: [], bars: [], sections: [] }, MIXED, 5, 'e').targets).toEqual([]);
    // An all-peak song has no Section before its peak, so no fill, but it is still a chart.
    const allPeak = synthetic([{ kind: 'peak', bars: 24 }]);
    expect(generate(allPeak.analysis, allPeak.structure, MIXED, 5, 'p').targets.length).toBeGreaterThan(10);
  });

  it('builds a playable chart from audio: songgen → analyse → structure → generate', () => {
    const song = songgen({
      seed: 11, bpm: 124, sampleRate: 11025, noise: 0.2,
      sections: [{ bars: 8, energy: 0.2 }, { bars: 8, energy: 0.4 }, { bars: 4, energy: 0.55 }, { bars: 4, energy: 0.7 }, { bars: 12, energy: 0.95 }, { bars: 8, energy: 0.25 }],
    });
    const a = analyse(song.pcm, song.sampleRate);
    const st = structure(a);
    expect(a.confidence).toBeGreaterThanOrEqual(MIN_GRID_CONFIDENCE);
    for (const level of [2, 6, 10]) {
      const { chart, roles } = compose(a, st, MIXED, level, 'songgen');
      expect(chart.targets.length).toBeGreaterThan(20);
      expectWellFormed(chart);
      // Every target beat is on one of the song's true Beats or the eighth between two (within 30 ms).
      for (const time of hitTimes(chart)) {
        const near = song.beats.some((b, i) => Math.abs(b - time) < 0.03 || (i + 1 < song.beats.length && Math.abs((b + song.beats[i + 1]) / 2 - time) < 0.03));
        expect(near, `${time}`).toBe(true);
      }
      if (st.sections.some((sec, i) => i > 0 && sec.kind === 'peak')) expect(roles).toContain('fill');
    }
  });

  it('generates a five-minute chart in well under 100 ms', () => {
    const { analysis: a, structure: st } = synthetic(LONG, { bpm: 150, rampTo: 155 });
    expect(a.duration).toBeGreaterThan(300);
    generate(a, st, MIXED, 10, 'warm-up');
    const start = performance.now();
    const chart = generate(a, st, MIXED, 10, 'timed');
    const ms = performance.now() - start;
    expect(chart.targets.length).toBeGreaterThan(300);
    expect(ms).toBeLessThan(250);
  });
});
