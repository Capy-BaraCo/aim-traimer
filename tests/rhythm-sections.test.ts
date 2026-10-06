import { describe, expect, it } from 'vitest';
import { analyse } from '../src/rhythm/analysis';
import { BEATS_PER_BAR, MIN_SECTION_BARS, structure } from '../src/rhythm/sections';
import type { Analysis, SectionKind, Structure } from '../src/rhythm/types';
import { beatlessNoise, songgen, type SonggenResult } from './helpers/songgen';

/** 11 kHz keeps the fixtures fast; the analysis averages down to about that rate anyway. */
const RATE = 11025;
/** Seconds a detected downbeat may be from the true one and still count. */
const TOLERANCE = 0.02;

type Spec = { bars: number; energy: number; kind: SectionKind }[];

/** A pop song: the build is a few short steps of rising energy, since songgen Sections are flat. */
const POP: Spec = [
  { bars: 8, energy: 0.2, kind: 'intro' }, { bars: 16, energy: 0.35, kind: 'calm' },
  { bars: 4, energy: 0.45, kind: 'build' }, { bars: 4, energy: 0.6, kind: 'build' },
  { bars: 16, energy: 0.9, kind: 'peak' }, { bars: 8, energy: 0.35, kind: 'calm' },
  { bars: 16, energy: 0.95, kind: 'peak' }, { bars: 8, energy: 0.2, kind: 'outro' },
];
/** Two drops, each after a staircase build; the calm before the first build is only 8 Bars. */
const EDM: Spec = [
  { bars: 8, energy: 0.25, kind: 'intro' }, { bars: 8, energy: 0.4, kind: 'calm' },
  { bars: 4, energy: 0.55, kind: 'build' }, { bars: 4, energy: 0.7, kind: 'build' },
  { bars: 16, energy: 1, kind: 'peak' }, { bars: 16, energy: 0.3, kind: 'calm' },
  { bars: 4, energy: 0.5, kind: 'build' }, { bars: 4, energy: 0.7, kind: 'build' },
  { bars: 16, energy: 1, kind: 'peak' }, { bars: 8, energy: 0.3, kind: 'outro' },
];
/** Verses and choruses with no build between them. */
const VERSES: Spec = [
  { bars: 4, energy: 0.3, kind: 'intro' }, { bars: 16, energy: 0.45, kind: 'calm' },
  { bars: 8, energy: 0.85, kind: 'peak' }, { bars: 16, energy: 0.45, kind: 'calm' },
  { bars: 8, energy: 0.85, kind: 'peak' }, { bars: 8, energy: 0.5, kind: 'calm' },
  { bars: 8, energy: 0.9, kind: 'peak' }, { bars: 4, energy: 0.3, kind: 'outro' },
];
/** A song that keeps getting louder: the first chorus is far below the last, but still a peak. */
const ARC: Spec = [
  { bars: 8, energy: 0.15, kind: 'intro' }, { bars: 16, energy: 0.3, kind: 'calm' },
  { bars: 8, energy: 0.6, kind: 'peak' }, { bars: 16, energy: 0.4, kind: 'calm' },
  { bars: 8, energy: 0.75, kind: 'peak' }, { bars: 8, energy: 0.1, kind: 'calm' },
  { bars: 16, energy: 1, kind: 'peak' }, { bars: 8, energy: 0.2, kind: 'outro' },
];

function render(spec: Spec, opts: { seed: number; bpm: number; rampTo?: number; swing?: number; noise?: number }): SonggenResult {
  return songgen({ ...opts, sampleRate: RATE, sections: spec.map(({ bars, energy }) => ({ bars, energy })) });
}

/** The true Sections: neighbouring songgen Sections of the same kind are one Section. */
function truth(spec: Spec): { startBar: number; kind: SectionKind }[] {
  const out: { startBar: number; kind: SectionKind }[] = [];
  let bar = 0;
  for (const { bars, kind } of spec) {
    if (out.at(-1)?.kind !== kind) out.push({ startBar: bar, kind });
    bar += bars;
  }
  return out;
}

