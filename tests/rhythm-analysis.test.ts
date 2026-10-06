import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, analyse } from '../src/rhythm/analysis';
import { FFT, magnitudes } from '../src/rhythm/fft';
import type { Analysis } from '../src/rhythm/types';
import { beatlessNoise, songgen, type SonggenResult } from './helpers/songgen';

/** Seconds a detected Beat may be from the true one and still count. */
const TOLERANCE = 0.02;

/**
 * Share of true Beats matched by a detected Beat within TOLERANCE, counted one-to-one: walking the
 * true Beats in order, each claims the nearest detected Beat that no earlier true Beat claimed.
 */
function matchRate(truth: number[], detected: number[]): number {
  const claimed = new Set<number>();
  let hits = 0;
  let j = 0;
  for (const t of truth) {
    while (j + 1 < detected.length && detected[j + 1] <= t) j++;
    let best = -1;
    let gap = Infinity;
    for (let k = Math.max(0, j - 1); k <= Math.min(detected.length - 1, j + 2); k++) {
      const d = Math.abs(detected[k] - t);
      if (d < gap && !claimed.has(k)) {
        gap = d;
        best = k;
      }
    }
    if (best >= 0 && gap <= TOLERANCE) {
      claimed.add(best);
      hits++;
    }
  }
  return truth.length ? hits / truth.length : 1;
}

/** The true mean tempo: 60 over the mean true Beat interval (the average BPM of a ramp). */
function trueBpm(song: SonggenResult): number {
  const { beats } = song;
  return (60 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0]);
}

function expectWellFormed(a: Analysis, song: { pcm: Float32Array; sampleRate: number }): void {
  expect(a.version).toBe(ANALYSIS_VERSION);
  expect(a.sampleRate).toBe(song.sampleRate);
  expect(a.duration).toBe(song.pcm.length / song.sampleRate);
  expect(a.beatEnergy).toHaveLength(a.beats.length);
  for (let i = 1; i < a.beats.length; i++) expect(a.beats[i]).toBeGreaterThan(a.beats[i - 1]);
  expect(a.confidence).toBeGreaterThanOrEqual(0);
  expect(a.confidence).toBeLessThanOrEqual(1);
  expect(Number.isFinite(a.bpm) && a.bpm > 0).toBe(true);
}

/** Tempo within 1%, at least 95% of Beats within 20 ms, and a trusted grid. */
function expectTracked(a: Analysis, song: SonggenResult): void {
  expectWellFormed(a, song);
  expect(Math.abs(a.bpm / trueBpm(song) - 1)).toBeLessThan(0.01);
  expect(matchRate(song.beats, a.beats)).toBeGreaterThanOrEqual(0.95);
  expect(a.confidence).toBeGreaterThanOrEqual(0.6);
}

/** Quiet, loud and middling Sections, so energy changes through the Song. */
const SECTIONS = [{ bars: 8, energy: 0.3 }, { bars: 8, energy: 0.9 }, { bars: 8, energy: 0.6 }];

describe('FFT', () => {
  it('matches a direct DFT on a small complex input', () => {
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.sin(i * 1.3) + 0.25 * i;
      im[i] = Math.cos(i * 0.7) - 0.5;
    }
    const wantRe = new Float64Array(n);
    const wantIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        wantRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        wantIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
    }
    const fft = new FFT(n);
    fft.transform(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(wantRe[k], 9);
      expect(im[k]).toBeCloseTo(wantIm[k], 9);
    }
  });

  it('can be reused across frames and gives the magnitude of a pure tone in its bin', () => {
    const n = 64;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const mag = new Float64Array(n / 2 + 1);
    for (const bin of [3, 10]) {
      for (let i = 0; i < n; i++) {
        re[i] = Math.cos((2 * Math.PI * bin * i) / n);
        im[i] = 0;
      }
      fft.transform(re, im);
      magnitudes(re, im, mag);
      expect(mag[bin]).toBeCloseTo(n / 2, 9);
      for (let k = 0; k < mag.length; k++) if (k !== bin) expect(mag[k]).toBeLessThan(1e-9);
    }
  });

  it('rejects sizes that are not a power of two, and buffers of the wrong length', () => {
    expect(() => new FFT(12)).toThrow(RangeError);
    expect(() => new FFT(1)).toThrow(RangeError);
    expect(() => new FFT(8).transform(new Float64Array(4), new Float64Array(4))).toThrow(RangeError);
  });
});

