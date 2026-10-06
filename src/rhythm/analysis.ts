/**
 * Tempo, beat and onset analysis of one Song's audio (T3, R2): analyse(pcm, sampleRate) → Analysis.
 * Pure: no DOM, no WebAudio, so it runs in vitest (node) and in the analysis worker (T9).
 *
 * D3 means there is no human fix-up step, so each stage is a standard published method. The
 * constants are set by what they mean (window lengths, tempo ranges, ratios) and were checked
 * against the songgen fixtures, synthetic drum styles and a real song, not fitted to one of them.
 *  1. Onset envelope (spectral flux). The audio is averaged down to about 11 kHz and cut into
 *     46 ms Hann windows every ~10 ms; each window becomes 24 mel bands. Each band's power is
 *     turned into loudness by Stevens' power law (exponent 0.3: +10 dB sounds about twice as
 *     loud), and the flux is the summed rise in band loudness from one frame to the next, measured
 *     against the loudest neighbouring band of the frame before (SuperFlux's maximum filter, Böck &
 *     Widmer 2013, so vibrato is not new sound). A pure log (dB) scale would make a quiet hi-hat
 *     count as much as the kick and snare and mislead the tempo octave. The flux then has its local
 *     mean (±0.25 s) taken off and is half-wave rectified, leaving peaks of new sound.
 *  2. Tempo: the envelope's autocorrelation, weighted by a tempo prior: a broad log-Gaussian on
 *     120 BPM (σ = 1 octave, as librosa) with a steep fall-off outside the preferred 80–180 BPM.
 *  3. Beats: Ellis's dynamic programme (Ellis 2007, as in librosa). Every beat sits on strong
 *     onsets while a log-period penalty holds the spacing to the local period, which comes from a
 *     tempo curve (windowed autocorrelation), so the beats follow drift and tempo changes section
 *     by section instead of a rigid global grid (R2).
 *  4. Tempo octave: the beats are tracked at the picked tempo, then double or half tempo is tried
 *     using what the tracked beats show, weighed against the prior: if the points half-way between
 *     beats carry onsets as strong as the beats, the pulse is twice as fast; if every other beat is
 *     much weaker, it is half as fast. Inside 80–180 BPM the music decides, so a genuine 70 or
 *     190 BPM loop is still reported at 70 or 190, while a groove at 90 is not halved to 45.
 *  5. Clean-up: each beat moves to the sub-frame peak of its onset; leading and trailing beats
 *     with no onset support (a quiet or noisy intro, a fade) and beats in silence are dropped, so
 *     no beat is invented where nothing plays.
 *  6. Per-beat RMS energy, and a 0..1 confidence from how periodic the onsets are at the tracked
 *     period and whether the beats sit on the onsets rather than between them.
 */
import { FFT, magnitudes } from './fft';
import type { Analysis } from './types';

/** Stamped on every Analysis; bump it whenever the output changes, so cached results are redone (T9). */
export const ANALYSIS_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Tunables (the header says why each stage exists)
// ---------------------------------------------------------------------------------------------

/** The audio is averaged down by a whole factor to about this rate (Hz) before the FFT. */
const WORK_RATE = 11025;
/** FFT frame: 512 samples is 46 ms at 11 kHz, long enough to smooth out beating partials. */
const FRAME_SIZE = 512;
/** Target onset-envelope hop in seconds; the exact value (whole samples) is Analysis.onsetHop. */
const HOP_SECONDS = 0.01;
const MEL_BANDS = 24;
const MEL_MIN_HZ = 30;
const MEL_MAX_HZ = 5500;
/** Stevens' power law exponent turning band power into loudness. */
const LOUDNESS_EXPONENT = 0.3;
/** Half-width (s) of the moving mean taken off the flux. */
const LOCAL_MEAN_SECONDS = 0.25;

/** Tempo search range. */
const MIN_BPM = 40;
const MAX_BPM = 240;
/** Tempo prior: a broad log-Gaussian around PRIOR_BPM (standard deviation in octaves) ... */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** ... and a steeper log-Gaussian fall-off (standard deviation in octaves) outside the preferred range. */
const PREFERRED_MIN_BPM = 80;
const PREFERRED_MAX_BPM = 180;
const OUTSIDE_OCTAVES = 0.3;