/** Every structural promise of structure(): tiling, lengths, bar alignment, intro/outro placement. */
function expectValid(s: Structure, a: Analysis): void {
  for (let i = 1; i < s.bars.length; i++) expect(s.bars[i]).toBeGreaterThan(s.bars[i - 1]);
  if (s.downbeats.length > 0) {
    expect(s.downbeats).toEqual(s.bars);
    // Every Bar starts on a Beat of the analysis.
    for (const t of s.bars) expect(a.beats).toContain(t);
  }
  if (s.bars.length < MIN_SECTION_BARS) {
    expect(s.sections).toEqual([]);
    return;
  }
  expect(s.sections.length).toBeGreaterThan(0);
  expect(s.sections[0].startBar).toBe(0);
  expect(s.sections.at(-1)!.endBar).toBe(s.bars.length);
  s.sections.forEach((section, i) => {
    expect(Number.isInteger(section.startBar) && Number.isInteger(section.endBar)).toBe(true);
    expect(section.endBar - section.startBar).toBeGreaterThanOrEqual(MIN_SECTION_BARS);
    if (i > 0) {
      expect(section.startBar).toBe(s.sections[i - 1].endBar);
      expect(section.kind).not.toBe(s.sections[i - 1].kind);
    }
    if (section.kind === 'intro') expect(i).toBe(0);
    if (section.kind === 'outro') expect(i).toBe(s.sections.length - 1);
  });
}

/** Largest distance, in Bars, between a detected Section start and the true one (same order). */
function boundaryError(s: Structure, song: SonggenResult, spec: Spec): number {
  const want = truth(spec);
  expect(s.sections.map((x) => x.kind)).toEqual(want.map((x) => x.kind));
  let worst = 0;
  want.forEach(({ startBar }, i) => {
    const bar = Math.min(startBar, song.bars.length - 2);
    const length = song.bars[bar + 1] - song.bars[bar];
    worst = Math.max(worst, Math.abs(s.bars[s.sections[i].startBar] - song.bars[startBar]) / length);
  });
  return worst;
}

/** Share of the true downbeats that start a detected Bar (within TOLERANCE). */
function downbeatRate(s: Structure, truthDownbeats: number[]): number {
  const hit = truthDownbeats.filter((t) => s.bars.some((b) => Math.abs(b - t) <= TOLERANCE));
  return hit.length / truthDownbeats.length;
}

function run(song: { pcm: Float32Array; sampleRate: number }): { a: Analysis; s: Structure } {
  const a = analyse(song.pcm, song.sampleRate);
  const s = structure(a);
  expectValid(s, a);
  return { a, s };
}

describe('structure: Sections of songs with known quiet and loud parts', () => {
  const songs: [string, Spec, number, number, number][] = [];
  for (const bpm of [90, 128, 174]) {
    songs.push(['pop', POP, bpm, 1, 0], ['pop', POP, bpm, 2, 0.5]);
    songs.push(['edm', EDM, bpm, 3, 0.3], ['verses', VERSES, bpm, 4, 0.5], ['arc', ARC, bpm, 5, 0.3]);
  }

  it.each(songs)('%s at %i BPM (seed %i, noise %f): boundaries within 1 Bar, middle kinds match', (_, spec, bpm, seed, noise) => {
    const song = render(spec, { seed, bpm, noise, swing: seed % 2 ? 0 : 0.4 });
    const { s } = run(song);
    expect(boundaryError(s, song, spec)).toBeLessThanOrEqual(1);
    expect(downbeatRate(s, song.downbeats)).toBeGreaterThanOrEqual(0.95);
  });

  it.each([[120, 140], [170, 150], [90, 100]])('follows a tempo ramp from %i to %i BPM', (bpm, rampTo) => {
    const song = render(POP, { seed: 6, bpm, rampTo, noise: 0.3, swing: 0.3 });
    const { s } = run(song);
    expect(boundaryError(s, song, POP)).toBeLessThanOrEqual(1);
    expect(downbeatRate(s, song.downbeats)).toBeGreaterThanOrEqual(0.95);
  });

  it('gives a loud opening only a 4-Bar intro and keeps the rest a peak', () => {
    const spec: Spec = [
      { bars: 16, energy: 0.9, kind: 'peak' }, { bars: 16, energy: 0.35, kind: 'calm' },
      { bars: 16, energy: 0.9, kind: 'peak' }, { bars: 8, energy: 0.2, kind: 'outro' },
    ];
    const { s } = run(render(spec, { seed: 7, bpm: 128, noise: 0.3 }));
    expect(s.sections.map(({ startBar, endBar, kind }) => [kind, startBar, endBar])).toEqual([
      ['intro', 0, 4], ['peak', 4, 16], ['calm', 16, 32], ['peak', 32, 48], ['outro', 48, 56],
    ]);
  });

  it('is deterministic', () => {
    const song = render(POP, { seed: 8, bpm: 128, noise: 0.5 });
    const a = analyse(song.pcm, song.sampleRate);
    expect(structure(a)).toEqual(structure(a));
  });
});

