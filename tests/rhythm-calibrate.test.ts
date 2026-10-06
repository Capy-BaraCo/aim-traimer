import { describe, expect, it } from 'vitest';
import { calibrationOffset, metronomeClicks } from '../src/rhythm/calibrate';

const { beats } = metronomeClicks({ bpm: 100, beats: 24, sampleRate: 48000, leadIn: 0.5 });

/** Small seeded PRNG so the jitter is the same every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16 clicks on the first 16 beats, `latencyMs` late, with ±jitterMs of seeded noise. */
function simulate(latencyMs: number, jitterMs: number, seed: number): number[] {
  const r = rng(seed);
  return beats.slice(0, 16).map((b) => b + (latencyMs + (r() * 2 - 1) * jitterMs) / 1000);
}

describe('calibrationOffset', () => {
  it('recovers +80 ms of latency from jittered clicks', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const res = calibrationOffset(simulate(80, 25, seed), beats);
      expect(res.ok).toBe(true);
      if (res.ok) expect(Math.abs(res.offsetMs - 80)).toBeLessThanOrEqual(10);
    }
  });

  it('recovers about 0 and negative latency', () => {
    const zero = calibrationOffset(simulate(0, 25, 7), beats);
    const neg = calibrationOffset(simulate(-60, 25, 8), beats);
    expect(zero.ok && Math.abs(zero.offsetMs)).toBeLessThanOrEqual(10);
    expect(neg.ok && Math.abs(neg.offsetMs + 60)).toBeLessThanOrEqual(10);
  });

  it('returns whole milliseconds and uses the 12 clicks after the first 4', () => {
    const res = calibrationOffset(simulate(80, 25, 3), beats);
    expect(res.ok && Number.isInteger(res.offsetMs)).toBe(true);
    expect(res.used).toBe(12);
  });

  it('ignores the first 4 clicks even if they are wild', () => {
    const clicks = simulate(80, 5, 9);
    clicks[0] += 0.2;
    clicks[1] -= 0.2;
    clicks[2] += 0.15;
    clicks[3] -= 0.1;
    const res = calibrationOffset(clicks, beats);
    expect(res.ok && res.offsetMs).toBeGreaterThanOrEqual(75);
    expect(res.ok && res.offsetMs).toBeLessThanOrEqual(85);
  });

  it('drops clicks more than 250 ms from a beat', () => {
    const clicks = simulate(80, 5, 10);
    // a late click sits 300 ms after its beat (nearest beat is 300 ms away): an outlier
    clicks[10] = beats[10] + 0.3;
    clicks[11] = beats[11] + 0.28;
    const res = calibrationOffset(clicks, beats);
    expect(res.ok).toBe(true);
    expect(res.used).toBe(10);
    expect(res.ok && Math.abs(res.offsetMs - 80)).toBeLessThanOrEqual(10);
  });

  it('asks for another try when too few clicks are usable', () => {
    expect(calibrationOffset(simulate(80, 5, 1).slice(0, 8), beats)).toEqual({ ok: false, used: 4 });
    expect(calibrationOffset([], beats)).toEqual({ ok: false, used: 0 });
    const scattered = beats.slice(0, 16).map((b) => b + 0.3);
    expect(calibrationOffset(scattered, beats).ok).toBe(false);
  });

  it('keeps the result inside the slider range', () => {
    const res = calibrationOffset(beats.slice(0, 16).map((b) => b + 0.24), beats);
    expect(res.ok && res.offsetMs).toBe(200);
  });
});

describe('metronomeClicks', () => {
  it('places each click on its beat, spaced by the tempo, accent every 4th', () => {
    const sr = 44100;
    const m = metronomeClicks({ bpm: 100, beats: 24, sampleRate: sr, leadIn: 0.5 });
    expect(m.beats).toHaveLength(24);
    expect(m.beats[1] - m.beats[0]).toBeCloseTo(0.6, 3);
    m.beats.forEach((b) => {
      const i = Math.round(b * sr);
      expect(Math.abs(m.samples[i])).toBeGreaterThan(0.3);
      expect(m.samples[i - 1]).toBe(0);
    });
    expect(Math.abs(m.samples[Math.round(m.beats[0] * sr)])).toBeGreaterThan(Math.abs(m.samples[Math.round(m.beats[1] * sr)]));
    expect(m.beats[0]).toBeCloseTo(0.5, 3);
  });
});