/**
 * DP beat tracking: how strongly the spacing is held to the local period. librosa uses 100; the
 * tempo curve already follows drift, so a tighter hold stops single beats jumping to a loud
 * off-beat accent.
 */
const TIGHTNESS = 300;
/** Tempo curve: window and step (s); search range (× or ÷ the global period, below 4:3 and 5:4). */
const CURVE_WINDOW_SECONDS = 8;
const CURVE_STEP_SECONDS = 2;
const CURVE_RANGE = 1.2;
/** Tempo curve: the smallest autocorrelation peak that counts, and the log-period spread of the
 * pull toward the global period when a window has more than one peak. */
const CURVE_MIN_PEAK = 0.2;
const CURVE_PULL = 0.15;

/**
 * Tempo octave: the half-way (or every-other-beat) to on-beat onset strength ratio at which
 * doubling (or halving) the tempo is even before the prior, and how many prior log-units each
 * factor e in that ratio is worth.
 */
const OCTAVE_RATIO = 0.5;
const OCTAVE_WEIGHT = 6;

/** A beat is supported when its onset is at least SUPPORT_FRACTION of a strong beat's (the
 * SUPPORT_QUANTILE of all beats), and so is the median of the SUPPORT_SPAN beats (two bars)
 * from it inwards. */
const SUPPORT_FRACTION = 0.1;
const SUPPORT_QUANTILE = 0.9;
const SUPPORT_SPAN = 8;
/** A beat is silent when its RMS is below this fraction of the loud beats' RMS (-40 dB) ... */
const SILENCE_RELATIVE = 0.01;
/** ... or below this absolute RMS (-80 dBFS). */
const SILENCE_ABSOLUTE = 1e-4;

/** Confidence (see confidenceOf): beats per periodicity window, and the two linear ramps. */
const CONFIDENCE_SPAN = 24;
const PERIODICITY_FLOOR = 0.08;
const PERIODICITY_FULL = 0.28;
const CONTRAST_FULL = 0.3;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Median of a numeric list (0 when empty). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The q-quantile (0..1) of a numeric list, nearest rank (0 when empty). */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Fractional position of the peak at integer index i, from a parabola through i - 1, i, i + 1. */
function parabolic(y: ArrayLike<number>, i: number): number {
  if (i <= 0 || i >= y.length - 1) return i;
  const a = y[i - 1];
  const b = y[i];
  const c = y[i + 1];
  const den = a - 2 * b + c;
  if (!(den < 0)) return i;
  const dx = (0.5 * (a - c)) / den;
  return Math.abs(dx) <= 0.5 ? i + dx : i;
}

/** Strongest envelope value within ±radius frames of a fractional frame position. */
function strengthNear(env: Float32Array, at: number, radius: number): number {
  let best = 0;
  const hi = Math.min(env.length - 1, Math.round(at + radius));
  for (let i = Math.max(0, Math.round(at - radius)); i <= hi; i++) if (env[i] > best) best = env[i];
  return best;
}

// ---------------------------------------------------------------------------------------------
// Onset envelope
// ---------------------------------------------------------------------------------------------

const toMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const fromMel = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

/** Triangular mel filters over the FFT bins: each band's first bin and its weights. */
function melBank(rate: number): { first: Int32Array; weights: Float64Array[] } {
  const bins = FRAME_SIZE / 2 + 1;
  const binHz = rate / FRAME_SIZE;
  const lo = toMel(MEL_MIN_HZ);
  const hi = toMel(Math.min(MEL_MAX_HZ, rate / 2));
  const edges: number[] = [];
  for (let b = 0; b < MEL_BANDS + 2; b++) edges.push(fromMel(lo + ((hi - lo) * b) / (MEL_BANDS + 1)));
  const first = new Int32Array(MEL_BANDS);
  const weights: Float64Array[] = [];
  for (let b = 0; b < MEL_BANDS; b++) {
    const [left, centre, right] = [edges[b], edges[b + 1], edges[b + 2]];
    const k0 = Math.max(0, Math.ceil(left / binHz));
    const k1 = Math.min(bins - 1, Math.floor(right / binHz));
    const w: number[] = [];
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      w.push(Math.max(0, f <= centre ? (f - left) / (centre - left) : (right - f) / (right - centre)));
    }
    if (w.some((v) => v > 0)) {
      first[b] = k0;
      weights.push(Float64Array.from(w));
    } else {
      // A band narrower than one bin takes the bin nearest its centre.
      first[b] = Math.min(bins - 1, Math.round(centre / binHz));
      weights.push(Float64Array.of(1));
    }
  }
  return { first, weights };
}