describe('analyse', () => {
  const matrix: [number, number, number][] = [];
  for (const bpm of [70, 90, 120, 150, 174, 190]) {
    for (const swing of [0, 0.6]) for (const noise of [0, 0.5, 1]) matrix.push([bpm, swing, noise]);
  }

  it.each(matrix)('tracks a %i BPM loop (swing %f, noise %f): tempo within 1%, 95% of Beats within 20 ms', (bpm, swing, noise) => {
    const song = songgen({ seed: bpm * 10 + swing * 5 + noise * 2, bpm, swing, noise, sampleRate: 11025, sections: SECTIONS });
    expectTracked(analyse(song.pcm, song.sampleRate), song);
  });

  it.each([[70, 0], [70, 1], [120, 0.5], [190, 0], [190, 1]])(
    'finds no Beat in an 8 s quiet intro at %i BPM (noise %f) and tracks the rest',
    (bpm, noise) => {
      const intro = 8;
      // The first Section is quiet too, so the drums only just rise above the noise floor.
      const song = songgen({ seed: 40 + bpm, bpm, noise, introSeconds: intro, sampleRate: 11025,
        sections: [{ bars: 8, energy: 0.2 }, { bars: 8, energy: 0.8 }] });
      const a = analyse(song.pcm, song.sampleRate);
      expectTracked(a, song);
      expect(a.beats[0]).toBeGreaterThan(intro - TOLERANCE);
    },
  );

  it.each([1, 2, 3, 4, 5])('reports a genuine 70 BPM loop at 70 and a 190 BPM loop at 190, not 140 or 95 (seed %i)', (seed) => {
    for (const bpm of [70, 190]) {
      const song = songgen({ seed, bpm, swing: (seed % 3) * 0.3, noise: (seed % 3) * 0.5, sampleRate: 11025, bars: 16 });
      const a = analyse(song.pcm, song.sampleRate);
      expect(Math.abs(a.bpm / bpm - 1)).toBeLessThan(0.01);
    }
  });

  it.each([[120, 128], [90, 100], [170, 150]])('follows a tempo ramp from %i to %i BPM', (from, to) => {
    const song = songgen({ seed: from + to, bpm: from, rampTo: to, swing: 0.3, noise: 0.5, sampleRate: 11025, bars: 32 });
    const a = analyse(song.pcm, song.sampleRate);
    expectTracked(a, song);
    // The tracked Beats speed up or slow down with the music, not just on average.
    const interval = (beats: number[]): number => (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    expect(interval(a.beats.slice(0, 16))).toBeCloseTo(interval(song.beats.slice(0, 16)), 2);
    expect(interval(a.beats.slice(-16))).toBeCloseTo(interval(song.beats.slice(-16)), 2);
  });

  it.each([22050, 44100, 48000])('works at %i Hz', (sampleRate) => {
    const song = songgen({ seed: 7, bpm: 128, swing: 0.6, noise: 0.5, sampleRate, sections: SECTIONS });
    const a = analyse(song.pcm, song.sampleRate);
    expectTracked(a, song);
    expect(a.onsetHop).toBeGreaterThan(0.009);
    expect(a.onsetHop).toBeLessThan(0.011);
  });

  it('gives Beatless noise a confidence below 0.4', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const noise = beatlessNoise({ seed, seconds: 30, sampleRate: 11025 });
      const a = analyse(noise.pcm, noise.sampleRate);
      expectWellFormed(a, noise);
      expect(a.confidence).toBeLessThan(0.4);
    }
  });

  it('stamps the version and describes the onset envelope', () => {
    const song = songgen({ seed: 3, bpm: 100, sampleRate: 11025, bars: 8 });
    const a = analyse(song.pcm, song.sampleRate);
    expect(ANALYSIS_VERSION).toBe(1);
    expect(a.version).toBe(ANALYSIS_VERSION);
    expect(a.onsetEnv).toBeInstanceOf(Float32Array);
    expect(Math.abs(a.onsetEnv.length * a.onsetHop - a.duration)).toBeLessThan(0.1);
    expect(Math.max(...a.onsetEnv)).toBe(1);
    expect(Math.min(...a.onsetEnv)).toBe(0);
    // Frame i is centred at i × onsetHop: every drum hit peaks within 20 ms of its Beat.
    for (const beat of song.beats) {
      const centre = Math.round(beat / a.onsetHop);
      let at = centre;
      for (let i = centre - 5; i <= centre + 5; i++) if ((a.onsetEnv[i] ?? 0) > a.onsetEnv[at]) at = i;
      expect(Math.abs(at * a.onsetHop - beat)).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('gives one RMS energy per Beat that follows the Section energy', () => {
    const song = songgen({ seed: 11, bpm: 120, noise: 0.2, sampleRate: 11025,
      sections: [{ bars: 8, energy: 0.15 }, { bars: 8, energy: 1 }, { bars: 8, energy: 0.4 }] });
    const a = analyse(song.pcm, song.sampleRate);
    expect(a.beatEnergy).toHaveLength(a.beats.length);
    const mean = (from: number, to: number): number => {
      const values = a.beatEnergy.filter((_, i) => a.beats[i] >= from && a.beats[i] < to - TOLERANCE);
      return values.reduce((s, v) => s + v, 0) / values.length;
    };
    const [quiet, loud, middle] = song.sections;
    expect(mean(loud.startTime, loud.endTime)).toBeGreaterThan(1.5 * mean(middle.startTime, middle.endTime));
    expect(mean(middle.startTime, middle.endTime)).toBeGreaterThan(1.2 * mean(quiet.startTime, quiet.endTime));
    expect(Math.min(...a.beatEnergy)).toBeGreaterThan(0);
  });

  it('invents no Beats in a silent gap and picks the Song up again after it', () => {
    const part = songgen({ seed: 5, bpm: 128, noise: 0.3, sampleRate: 11025, bars: 12 });
    const gap = 10;
    const pcm = new Float32Array(2 * part.pcm.length + gap * part.sampleRate);
    pcm.set(part.pcm, 0);
    pcm.set(part.pcm, part.pcm.length + gap * part.sampleRate);
    const resume = part.duration + gap;
    const a = analyse(pcm, part.sampleRate);
    const truth = [...part.beats, ...part.beats.map((t) => t + resume)];
    expect(a.beats.filter((t) => t > part.duration && t < resume - TOLERANCE)).toEqual([]);
    expect(matchRate(truth, a.beats)).toBeGreaterThanOrEqual(0.95);
    expect(Math.abs(a.bpm / 128 - 1)).toBeLessThan(0.01);
  });

  it('gives the same Beats however loud the Song is', () => {
    const song = songgen({ seed: 4, bpm: 112, swing: 0.4, noise: 0.5, sampleRate: 11025, bars: 16 });
    const a = analyse(song.pcm, song.sampleRate);
    const b = analyse(song.pcm.map((v) => v * 0.01), song.sampleRate);
    expect(b.beats.length).toBe(a.beats.length);
    b.beats.forEach((t, i) => expect(t).toBeCloseTo(a.beats[i], 6));
    expect(b.confidence).toBeCloseTo(a.confidence, 6);
  });

  it('handles empty, silent and very short audio without Beats', () => {
    for (const pcm of [new Float32Array(0), new Float32Array(11025 * 5), new Float32Array(100).fill(0.3)]) {
      const a = analyse(pcm, 11025);
      expectWellFormed(a, { pcm, sampleRate: 11025 });
      expect(a.beats.length).toBeLessThanOrEqual(1);
      expect(a.confidence).toBe(0);
    }
    expect(() => analyse(new Float32Array(10), 0)).toThrow(RangeError);
  });

  it('analyses a 4-minute 44.1 kHz Song in under 3 s', () => {
    const song = songgen({ seed: 9, bpm: 126, swing: 0.3, noise: 0.5, sampleRate: 44100,
      sections: [{ bars: 16, energy: 0.2 }, { bars: 48, energy: 0.6 }, { bars: 48, energy: 1 }, { bars: 14, energy: 0.4 }] });
    expect(song.duration).toBeGreaterThan(240);
    const started = performance.now();
    const a = analyse(song.pcm, song.sampleRate);
    const seconds = (performance.now() - started) / 1000;
    expect(seconds).toBeLessThan(3);
    expectTracked(a, song);
  }, 30_000);
});
