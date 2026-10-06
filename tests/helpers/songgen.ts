/** Test-only synthetic Song audio with exact Beat, Bar and Section truth (D11). */

export interface SonggenOptions {
  seed: number;
  /** Starting quarter-note tempo, in BPM. */
  bpm: number;
  sampleRate?: number;
  /** One flat Section shortcut; use `sections` for an energy pattern. */
  bars?: number;
  /** Consecutive Sections. Energy is 0..1; each Section has at least four Bars. */
  sections?: { bars: number; energy: number }[];
  /** 0..1 delay of off-beat eighth-note hats, up to half an eighth-note interval. */
  swing?: number;
  /**
   * 0..1 broadband noise floor: peak amplitude 0.1 at 1, about 12 dB under a mid-energy kick and
   * level with a quiet Section's drums, so high values genuinely test robustness.
   */
  noise?: number;
  /** Drum-free lead-in before the first Beat, in seconds. */
  introSeconds?: number;
  /** Ending BPM; tempo varies smoothly across the Bars. */
  rampTo?: number;
  beatsPerBar?: number;
}

export interface SonggenResult {
  pcm: Float32Array;
  sampleRate: number;
  duration: number;
  bpm: number;
  /** Exact quarter-note Beat times in seconds, excluding the ending Bar boundary. */
  beats: number[];
  downbeats: number[];
  /** Start of every Bar; indices begin after the lead-in. */
  bars: number[];
  sections: { startBar: number; endBar: number; startTime: number; endTime: number; energy: number }[];
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(name: string, value: number, min: number, max = Infinity): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be in ${min}..${max}`);
}

function positiveInteger(name: string, value: number): void {
  finite(name, value, 1);
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer`);
}

/**
 * Generate a deterministic mono drum Song fixture. Beat and Section times are mathematical
 * truth; hits begin at the nearest sample. A ramp is linear in BPM over Beat position, with
 * its times obtained by integrating 60 / BPM, so the final Bar boundary reaches `rampTo`.
 */