/**
 * The onset envelope (header, step 1) and its hop in seconds. Frame i's window is centred at
 * i × hop; its value is the rise in loudness from frame i - 1 to frame i, so a sharp onset peaks
 * at the frame centred at it or up to about a hop before it. Before frame 0 counts as silence, so
 * a hit right at the start of the file is an onset; frames stop at the last whole window, because
 * a window running past the end would hear the cut to silence as new sound. Scaled to a maximum of 1.
 */
function onsetEnvelope(pcm: Float32Array, sampleRate: number): { env: Float32Array; hop: number } {
  const factor = Math.max(1, Math.round(sampleRate / WORK_RATE));
  const rate = sampleRate / factor;
  const n = Math.floor(pcm.length / factor);
  const x = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += pcm[i++];
    x[j] = sum / factor;
  }
  const step = Math.max(1, Math.round(rate * HOP_SECONDS));
  const hop = (step * factor) / sampleRate;
  const frames = n > 0 ? Math.floor(Math.max(0, n - FRAME_SIZE / 2) / step) + 1 : 0;

  const N = FRAME_SIZE;
  const window = new Float64Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const { first, weights } = melBank(rate);
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(N / 2 + 1);
  const band = new Float32Array(frames * MEL_BANDS);
  let total = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * step - N / 2;
    for (let i = 0; i < N; i++) {
      const j = start + i;
      re[i] = j >= 0 && j < n ? x[j] * window[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    magnitudes(re, im, mag);
    for (let b = 0; b < MEL_BANDS; b++) {
      const w = weights[b];
      const k0 = first[b];
      let power = 0;
      for (let k = 0; k < w.length; k++) power += w[k] * mag[k0 + k] * mag[k0 + k];
      band[f * MEL_BANDS + b] = power;
      total += power;
    }
  }
  // Loudness relative to the song's mean band power, so the result does not depend on the level.
  const ref = total / Math.max(1, band.length) || 1;
  for (let i = 0; i < band.length; i++) band[i] = (band[i] / ref) ** LOUDNESS_EXPONENT;

  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const now = f * MEL_BANDS;
    const before = now - MEL_BANDS;
    let rise = 0;
    for (let b = 0; b < MEL_BANDS; b++) {
      let was = 0;
      if (f > 0) {
        was = band[before + b];
        if (b > 0 && band[before + b - 1] > was) was = band[before + b - 1];
        if (b + 1 < MEL_BANDS && band[before + b + 1] > was) was = band[before + b + 1];
      }
      if (band[now + b] > was) rise += band[now + b] - was;
    }
    flux[f] = rise / MEL_BANDS;
  }

  const half = Math.max(1, Math.round(LOCAL_MEAN_SECONDS / hop));
  const env = new Float32Array(frames);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    while (hi < Math.min(frames - 1, f + half)) sum += flux[++hi];
    while (lo < f - half) sum -= flux[lo++];
    const v = flux[f] - sum / (hi - lo + 1);
    if (v > 0) {
      env[f] = v;
      if (v > peak) peak = v;
    }
  }
  if (peak > 0) for (let f = 0; f < frames; f++) env[f] /= peak;
  return { env, hop };
}

// ---------------------------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------------------------

/** Log of the tempo prior (header, step 2): 0 at PRIOR_BPM, gentle inside 80–180, steep outside. */
function logPrior(bpm: number): number {
  const z = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
  const outside = Math.max(0, Math.log2(PREFERRED_MIN_BPM / bpm), Math.log2(bpm / PREFERRED_MAX_BPM)) / OUTSIDE_OCTAVES;
  return -0.5 * (z * z + outside * outside);
}

