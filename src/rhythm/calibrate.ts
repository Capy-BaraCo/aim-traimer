/**
 * Rhythm timing calibration (R1). Pure: no DOM, no WebAudio, so vitest can run it in node.
 *
 * The player clicks along with a metronome that is judged by song time with the audio offset held at 0,
 * so what is measured is exactly what song time misses. Positive = the player hears the audio late
 * (their clicks land after the beat), so it becomes a positive audio offset and targets arrive later.
 */

/** Clicks the player is asked to make. */
export const CALIBRATION_CLICKS = 16;
/** The first clicks are the player finding the beat, so they are not measured. */
export const SETTLE_CLICKS = 4;
/** A click further than this from its nearest beat was a slip, not a measurement. */
export const OUTLIER_SEC = 0.25;
/** Fewer usable clicks than this and the result is not trusted. */
export const MIN_USABLE = 6;
/** The audio offset slider and any saved value stay inside this, in ms. */
export const OFFSET_LIMIT_MS = 200;

export type CalibrationResult = { ok: true; offsetMs: number; used: number } | { ok: false; used: number };

/** The beat nearest `t` in an ascending beat list, or NaN with no beats. */
function nearest(beats: number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  if (hi < 0) return NaN;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = beats[lo];
  const b = lo > 0 ? beats[lo - 1] : a;
  return Math.abs(t - b) < Math.abs(t - a) ? b : a;
}

/**
 * Click times and beat times, both in seconds of song time (offset 0). Each click minus its nearest
 * beat; drop the first SETTLE_CLICKS and anything beyond OUTLIER_SEC; the median, in whole ms, is the
 * audio offset (clamped to ±OFFSET_LIMIT_MS). Too few usable clicks gives ok: false, "try again".
 */
export function calibrationOffset(clicks: number[], beats: number[]): CalibrationResult {
  const errs: number[] = [];
  for (const c of clicks.slice(SETTLE_CLICKS)) {
    const e = c - nearest(beats, c);
    if (Number.isFinite(e) && Math.abs(e) <= OUTLIER_SEC) errs.push(e);
  }
  if (errs.length < MIN_USABLE) return { ok: false, used: errs.length };
  errs.sort((a, b) => a - b);
  const m = errs.length >> 1;
  const median = errs.length % 2 ? errs[m] : (errs[m - 1] + errs[m]) / 2;
  const ms = Math.round(median * 1000);
  return { ok: true, offsetMs: Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, ms)) + 0, used: errs.length };
}

export interface MetronomeOpts {
  bpm: number;
  /** Total beats in the track. */
  beats: number;
  sampleRate: number;
  /** Silence before the first beat, in seconds. */
  leadIn: number;
}

/**
 * A mono click track and the exact beat times (seconds from the start of the buffer). Each click is a
 * few ms of decaying sine that starts at full level on its beat's first sample, so the beat instant is
 * unambiguous. Every 4th beat (the first, fifth ...) is accented: higher and louder.
 */
export function metronomeClicks(opts: MetronomeOpts): { samples: Float32Array<ArrayBuffer>; beats: number[] } {
  const { bpm, beats: count, sampleRate: sr, leadIn } = opts;
  const period = 60 / bpm;
  const tail = 0.03;
  const samples = new Float32Array(Math.ceil((leadIn + (count - 1) * period + tail + 0.05) * sr));
  const beats: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.round((leadIn + i * period) * sr);
    beats.push(start / sr);
    const accent = i % 4 === 0;
    const freq = accent ? 1760 : 1100;
    const gain = accent ? 0.9 : 0.6;
    const len = Math.round(0.025 * sr);
    for (let k = 0; k < len && start + k < samples.length; k++) {
      const t = k / sr;
      // cosine, so the very first sample is full level rather than a zero crossing
      samples[start + k] = gain * Math.cos(2 * Math.PI * freq * t) * Math.exp(-t / 0.006);
    }
  }
  return { samples, beats };
}