export function songgen(opts: SonggenOptions): SonggenResult {
  const { seed, bpm, rampTo = bpm, sampleRate = 44100, beatsPerBar = 4 } = opts;
  const { swing = 0, noise = 0, introSeconds = 0 } = opts;
  finite('seed', seed, -Infinity);
  finite('bpm', bpm, 1);
  finite('rampTo', rampTo, 1);
  positiveInteger('sampleRate', sampleRate);
  positiveInteger('beatsPerBar', beatsPerBar);
  finite('swing', swing, 0, 1);
  finite('noise', noise, 0, 1);
  finite('introSeconds', introSeconds, 0);
  if ((opts.bars === undefined) === (opts.sections === undefined)) {
    throw new RangeError('Provide either bars or sections');
  }
  const spec = opts.sections ?? [{ bars: opts.bars!, energy: 0.7 }];
  if (spec.length === 0) throw new RangeError('sections must not be empty');
  for (const section of spec) {
    positiveInteger('section bars', section.bars);
    if (section.bars < 4) throw new RangeError('Each Section needs at least four Bars');
    finite('section energy', section.energy, 0, 1);
  }
  const barCount = spec.reduce((total, section) => total + section.bars, 0);
  const beatCount = barCount * beatsPerBar;
  const delta = rampTo - bpm;
  const beatTime = (position: number): number => introSeconds +
    (Math.abs(delta) < 1e-12
      ? (60 * position) / bpm
      : (60 * beatCount / delta) * Math.log1p((delta * position) / (beatCount * bpm)));
  const beats = Array.from({ length: beatCount }, (_, i) => beatTime(i));
  const bars = Array.from({ length: barCount }, (_, i) => beats[i * beatsPerBar]);
  const downbeats = bars.slice();
  const sections: SonggenResult['sections'] = [];
  let startBar = 0;
  for (const section of spec) {
    const endBar = startBar + section.bars;
    sections.push({ startBar, endBar, startTime: beatTime(startBar * beatsPerBar),
      endTime: beatTime(endBar * beatsPerBar), energy: section.energy });
    startBar = endBar;
  }

  // The final quarter-note interval completes the last Bar; a short tail preserves its decay.
  const pcm = new Float32Array(Math.ceil((beatTime(beatCount) + 0.2) * sampleRate));
  const random = rng(seed);
  if (noise > 0) {
    const floor = noise * 0.1;
    for (let i = 0; i < pcm.length; i++) pcm[i] = (random() * 2 - 1) * floor;
  }

  const hitIndex = (time: number) => Math.round(time * sampleRate);
  function kick(time: number, gain: number): void {
    const start = hitIndex(time);
    const length = Math.min(Math.ceil(0.24 * sampleRate), pcm.length - start);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      phase += 2 * Math.PI * (48 + 120 * Math.exp(-t * 32)) / sampleRate;
      // A short click makes the onset visible even before the sine wave rises.
      pcm[start + i] += gain * (Math.sin(phase) * Math.exp(-t * 19) + (i < 12 ? (1 - i / 12) * 0.32 : 0));
    }
  }
  function snare(time: number, gain: number): void {
    const start = hitIndex(time);
    const length = Math.min(Math.ceil(0.16 * sampleRate), pcm.length - start);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      pcm[start + i] += gain * Math.exp(-t * 28) *
        ((random() * 2 - 1) * 0.85 + Math.sin(2 * Math.PI * 185 * t) * 0.35);
    }
  }
  function hat(time: number, gain: number): void {
    const start = hitIndex(time);
    const length = Math.min(Math.ceil(0.045 * sampleRate), pcm.length - start);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const white = random() * 2 - 1;
      low += 0.16 * (white - low);
      pcm[start + i] += gain * (white - low) * Math.exp(-i * 75 / sampleRate);
    }
  }

  let sectionIndex = 0;
  for (let bar = 0; bar < barCount; bar++) {
    while (bar >= sections[sectionIndex].endBar) sectionIndex++;
    const energy = sections[sectionIndex].energy;
    const gain = 0.18 + 0.82 * energy;
    for (let step = 0; step < beatsPerBar; step++) {
      const index = bar * beatsPerBar + step;
      const start = beats[index];
      const next = beatTime(index + 1);
      const interval = next - start;
      // Every quarter-note has a strong onset. The default four-Beat Bar alternates
      // kick and snare; other meters keep that alternating pattern.
      if (step % 2 === 0) kick(start, 0.52 * gain);
      else snare(start, 0.40 * gain);
      hat(start, 0.095 * gain);
      hat(start + interval * (0.5 + swing * 0.25), 0.075 * gain);
      if (energy > 0.72) {
        if (step % 2 === 1) kick(start + interval * 0.75, 0.13 * gain);
        hat(start + interval * 0.25, 0.045 * gain);
      }
    }
  }

  // Scale the complete mix if overlapping transients would otherwise clip.
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak > 0.98) {
    const scale = 0.98 / peak;
    for (let i = 0; i < pcm.length; i++) pcm[i] *= scale;
  }
  return { pcm, sampleRate, duration: pcm.length / sampleRate, bpm, beats, downbeats, bars, sections };
}

/** Generate deterministic aperiodic mono noise for low-confidence Beat analysis tests. */
export function beatlessNoise(opts: { seed: number; seconds: number; sampleRate?: number }): {
  pcm: Float32Array; sampleRate: number; duration: number;
} {
  const { seed, seconds, sampleRate = 44100 } = opts;
  finite('seed', seed, -Infinity);
  finite('seconds', seconds, 0);
  positiveInteger('sampleRate', sampleRate);
  const pcm = new Float32Array(Math.ceil(seconds * sampleRate));
  const random = rng(seed);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (random() * 2 - 1) * 0.2;
  return { pcm, sampleRate, duration: pcm.length / sampleRate };
}