/** Autocorrelation of the mean-removed envelope for lags 0..maxLag, unbiased and divided by lag 0. */
function autocorrelation(env: Float32Array, maxLag: number): Float64Array {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= Math.max(1, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = env[i] - mean;
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0, j = lag; j < n; i++, j++) s += x[i] * x[j];
    out[lag] = s / (n - lag);
  }
  const zero = out[0];
  if (zero > 0) for (let lag = 0; lag <= maxLag; lag++) out[lag] /= zero;
  return out;
}

/** The beat period in frames: the autocorrelation peak that scores best with the prior. */
function pickPeriod(acf: Float64Array, fps: number): number {
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * fps));
  const maxLag = Math.min(acf.length - 2, Math.ceil((60 / MIN_BPM) * fps));
  let best = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (!(acf[lag] > 0 && acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1])) continue;
    const score = Math.log(acf[lag]) + logPrior((60 * fps) / lag);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best > 0 ? parabolic(acf, best) : (60 / PRIOR_BPM) * fps;
}

/**
 * The local beat period (frames) at every frame. In windows of about 8 s every 2 s it takes the
 * envelope's autocorrelation peak within CURVE_RANGE of the global period (so it never jumps an
 * octave or to a 3:2 or 4:3 rhythm), preferring the peak nearest the global period. Windows with
 * no clear peak give no estimate; the rest are median-smoothed over 5 windows and interpolated.
 */
function tempoCurve(env: Float32Array, period: number, fps: number): Float64Array {
  const n = env.length;
  const curve = new Float64Array(n).fill(period);
  const size = Math.round(Math.max(CURVE_WINDOW_SECONDS * fps, 6 * period));
  const lo = Math.max(2, Math.floor(period / CURVE_RANGE));
  const hi = Math.ceil(period * CURVE_RANGE);
  if (n < size || hi + 1 >= size) return curve;
  const step = Math.max(1, Math.round(CURVE_STEP_SECONDS * fps));
  const centres: number[] = [];
  const values: number[] = [];
  const acf = new Float64Array(hi + 2);
  for (let a = 0; a + size <= n; a += step) {
    let mean = 0;
    for (let i = a; i < a + size; i++) mean += env[i];
    mean /= size;
    let zero = 0;
    for (let i = a; i < a + size; i++) zero += (env[i] - mean) ** 2;
    zero /= size;
    if (!(zero > 0)) continue;
    for (let lag = lo - 1; lag <= hi + 1; lag++) {
      let s = 0;
      for (let i = a, j = a + lag; j < a + size; i++, j++) s += (env[i] - mean) * (env[j] - mean);
      acf[lag] = s / (size - lag) / zero;
    }
    let best = -1;
    let bestScore = 0;
    for (let lag = lo; lag <= hi; lag++) {
      if (!(acf[lag] >= CURVE_MIN_PEAK && acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1])) continue;
      const score = acf[lag] * Math.exp(-0.5 * (Math.log(lag / period) / CURVE_PULL) ** 2);
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    if (best < 0) continue;
    centres.push(a + size / 2);
    values.push(parabolic(acf, best));
  }
  if (values.length === 0) return curve;
  const smooth = values.map((_, i) => median(values.slice(Math.max(0, i - 2), i + 3)));
  for (let f = 0, k = 0; f < n; f++) {
    while (k + 1 < centres.length && centres[k + 1] <= f) k++;
    if (f <= centres[0]) curve[f] = smooth[0];
    else if (k + 1 >= centres.length) curve[f] = smooth[smooth.length - 1];
    else curve[f] = smooth[k] + ((f - centres[k]) / (centres[k + 1] - centres[k])) * (smooth[k + 1] - smooth[k]);
  }
  return curve;
}

// ---------------------------------------------------------------------------------------------
// Beat tracking
// ---------------------------------------------------------------------------------------------