describe('structure: downbeats and Bars', () => {
  it.each([1, 2, 3])('leaves a %i-Beat pickup out of every Bar', (pickup) => {
    const song = render(POP, { seed: 9, bpm: 128, noise: 0.3 });
    // Cut the start so the song opens on the last `pickup` Beats of its first Bar.
    const shift = song.beats[BEATS_PER_BAR - pickup];
    const { a, s } = run({ pcm: song.pcm.slice(Math.round(shift * RATE)), sampleRate: RATE });
    const truthDownbeats = song.downbeats.slice(1).map((t) => t - shift);
    expect(s.bars[0]).toBeCloseTo(truthDownbeats[0], 1);
    expect(a.beats.filter((t) => t < s.bars[0] - TOLERANCE)).toHaveLength(pickup);
    expect(downbeatRate(s, truthDownbeats)).toBe(1);
  });

  it.each([[1, 100], [3, 100], [1, 140], [3, 140]])(
    're-counts after an odd Bar (last Bar %i Beat short, %i BPM) and keeps every other Bar four Beats',
    (dropped, bpm) => {
      const a = songgen({ seed: 10, bpm, sampleRate: RATE, sections: [{ bars: 8, energy: 0.2 }, { bars: 16, energy: 0.4 }] });
      const b = songgen({ seed: 11, bpm, sampleRate: RATE,
        sections: [{ bars: 16, energy: 0.9 }, { bars: 8, energy: 0.4 }, { bars: 16, energy: 0.95 }, { bars: 8, energy: 0.3 }] });
      const join = Math.round((a.beats.length - dropped) * (60 / bpm) * RATE);
      const pcm = new Float32Array(join + b.pcm.length);
      pcm.set(a.pcm.subarray(0, join));
      pcm.set(b.pcm, join);
      const { a: analysis, s } = run({ pcm, sampleRate: RATE });
      const truthDownbeats = [...a.downbeats, ...b.downbeats.map((t) => t + join / RATE)];
      expect(downbeatRate(s, truthDownbeats)).toBeGreaterThanOrEqual(0.98);
      const lengths = s.bars.slice(1).map((t, i) => analysis.beats.indexOf(t) - analysis.beats.indexOf(s.bars[i]));
      expect(lengths.filter((n) => n !== BEATS_PER_BAR)).toEqual([BEATS_PER_BAR - dropped]);
    },
  );

  it('keeps Section boundaries within 1 Bar when an odd Bar is half a Bar (beat 1 and 3 sound alike)', () => {
    const intro = songgen({ seed: 12, bpm: 120, sampleRate: RATE, sections: [{ bars: 8, energy: 0.2 }, { bars: 16, energy: 0.4 }] });
    const rest: Spec = [
      { bars: 16, energy: 0.9, kind: 'peak' }, { bars: 8, energy: 0.4, kind: 'calm' },
      { bars: 16, energy: 0.95, kind: 'peak' }, { bars: 8, energy: 0.3, kind: 'outro' },
    ];
    const tail = render(rest, { seed: 13, bpm: 120 });
    const join = Math.round((intro.beats.length - 2) * 0.5 * RATE);
    const pcm = new Float32Array(join + tail.pcm.length);
    pcm.set(intro.pcm.subarray(0, join));
    pcm.set(tail.pcm, join);
    const { s } = run({ pcm, sampleRate: RATE });
    const starts = [0, 8, 24 - 0.5, 40 - 0.5, 48 - 0.5, 64 - 0.5].map((bar) => bar * 2);
    expect(s.sections.map((x) => x.kind)).toEqual(['intro', 'calm', 'peak', 'calm', 'peak', 'outro']);
    s.sections.forEach((x, i) => expect(Math.abs(s.bars[x.startBar] - starts[i])).toBeLessThanOrEqual(2));
  });

  it.each([1, 2])('starts the count afresh after a silent gap (song shifted by %i Beats)', (shift) => {
    const a = songgen({ seed: 14, bpm: 120, sampleRate: RATE, sections: [{ bars: 8, energy: 0.3 }, { bars: 16, energy: 0.8 }] });
    const b = songgen({ seed: 15, bpm: 120, sampleRate: RATE,
      sections: [{ bars: 8, energy: 0.3 }, { bars: 16, energy: 0.9 }, { bars: 8, energy: 0.3 }] });
    const gap = 4 * RATE;
    const cut = Math.round(b.beats[shift] * RATE);
    const pcm = new Float32Array(a.pcm.length + gap + b.pcm.length - cut);
    pcm.set(a.pcm);
    pcm.set(b.pcm.subarray(cut), a.pcm.length + gap);
    const offset = (a.pcm.length + gap - cut) / RATE;
    const { s } = run({ pcm, sampleRate: RATE });
    expect(downbeatRate(s, [...a.downbeats, ...b.downbeats.slice(1).map((t) => t + offset)])).toBe(1);
  });
});

