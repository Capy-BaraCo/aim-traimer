import { describe, expect, it } from 'vitest';
import { beatlessNoise, songgen } from './helpers/songgen';

function rms(pcm: Float32Array, sampleRate: number, from: number, seconds: number): number {
  const start = Math.round(from * sampleRate);
  const count = Math.round(seconds * sampleRate);
  let sum = 0;
  for (let i = start; i < start + count; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / count);
}

describe('test-only Song generator', () => {
  it('repeats bit-identical PCM and truth for one seed, but changes PCM with another seed', () => {
    const opts = { seed: 3, bpm: 120, bars: 4, sampleRate: 8000, noise: 0.2 };
    const a = songgen(opts);
    const b = songgen(opts);
    expect(a.pcm).toEqual(b.pcm);
    expect(a.beats).toEqual(b.beats);
    expect(a.sections).toEqual(b.sections);
    expect(songgen({ ...opts, seed: 4 }).pcm).not.toEqual(a.pcm);
  });

  it.each([70, 120, 190])('spaces every Beat by 60/BPM at %i BPM', (bpm) => {
    const song = songgen({ seed: 1, bpm, bars: 4, sampleRate: 8000 });
    expect(song.beats).toHaveLength(16);
    for (let i = 1; i < song.beats.length; i++) {
      expect(song.beats[i] - song.beats[i - 1]).toBeCloseTo(60 / bpm, 10);
    }
  });

  it('starts the first Beat after a drum-free quiet intro', () => {
    const song = songgen({ seed: 5, bpm: 120, bars: 4, sampleRate: 8000, introSeconds: 8, noise: 0.2 });
    expect(song.beats[0]).toBe(8);
    expect(song.bars[0]).toBe(8);
    const intro = rms(song.pcm, song.sampleRate, 0, 1);
    const firstHit = rms(song.pcm, song.sampleRate, 8, 0.01);
    expect(intro).toBeLessThan(0.02);
    expect(firstHit).toBeGreaterThan(5 * intro);
  });

  it('moves off-beat hats with swing while quarter-note Beats stay fixed', () => {
    const opts = { seed: 2, bpm: 120, bars: 4, sampleRate: 8000 };
    const straight = songgen(opts);
    const swung = songgen({ ...opts, swing: 1 });
    expect(swung.beats).toEqual(straight.beats);
    expect(swung.pcm.slice(0, 1600)).toEqual(straight.pcm.slice(0, 1600));
    const offbeat = 0.25;
    expect(rms(straight.pcm, 8000, offbeat, 0.01)).toBeGreaterThan(rms(swung.pcm, 8000, offbeat, 0.01));
    expect(rms(swung.pcm, 8000, 0.375, 0.01)).toBeGreaterThan(rms(straight.pcm, 8000, 0.375, 0.01));
  });

  it('ramps smoothly toward the ending BPM with monotonic Beat intervals', () => {
    for (const rampTo of [70, 190]) {
      const song = songgen({ seed: 1, bpm: 120, rampTo, bars: 8, sampleRate: 8000 });
      const intervals = song.beats.slice(1).map((time, i) => time - song.beats[i]);
      for (let i = 1; i < intervals.length; i++) {
        if (rampTo > 120) expect(intervals[i]).toBeLessThan(intervals[i - 1]);
        else expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
      }
      expect(intervals[0]).toBeCloseTo(60 / 120, 1);
      expect(intervals.at(-1)).toBeCloseTo(60 / rampTo, 1);
    }
  });

  it('tiles Bars with exact Section boundaries and stronger loud-Section energy', () => {
    const song = songgen({ seed: 9, bpm: 120, sampleRate: 8000,
      sections: [{ bars: 4, energy: 0.1 }, { bars: 4, energy: 1 }, { bars: 4, energy: 0.3 }] });
    expect(song.bars).toHaveLength(12);
    expect(song.downbeats).toEqual(song.bars);
    expect(song.sections.map(({ startBar, endBar }) => [startBar, endBar])).toEqual([[0, 4], [4, 8], [8, 12]]);
    for (let i = 0; i < song.sections.length; i++) {
      const section = song.sections[i];
      expect(section.startTime).toBe(song.bars[section.startBar]);
      if (i > 0) expect(section.startTime).toBe(song.sections[i - 1].endTime);
      if (i < song.sections.length - 1) expect(section.endTime).toBe(song.bars[section.endBar]);
    }
    expect(rms(song.pcm, 8000, song.bars[4], 2)).toBeGreaterThan(rms(song.pcm, 8000, song.bars[0], 2) * 2);
  });

  it('puts sharp energy peaks after most true Beats and never clips', () => {
    const song = songgen({ seed: 7, bpm: 150, sampleRate: 8000, noise: 0.4, swing: 0.6,
      sections: [{ bars: 4, energy: 0.2 }, { bars: 4, energy: 1 }] });
    const stronger = song.beats.filter((beat) =>
      rms(song.pcm, song.sampleRate, beat, 0.01) > rms(song.pcm, song.sampleRate, beat - 0.01, 0.01));
    expect(stronger.length).toBeGreaterThan(song.beats.length * 0.9);
    for (const sample of song.pcm) expect(Math.abs(sample)).toBeLessThanOrEqual(1);
  });

  it('makes deterministic aperiodic Beatless noise', () => {
    const a = beatlessNoise({ seed: 10, seconds: 2, sampleRate: 8000 });
    expect(a.pcm).toEqual(beatlessNoise({ seed: 10, seconds: 2, sampleRate: 8000 }).pcm);
    expect(a.pcm).not.toEqual(beatlessNoise({ seed: 11, seconds: 2, sampleRate: 8000 }).pcm);
    expect(a.duration).toBe(2);
  });
});