/** DP local score: the envelope over its standard deviation, smoothed by a Gaussian of period / 32. */
function localScore(env: Float32Array, period: number): Float64Array {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= Math.max(1, n);
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (env[i] - mean) ** 2;
  const sd = Math.sqrt(variance / Math.max(1, n - 1)) || 1;
  const sigma = Math.max(0.5, period / 32);
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float64Array(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-0.5 * (k / sigma) ** 2) / sd;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = env[i];
    if (v === 0) continue;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) out[j] += v * kernel[k + radius];
    }
  }
  return out;
}

/**
 * Ellis's dynamic programme: score(i) = local(i) + max over earlier beats j of score(j) minus
 * TIGHTNESS × ln((i - j) / P)², with j between 2 P and P / 2 back, where P is the tempo curve at i
 * times `scale` (which tries the double or half tempo). Until the first real onset a chain may
 * start anywhere; after it every beat links back, as in librosa, so a stretch without onsets is
 * bridged rather than cutting the song in two. The path ends on the best-scoring frame in the two
 * periods up to the last onset and is read back from there. Returns ascending frame indices.
 */
function trackBeats(local: Float64Array, curve: Float64Array, scale: number): number[] {
  const n = local.length;
  let longest = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    longest = Math.max(longest, curve[i] * scale);
    peak = Math.max(peak, local[i]);
  }
  if (!(peak > 0)) return [];
  const logOf = new Float64Array(Math.round(2 * longest) + 2);
  for (let d = 1; d < logOf.length; d++) logOf[d] = Math.log(d);
  const significant = 0.01 * peak;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let started = false;
  let lastOnset = 0;
  for (let i = 0; i < n; i++) {
    const period = curve[i] * scale;
    const logPeriod = Math.log(period);
    const near = Math.max(1, Math.round(period / 2));
    const far = Math.max(near, Math.round(2 * period));
    let best = -Infinity;
    let from = -1;
    for (let d = near, j = i - near; d <= far && j >= 0; d++, j--) {
      const x = logOf[d] - logPeriod;
      const s = score[j] - TIGHTNESS * x * x;
      if (s > best) {
        best = s;
        from = j;
      }
    }
    if (from < 0 || (!started && best <= 0)) {
      score[i] = local[i];
    } else {
      score[i] = local[i] + best;
      back[i] = from;
    }
    if (local[i] >= significant) {
      started = true;
      lastOnset = i;
    }
  }
  let last = lastOnset;
  const reach = Math.round(2 * curve[lastOnset] * scale);
  for (let i = Math.max(0, lastOnset - reach); i <= lastOnset; i++) if (score[i] > score[last]) last = i;
  const beats: number[] = [];
  for (let i = last; i >= 0; i = back[i]) beats.push(i);
  return beats.reverse();
}

interface Pulse {
  /** Mean onset strength on the beats. */
  on: number;
  /** Mean onset strength half-way between beats. */
  mid: number;
  /** Weaker over stronger of the two alternating beat sets (odd and even beats), 0..1. */
  alternate: number;
}

/** How the onsets sit on and between the tracked beats (frame positions). */
function pulse(env: Float32Array, beats: number[], period: number): Pulse {
  const radius = Math.max(1, period / 16);
  const count = beats.length - 1;
  if (count <= 0) return { on: 0, mid: 0, alternate: 1 };
  let on = 0;
  let mid = 0;
  const parity = [0, 0];
  for (let i = 0; i < count; i++) {
    const s = strengthNear(env, beats[i], radius);
    on += s;
    parity[i & 1] += s;
    mid += strengthNear(env, (beats[i] + beats[i + 1]) / 2, radius);
  }
  const strong = Math.max(parity[0], parity[1]);
  return { on: on / count, mid: mid / count, alternate: strong > 0 ? Math.min(parity[0], parity[1]) / strong : 1 };
}

/**
 * The range [start, end) of beats (frame positions) the music supports, which drops leading beats
 * (a quiet or noisy intro) and trailing beats (a fade, or the DP coasting past the last hit). See
 * SUPPORT_FRACTION: checking the two bars from each end inwards means one loud hit cannot start
 * the beats early and one quiet beat cannot cut a groove short.
 */