describe('structure: weak change points, short songs and no Beats', () => {
  it.each([16, 32, 64])('gives a flat %i-Bar loop valid Sections with a middle, and a shape when long enough', (bars) => {
    const { s } = run(songgen({ seed: bars, bpm: 128, sampleRate: RATE, bars, noise: 0.5 }));
    const middle = s.sections.filter((x) => x.kind !== 'intro' && x.kind !== 'outro');
    expect(middle.length).toBeGreaterThanOrEqual(1);
    expect(s.sections[0].kind).toBe('intro');
    expect(s.sections.at(-1)!.kind).toBe('outro');
    // A song that never changes still rises to a peak instead of staying one flat block.
    expect(middle.at(-1)!.kind).toBe('peak');
    if (bars >= 32) expect(new Set(middle.map((x) => x.kind)).size).toBeGreaterThanOrEqual(2);
  });

  it.each([
    [4, [{ bars: 4, energy: 0.5 }], ['calm']],
    [8, [{ bars: 4, energy: 0.3 }, { bars: 4, energy: 0.9 }], ['calm', 'peak']],
    [11, [{ bars: 4, energy: 0.3 }, { bars: 7, energy: 0.9 }], ['calm', 'peak']],
    [12, [{ bars: 4, energy: 0.3 }, { bars: 8, energy: 0.9 }], ['intro', 'peak', 'outro']],
  ])('splits a %i-Bar song into Sections of at least 4 Bars (intro and outro only from 12 Bars)', (bars, sections, kinds) => {
    const { s } = run(songgen({ seed: bars, bpm: 128, sampleRate: RATE, sections }));
    expect(s.bars).toHaveLength(bars);
    expect(s.sections.map((x) => x.kind)).toEqual(kinds);
  });

  it('never crashes without Beats: empty, silent and beatless audio', () => {
    const empty = analyse(new Float32Array(0), RATE);
    expect(structure(empty)).toEqual({ downbeats: [], bars: [], sections: [] });

    // Too few Beats: a tempo grid over the whole song, downbeats empty, still a shape.
    const silent = analyse(new Float32Array(60 * RATE), RATE);
    const grid = structure(silent);
    expectValid(grid, silent);
    expect(grid.downbeats).toEqual([]);
    expect(grid.bars).toHaveLength(Math.floor(60 / ((BEATS_PER_BAR * 60) / silent.bpm)));
    expect(grid.bars[1] - grid.bars[0]).toBeCloseTo((BEATS_PER_BAR * 60) / silent.bpm, 9);

    const short = structure(analyse(new Float32Array(5 * RATE), RATE));
    expect(short.sections).toEqual([]);

    for (const seed of [1, 2, 3]) {
      const noise = beatlessNoise({ seed, seconds: 30, sampleRate: RATE });
      run(noise);
    }
  });

  it('handles a hand-made Analysis with no Beats or a handful of them', () => {
    const base: Analysis = {
      version: 1, sampleRate: RATE, duration: 20, bpm: 120, beats: [], beatEnergy: [],
      onsetEnv: new Float32Array(2000), onsetHop: 0.01, confidence: 0,
    };
    const none = structure(base);
    expect(none.bars).toHaveLength(10);
    expect(none.sections.map((x) => [x.startBar, x.endBar])).toEqual([[0, 10]]);
    const few = structure({ ...base, beats: [1, 1.5, 2, 2.5, 3], beatEnergy: [0.1, 0.05, 0.1, 0.05, 0.1] });
    expectValid(few, { ...base, beats: [1, 1.5, 2, 2.5, 3] });
    expect(few.downbeats).toEqual([]);
  });
});