function supportedRange(env: Float32Array, beats: number[], period: number): [number, number] {
  const radius = Math.max(1, period / 16);
  const strength = beats.map((b) => strengthNear(env, b, radius));
  const floor = SUPPORT_FRACTION * quantile(strength, SUPPORT_QUANTILE);
  const supported = (i: number, from: number, to: number): boolean =>
    strength[i] > 0 && strength[i] >= floor && median(strength.slice(Math.max(0, from), to)) >= floor;
  let start = 0;
  while (start < beats.length && !supported(start, start, start + SUPPORT_SPAN)) start++;
  let end = beats.length;
  while (end > start && !supported(end - 1, end - SUPPORT_SPAN, end)) end--;
  return [start, end];
}

/**
 * Track beats at the picked period, then try double and half tempo (header, step 4). The pulse is
 * judged on the supported beats only, so a noisy intro cannot dilute it. Moves at most twice and
 * only ever in one direction, so it cannot oscillate.
 */
function resolveOctave(env: Float32Array, start: number, fps: number): { period: number; beats: number[] } {
  const curve = tempoCurve(env, start, fps);
  const evidence = (ratio: number): number => OCTAVE_WEIGHT * Math.log(Math.max(1e-3, ratio) / OCTAVE_RATIO);
  let period = start;
  let beats = trackBeats(localScore(env, period), curve, 1);
  let direction = 0;
  for (let step = 0; step < 2; step++) {
    const [from, to] = supportedRange(env, beats, period);
    const p = pulse(env, beats.slice(from, to), period);
    const bpm = (60 * fps) / period;
    const up = bpm * 2 <= MAX_BPM && p.on > 0
      ? evidence(p.mid / p.on) + logPrior(bpm * 2) - logPrior(bpm) : -Infinity;
    const down = bpm / 2 >= MIN_BPM ? -evidence(p.alternate) + logPrior(bpm / 2) - logPrior(bpm) : -Infinity;
    let move = 0;
    if (up > 0 && up >= down && direction >= 0) move = 1;
    else if (down > 0 && direction <= 0) move = -1;
    if (move === 0) break;
    direction = move;
    period = move > 0 ? period / 2 : period * 2;
    beats = trackBeats(localScore(env, period), curve, period / start);
  }
  return { period, beats };
}

// ---------------------------------------------------------------------------------------------
// Energy and confidence
// ---------------------------------------------------------------------------------------------

/** RMS of pcm over [from, to) seconds. */
function rms(pcm: Float32Array, sampleRate: number, from: number, to: number): number {
  const a = Math.max(0, Math.round(from * sampleRate));
  const b = Math.min(pcm.length, Math.round(to * sampleRate));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / (b - a));
}

/** RMS over each beat's span: up to the next beat, or one period when the next is far or missing. */
function beatRms(pcm: Float32Array, sampleRate: number, times: number[], period: number): number[] {
  return times.map((t, i) => {
    const next = times[i + 1];
    return rms(pcm, sampleRate, t, next !== undefined && next - t <= 1.5 * period ? next : t + period);
  });
}

/** Normalised autocorrelation of env[a..b) at a fractional lag (the better of the two nearest lags). */
function windowCorrelation(env: Float32Array, a: number, b: number, lag: number): number {
  const n = b - a;
  if (n <= lag + 2) return 0;
  let mean = 0;
  for (let i = a; i < b; i++) mean += env[i];
  mean /= n;
  let zero = 0;
  for (let i = a; i < b; i++) zero += (env[i] - mean) ** 2;
  zero /= n;
  if (!(zero > 0)) return 0;
  let best = 0;
  for (const L of [Math.floor(lag), Math.ceil(lag)]) {
    let s = 0;
    for (let i = a; i + L < b; i++) s += (env[i] - mean) * (env[i + L] - mean);
    best = Math.max(best, s / (n - L) / zero);
  }
  return best;
}

/**
 * 0..1 trust in the beat grid, the product of two checks on the final beats (frame positions):
 *  - periodicity: the envelope's autocorrelation at the beat period, measured in overlapping
 *    windows of CONFIDENCE_SPAN beats (so drift does not blur it), median over the windows. Noise
 *    gives about 0.03, a real song with a clear beat 0.3 or more, a drum loop about 0.8. It maps
 *    linearly from 0 at PERIODICITY_FLOOR to 1 at PERIODICITY_FULL.
 *  - phase: the on-beat contrast (on - mid) / on, which is 0 or less when the beats sit between
 *    the onsets. It maps linearly from 0 at 0 to 1 at CONTRAST_FULL.
 */
function confidenceOf(env: Float32Array, beats: number[], period: number): number {
  if (beats.length < 8) return 0;
  const p = pulse(env, beats, period);
  const contrast = p.on > 0 ? (p.on - p.mid) / p.on : 0;
  const values: number[] = [];
  const span = CONFIDENCE_SPAN;
  for (let s = 0; s + span < beats.length; s += span / 2) {
    values.push(windowCorrelation(env, Math.round(beats[s]), Math.round(beats[s + span]), (beats[s + span] - beats[s]) / span));
  }
  if (values.length === 0) {
    const last = beats.length - 1;
    values.push(windowCorrelation(env, Math.round(beats[0]), Math.round(beats[last]), (beats[last] - beats[0]) / last));
  }
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  const periodicity = clamp((median(values) - PERIODICITY_FLOOR) / (PERIODICITY_FULL - PERIODICITY_FLOOR));
  return periodicity * clamp(contrast / CONTRAST_FULL);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Analyse a mono Song (any sample rate; T9 passes the decoded, downmixed samples).
 *  - beats: ascending seconds, only where the song plays: none in a quiet intro, after the end or
 *    in silence. Empty for silent audio.
 *  - bpm: the mean tempo over the beats (the average for a ramp); the tempo estimate, or 120, when
 *    there are too few beats. Always positive and finite.
 *  - beatEnergy: one value per beat, the RMS of the samples from that beat to the next (one
 *    period for the last beat or before a gap), in PCM units (0..1 for full-scale audio).
 *  - onsetEnv: onset strength (spectral flux), 0 = no new sound, scaled so the strongest frame is
 *    1. Frame i is centred at i × onsetHop seconds; onsetHop is about 10 ms.
 *  - confidence: 0..1 trust in the beat grid. Below 0.4, place targets on onsets instead (R2).
 */
export function analyse(pcm: Float32Array, sampleRate: number): Analysis {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) throw new RangeError('sampleRate must be a positive number');
  const { env, hop } = onsetEnvelope(pcm, sampleRate);
  const fps = 1 / hop;
  const result: Analysis = {
    version: ANALYSIS_VERSION,
    sampleRate,
    duration: pcm.length / sampleRate,
    bpm: PRIOR_BPM,
    beats: [],
    beatEnergy: [],
    onsetEnv: env,
    onsetHop: hop,
    confidence: 0,
  };
  const acf = autocorrelation(env, Math.ceil((60 / MIN_BPM) * fps) + 2);
  if (!(acf[0] > 0)) return result;

  const { period, beats: frames } = resolveOctave(env, pickPeriod(acf, fps), fps);
  const local = localScore(env, period);
  const refined = frames.map((f) => parabolic(local, f));
  const [start, end] = supportedRange(env, refined, period);
  const seconds = period * hop;
  let times = refined.slice(start, end).map((f) => Math.max(0, f * hop));
  let energy = beatRms(pcm, sampleRate, times, seconds);
  const quiet = Math.max(SILENCE_ABSOLUTE, SILENCE_RELATIVE * quantile(energy, 0.9));
  if (energy.some((e) => e < quiet)) {
    times = times.filter((_, i) => energy[i] >= quiet);
    energy = beatRms(pcm, sampleRate, times, seconds);
  }

  // The mean of the beat intervals near the period (gaps left by silence are not intervals).
  let sum = 0;
  let count = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.5 * seconds && d < 1.5 * seconds) {
      sum += d;
      count++;
    }
  }
  result.bpm = count > 0 ? 60 / (sum / count) : 60 / seconds;
  result.beats = times;
  result.beatEnergy = energy;
  result.confidence = confidenceOf(env, times.map((t) => t / hop), period);
  return result;
}
