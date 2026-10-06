/**
 * Bars and Sections of a Song (T4, R4): structure(analysis) → Structure.
 * Pure: no DOM, no WebAudio, so it runs in vitest (node) and in the analysis worker (T9).
 *
 * A listener points at "the big bit" because it is louder and fuller than what came before it,
 * so Sections come from how each Bar's energy moves, not from trying to name verse or chorus (R4).
 *  1. Downbeats. Bars are four Beats (4/4). Which Beat starts a Bar is read from two cues, scored
 *     for each Beat as a candidate Bar start:
 *      - accent: the Beat's energy against the two bars around it. Beat RMS is dominated by the
 *        low end, so the kick (on 1, and often 3) stands out; the snare's sharper onset is not
 *        used, because it sits on 2 and 4 in most songs but on 3 in half-time grooves.
 *      - change: songs change on the first Beat of a Bar. The energy of the bar after each Beat
 *        is compared with the bar before it, and the Beats where that jumps most (a local peak)
 *        score its size. This is what tells beat 1 from beat 3 when the kick plays on both.
 *     A Viterbi pass then counts 1-2-3-4 through the Beats, choosing the count with the best total
 *     score. The count may restart on another Beat, at a price worth several bars of evidence, so
 *     an odd bar (a 2/4 bar before a chorus, a Beat the tracker skipped) re-phases the Bars but a
 *     single loud fill does not. A gap in the Beats (silence, where the analysis drops them)
 *     starts the count afresh. Beats before the first downbeat (a pickup) are in no Bar.
 *  2. Bar level: the power mean of the Bar's Beat energies, in dB, median-smoothed over three Bars
 *     so one odd Bar (a stop, a fill) cannot make a Section.
 *  3. Plateaus: the Bars are cut into stretches of steady level by optimal partitioning (dynamic
 *     programming: least squared error plus a cost per cut, every stretch at least 4 Bars). The
 *     smallest step that counts is 1.2 × the song's own Bar-to-Bar wobble (0.5–2 dB), and
 *     neighbours closer than that are merged. Cuts are pulled onto the song's 4-Bar phrase grid
 *     (found from where the big changes fall), because sections start on phrases.
 *  4. Kinds. The first stretch is the intro and the last the outro (a loud opening or ending only
 *     gives them 4 Bars). Each middle stretch gets a tier from where its level sits between the
 *     song's quiet floor and loud top:
 *      - peak: in the upper half and within 3 dB of the top, or a clear rise (2.5 dB or more)
 *        over the quietest stretch of the 32 Bars before it, so the first chorus of a song that
 *        keeps getting louder is still a peak.
 *      - build: the run of stretches (up to 8 Bars) that climbs step by step into a peak.
 *      - calm: the rest.
 *     Neighbours of the same kind join into one Section.
 *  5. Weak change points (R4): when the middle is one stretch or never moves more than 1.5 dB, it
 *     is cut into 8-Bar phrases ranked by level instead; if even those are level (a flat loop),
 *     the middle follows a calm → build → peak → peak arc phrase by phrase and ends on a peak, so
 *     the chart still has a shape. A middle of a single phrase (a short song) is a peak when it
 *     stands 2.5 dB over the intro or outro, and calm otherwise.
 */
import type { Analysis, Section, SectionKind, Structure } from './types';

/** Beats per Bar (glossary: Bar). Overdrive assumes 4/4. */
export const BEATS_PER_BAR = 4;
/** The shortest Section, in Bars (glossary: Section). */
export const MIN_SECTION_BARS = 4;

// ---------------------------------------------------------------------------------------------
// Tunables (the header says why each stage exists)
// ---------------------------------------------------------------------------------------------

/** A Beat interval longer than this × the local interval is a gap: the Bar count restarts after it. */
const GAP_RATIO = 1.6;
/**
 * A Beat's accent is its log energy over the median of the two bars around it, capped at ±this
 * (≈ 4 dB, well above a kick's lead over a snare), so one near-silent Beat cannot outvote the song.
 */
const ACCENT_CAP = 0.5;
/** A bar-to-bar change in log energy (natural log, 0.1 ≈ 0.9 dB) must reach this to vote for a downbeat ... */
const CHANGE_FLOOR = 0.1;
/** ... and votes at most this much (≈ 6 dB), so a silence or a stop cannot outvote everything else. */
const CHANGE_CAP = 0.7;
/** Score a restart of the Bar count must gain (log-energy units: several bars of accents or changes). */
const RECOUNT_PRICE = 2.5;
/**
 * Head start for the first Beat of a run being a downbeat: drums usually come in on a "1". About
 * half of one clear change, so it only settles a near tie (a kick on both 1 and 3 and few changes).
 */
const START_PRIOR = 0.25;

/** The smallest level step that counts is this × the Bar-to-Bar wobble (robust standard deviation) ... */
const STEP_NOISE = 1.2;
/** ... kept between these (dB). */
const STEP_MIN_DB = 0.5;
const STEP_MAX_DB = 2;
/** Phrase grid (Bars) that cuts are pulled onto, and the extra cost of a cut off it (× the cut cost). */
const PHRASE_BARS = 4;
const OFF_PHRASE_COST = 0.5;

/** The quiet floor and loud top of the middle: these quantiles of its Bar levels. */
const FLOOR_QUANTILE = 0.15;
const TOP_QUANTILE = 0.95;
/** A middle whose floor-to-top span is below this (dB) has weak change points (R4). */
const WEAK_SPAN_DB = 1.5;
/** Peak: at least this far up the floor-to-top span and within PEAK_NEAR_TOP_DB of the top ... */
const PEAK_TIER = 0.5;
const PEAK_NEAR_TOP_DB = 3;
/** ... or at least RISE_TIER up the span and PEAK_RISE_DB above the quietest stretch in the LOOKBACK_BARS before it. */
const RISE_TIER = 0.3;
const PEAK_RISE_DB = 2.5;
const LOOKBACK_BARS = 32;
/** Build: at most this many Bars, each stretch above CALM_TIER of the span and rising by half a step. */
const MAX_BUILD_BARS = 8;
const CALM_TIER = 0.1;
/** Phrase length (Bars) for the weak-change fallback, the share of its level range that makes a peak or a build, and the arc. */
const PHRASE_BLOCK_BARS = 8;
const BLOCK_PEAK = 0.6;
const BLOCK_BUILD = 0.3;
const FLAT_ARC: readonly SectionKind[] = ['calm', 'build', 'peak', 'peak'];

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

/** Mean of values[from..to) (0 when empty). */
function meanOf(values: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  return to > from ? sum / (to - from) : 0;
}

// ---------------------------------------------------------------------------------------------
// Downbeats
// ---------------------------------------------------------------------------------------------

/** Start indices of the runs of Beats with no gap inside them (header, step 1). */
function beatRuns(beats: number[]): number[] {
  const starts = [0];
  for (let i = 1; i < beats.length; i++) {
    const near: number[] = [];
    for (let j = Math.max(1, i - 8); j <= Math.min(beats.length - 1, i + 8); j++) if (j !== i) near.push(beats[j] - beats[j - 1]);
    if (near.length > 0 && beats[i] - beats[i - 1] > GAP_RATIO * median(near)) starts.push(i);
  }
  return starts;
}

/** How strongly each Beat of log energies[from..to) sounds like the first Beat of a Bar (header, step 1). */
function downbeatScores(log: number[], from: number, to: number): Float64Array {
  const n = to - from;
  const score = new Float64Array(n);
  const bar = BEATS_PER_BAR;
  for (let i = from; i < to; i++) {
    const lo = Math.max(from, i - bar);
    const hi = Math.min(to, i + bar);
    if (hi - lo >= bar) score[i - from] = Math.max(-ACCENT_CAP, Math.min(ACCENT_CAP, log[i] - median(log.slice(lo, hi))));
  }
  const change = new Float64Array(n);
  for (let i = from + bar; i + bar <= to; i++) change[i - from] = Math.abs(meanOf(log, i, i + bar) - meanOf(log, i - bar, i));
  for (let k = 0; k < n; k++) {
    const v = change[k];
    if (v < CHANGE_FLOOR) continue;
    let peak = true;
    for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) if (j !== k && change[j] >= v) peak = false;
    if (peak) score[k] += Math.min(CHANGE_CAP, v);
  }
  return score;
}

/**
 * Indices of the Beats that start a Bar: a Viterbi pass over each Beat's place in the Bar
 * (0 = downbeat), which moves on by one each Beat or restarts for RECOUNT_PRICE (header, step 1).
 * The first Beat of a run starts START_PRIOR ahead as a downbeat.
 */
function downbeatIndices(beats: number[], beatEnergy: number[]): number[] {
  if (beats.length === 0) return [];
  const log = beats.map((_, i) => Math.log(Math.max(beatEnergy[i] ?? 0, 1e-9)));
  const starts = beatRuns(beats);
  const out: number[] = [];
  const bar = BEATS_PER_BAR;
  for (let r = 0; r < starts.length; r++) {
    const from = starts[r];
    const to = r + 1 < starts.length ? starts[r + 1] : beats.length;
    const score = downbeatScores(log, from, to);
    const n = to - from;
    let total = Array.from({ length: bar }, (_, s) => (s === 0 ? score[0] + START_PRIOR : 0));
    const back: Int8Array[] = [];
    for (let k = 1; k < n; k++) {
      let best = 0;
      for (let s = 1; s < bar; s++) if (total[s] > total[best]) best = s;
      const next = new Array<number>(bar);
      const previous = new Int8Array(bar);
      for (let s = 0; s < bar; s++) {
        const counted = (s + bar - 1) % bar;
        const recount = total[best] - RECOUNT_PRICE > total[counted];
        previous[s] = recount ? best : counted;
        next[s] = (recount ? total[best] - RECOUNT_PRICE : total[counted]) + (s === 0 ? score[k] : 0);
      }
      back.push(previous);
      total = next;
    }
    let state = 0;
    for (let s = 1; s < bar; s++) if (total[s] > total[state]) state = s;
    const places = new Int8Array(n);
    for (let k = n - 1; k >= 0; k--) {
      places[k] = state;
      if (k > 0) state = back[k - 1][state];
    }
    for (let k = 0; k < n; k++) if (places[k] === 0) out.push(from + k);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Bar levels and plateaus
// ---------------------------------------------------------------------------------------------

/** Each Bar's level in dB: the power mean of its Beats' RMS energies (header, step 2). */
function barLevels(beatEnergy: number[], firstBeats: number[], beatCount: number): number[] {
  return firstBeats.map((start, k) => {
    const end = k + 1 < firstBeats.length ? firstBeats[k + 1] : beatCount;
    let power = 0;
    for (let i = start; i < end; i++) power += (beatEnergy[i] ?? 0) ** 2;
    return 10 * Math.log10(Math.max(1e-12, power / Math.max(1, end - start)));
  });
}

/** Three-Bar running median (the ends keep their own value). */
function median3(x: number[]): number[] {
  return x.map((v, i) => (i === 0 || i === x.length - 1 ? v : median([x[i - 1], v, x[i + 1]])));
}

/** A stretch of Bars [start, end) and its mean level in dB. */
interface Stretch {
  start: number;
  end: number;
  level: number;
}

/**
 * Optimal partition of the levels into stretches of at least MIN_SECTION_BARS: least total
 * squared error plus `cut` per cut, plus cutCost(bar) for a cut before that bar.
 */
function partition(y: number[], cut: number, cutCost: (bar: number) => number): Stretch[] {
  const n = y.length;
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    s1[i + 1] = s1[i] + y[i];
    s2[i + 1] = s2[i] + y[i] * y[i];
  }
  const cost = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  cost[0] = 0;
  for (let b = MIN_SECTION_BARS; b <= n; b++) {
    for (let a = 0; a + MIN_SECTION_BARS <= b; a++) {
      if (!Number.isFinite(cost[a])) continue;
      const error = s2[b] - s2[a] - (s1[b] - s1[a]) ** 2 / (b - a);
      const c = cost[a] + error + (a > 0 ? cut + cutCost(a) : 0);
      if (c < cost[b]) {
        cost[b] = c;
        from[b] = a;
      }
    }
  }
  const out: Stretch[] = [];
  for (let b = n; b > 0; b = from[b]) out.push({ start: from[b], end: b, level: (s1[b] - s1[from[b]]) / (b - from[b]) });
  return out.reverse();
}

/** Join neighbouring stretches whose levels differ by less than `step`, closest pair first. */
function mergeSmallSteps(y: number[], parts: Stretch[], step: number): Stretch[] {
  const out = parts.slice();
  for (;;) {
    let at = -1;
    let smallest = step;
    for (let i = 0; i + 1 < out.length; i++) {
      const d = Math.abs(out[i + 1].level - out[i].level);
      if (d < smallest) {
        smallest = d;
        at = i;
      }
    }
    if (at < 0) return out;
    const start = out[at].start;
    const end = out[at + 1].end;
    out.splice(at, 2, { start, end, level: meanOf(y, start, end) });
  }
}

/**
 * Plateaus of steady level (header, step 3) and the phrase origin: the Bar (mod PHRASE_BARS) where
 * the big changes fall, found from a first pass and used to pull the second pass's cuts onto the grid.
 */
function plateaus(y: number[], step: number): { parts: Stretch[]; origin: number } {
  // Two 4-Bar stretches a step apart cut the squared error by 2 × step².
  const cut = 2 * step * step;
  const first = mergeSmallSteps(y, partition(y, cut, () => 0), step);
  const votes = new Array<number>(PHRASE_BARS).fill(0);
  for (let i = 1; i < first.length; i++) votes[first[i].start % PHRASE_BARS] += Math.abs(first[i].level - first[i - 1].level);
  let origin = 0;
  for (let o = 1; o < PHRASE_BARS; o++) if (votes[o] > votes[origin]) origin = o;
  const onGrid = (bar: number): boolean => (bar - origin) % PHRASE_BARS === 0;
  const parts = mergeSmallSteps(y, partition(y, cut, (bar) => (onGrid(bar) ? 0 : OFF_PHRASE_COST * cut)), step);
  return { parts, origin };
}

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

interface Labelled extends Stretch {
  kind: SectionKind;
}

/**
 * Calm, build or peak for each middle stretch (header, step 4), or the weak-change fallback
 * (step 5). `ends` is the level of the quieter of intro and outro, when there are any.
 */
function classifyMiddle(y: number[], parts: Stretch[], origin: number, step: number, ends?: number): Labelled[] {
  const levels: number[] = [];
  for (const p of parts) for (let k = p.start; k < p.end; k++) levels.push(y[k]);
  const floor = quantile(levels, FLOOR_QUANTILE);
  const top = quantile(levels, TOP_QUANTILE);
  const span = top - floor;
  if (parts.length < 2 || span < WEAK_SPAN_DB) return phrases(y, parts[0].start, parts[parts.length - 1].end, origin, step, ends);
  const tier = (level: number): number => (level - floor) / span;
  const kinds = parts.map((p, i): SectionKind => {
    if (tier(p.level) >= PEAK_TIER && p.level >= top - PEAK_NEAR_TOP_DB) return 'peak';
    let quietest = Infinity;
    for (let j = i - 1; j >= 0 && parts[j].end > p.start - LOOKBACK_BARS; j--) quietest = Math.min(quietest, parts[j].level);
    return tier(p.level) >= RISE_TIER && p.level - quietest >= PEAK_RISE_DB ? 'peak' : 'calm';
  });
  // Walk back from each peak through the stretches that climb into it, latest peak first, so the
  // lower steps of a staircase into the loudest stretch become its build even if they are loud.
  const rise = step / 2;
  for (let i = parts.length - 1; i > 0; i--) {
    if (kinds[i] !== 'peak') continue;
    let bars = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = parts[j];
      const below = p.level <= parts[j + 1].level - rise && (kinds[j] !== 'peak' || p.level <= parts[i].level - step);
      const climbing = j === 0 || p.level >= parts[j - 1].level + rise;
      if (!below || !climbing || tier(p.level) <= CALM_TIER || bars + p.end - p.start > MAX_BUILD_BARS) break;
      kinds[j] = 'build';
      bars += p.end - p.start;
    }
  }
  return parts.map((p, i) => ({ ...p, kind: kinds[i] }));
}

/**
 * Weak change points (header, step 5): Bars [start, end) cut into PHRASE_BLOCK_BARS phrases on the
 * phrase grid (a short last phrase joins the one before), ranked by level; level phrases follow
 * FLAT_ARC. A middle of one phrase is a peak if it stands PEAK_RISE_DB over the `ends` level.
 */
function phrases(y: number[], start: number, end: number, origin: number, step: number, ends?: number): Labelled[] {
  const blocks: Stretch[] = [];
  const offset = (((origin - start) % PHRASE_BLOCK_BARS) + PHRASE_BLOCK_BARS) % PHRASE_BLOCK_BARS;
  let cut = start + (offset >= MIN_SECTION_BARS ? offset : offset + PHRASE_BLOCK_BARS);
  for (let a = start; a < end; cut += PHRASE_BLOCK_BARS) {
    const b = end - cut < MIN_SECTION_BARS ? end : cut;
    blocks.push({ start: a, end: b, level: meanOf(y, a, b) });
    a = b;
  }
  if (blocks.length === 1) {
    const loud = ends !== undefined && blocks[0].level >= ends + PEAK_RISE_DB;
    return [{ ...blocks[0], kind: loud ? 'peak' : 'calm' }];
  }
  const levels = blocks.map((p) => p.level);
  const lo = Math.min(...levels);
  const range = Math.max(...levels) - lo;
  if (range < Math.max(STEP_MIN_DB, step)) {
    const kinds = blocks.map((_, i) => FLAT_ARC[i % FLAT_ARC.length]);
    // End on a peak, not on a drop back to calm or a build that leads nowhere.
    const last = kinds.length - 1;
    if (kinds[last] === 'build' && kinds[last - 1] === 'calm') kinds[last - 1] = 'build';
    if (kinds[last] !== 'peak') kinds[last] = 'peak';
    return blocks.map((p, i) => ({ ...p, kind: kinds[i] }));
  }
  const share = (p: Stretch): number => (p.level - lo) / range;
  const kinds = blocks.map((p): SectionKind => (share(p) >= BLOCK_PEAK ? 'peak' : 'calm'));
  for (let i = 1; i < blocks.length; i++) {
    if (kinds[i] === 'peak' && kinds[i - 1] === 'calm' && share(blocks[i - 1]) >= BLOCK_BUILD) kinds[i - 1] = 'build';
  }
  return blocks.map((p, i) => ({ ...p, kind: kinds[i] }));
}

/** Cut the plateaus to Bars [from, to); pieces under MIN_SECTION_BARS join the neighbour nearest in level. */
function clip(y: number[], parts: Stretch[], from: number, to: number): Stretch[] {
  const out: Stretch[] = [];
  for (const p of parts) {
    const start = Math.max(p.start, from);
    const end = Math.min(p.end, to);
    if (end > start) out.push({ start, end, level: meanOf(y, start, end) });
  }
  for (let i = 0; i < out.length && out.length > 1; ) {
    if (out[i].end - out[i].start >= MIN_SECTION_BARS) {
      i++;
      continue;
    }
    const left = i > 0 ? Math.abs(out[i - 1].level - out[i].level) : Infinity;
    const right = i + 1 < out.length ? Math.abs(out[i + 1].level - out[i].level) : Infinity;
    const j = left <= right ? i - 1 : i;
    const start = out[j].start;
    const end = out[j + 1].end;
    out.splice(j, 2, { start, end, level: meanOf(y, start, end) });
    i = Math.max(0, j);
  }
  return out;
}

/** The Sections for a list of raw Bar levels (header, steps 2-5). */
function sectionsFor(raw: number[]): Section[] {
  const n = raw.length;
  if (n < MIN_SECTION_BARS) return [];
  const y = median3(raw);
  const wobble = (1.4826 * median(raw.slice(1).map((v, i) => Math.abs(v - raw[i])))) / Math.SQRT2;
  const step = Math.min(STEP_MAX_DB, Math.max(STEP_MIN_DB, STEP_NOISE * wobble));
  const { parts, origin } = plateaus(y, step);
  let labelled: Labelled[];
  if (n < 3 * MIN_SECTION_BARS) {
    // Too short for intro, middle and outro of 4 Bars each: middle Sections only.
    labelled = classifyMiddle(y, parts, origin, step);
  } else {
    // Intro and outro are the first and last plateaus; a loud one (above the song's median) that
    // could spare it only gives up its first or last MIN_SECTION_BARS.
    const loud = median(y);
    const head = parts[0];
    const tail = parts[parts.length - 1];
    let introEnd = head.end;
    let outroStart = tail.start;
    if (parts.length === 1) {
      introEnd = MIN_SECTION_BARS;
      outroStart = n - MIN_SECTION_BARS;
    }
    if (head.level > loud && head.end - head.start >= 2 * MIN_SECTION_BARS) introEnd = head.start + MIN_SECTION_BARS;
    if (tail.level > loud && tail.end - tail.start >= 2 * MIN_SECTION_BARS) outroStart = tail.end - MIN_SECTION_BARS;
    // Leave room for a middle: shorten the longer end first.
    if (outroStart - introEnd < MIN_SECTION_BARS) {
      if (introEnd >= n - outroStart) introEnd = Math.max(MIN_SECTION_BARS, outroStart - MIN_SECTION_BARS);
      else outroStart = Math.min(n - MIN_SECTION_BARS, introEnd + MIN_SECTION_BARS);
    }
    if (outroStart - introEnd < MIN_SECTION_BARS) {
      introEnd = MIN_SECTION_BARS;
      outroStart = n - MIN_SECTION_BARS;
    }
    const intro = meanOf(y, 0, introEnd);
    const outro = meanOf(y, outroStart, n);
    const middle = classifyMiddle(y, clip(y, parts, introEnd, outroStart), origin, step, Math.min(intro, outro));
    labelled = [
      { start: 0, end: introEnd, level: intro, kind: 'intro' },
      ...middle,
      { start: outroStart, end: n, level: outro, kind: 'outro' },
    ];
  }
  const sections: Section[] = [];
  for (const p of labelled) {
    const last = sections[sections.length - 1];
    if (last && last.kind === p.kind) last.endBar = p.end;
    else sections.push({ startBar: p.start, endBar: p.end, kind: p.kind });
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Bars and Sections of an analysed Song (T4). Cheap (milliseconds for a 5-minute Song).
 *  - downbeats: the first Beat of each Bar (seconds), always one of analysis.beats.
 *  - bars: Bar start times; the same list as downbeats. A Bar holds the Beats from its downbeat up
 *    to the next Bar's (the last Bar holds the Beats left). That is normally four; a Bar may have
 *    fewer or more where the count restarts (an odd bar), and the Bar before a gap in the Beats
 *    (silence) also holds any Beats after the gap that come before the next downbeat. Beats before
 *    the first downbeat (a pickup) belong to no Bar.
 *    When the analysis has too few Beats for MIN_SECTION_BARS Bars (silence, beatless audio),
 *    bars is instead a grid of whole Bars of 4 × 60 / bpm seconds from 0 s, downbeats is empty
 *    (there is no Beat to start them), and the Sections come from the onset envelope's energy.
 *  - sections: index into bars, endBar exclusive. They tile every Bar with no gaps, each is at
 *    least MIN_SECTION_BARS long, neighbours differ in kind, intro appears only first and outro
 *    only last. A Song of 12 Bars or more has an intro and an outro; a shorter one has only
 *    middle Sections; under MIN_SECTION_BARS Bars there are none.
 */
export function structure(analysis: Analysis): Structure {
  const { beats, beatEnergy } = analysis;
  const firstBeats = downbeatIndices(beats, beatEnergy);
  if (firstBeats.length >= MIN_SECTION_BARS) {
    const bars = firstBeats.map((i) => beats[i]);
    return { downbeats: bars.slice(), bars, sections: sectionsFor(barLevels(beatEnergy, firstBeats, beats.length)) };
  }
  // Too few Beats: a tempo grid over the whole Song, with each Bar's onset energy as its level.
  const bpm = analysis.bpm > 0 && Number.isFinite(analysis.bpm) ? analysis.bpm : 120;
  const length = (BEATS_PER_BAR * 60) / bpm;
  const count = Math.max(0, Math.floor(analysis.duration / length)) || 0;
  const bars = Array.from({ length: count }, (_, k) => k * length);
  const { onsetEnv, onsetHop } = analysis;
  const levels = bars.map((t) => {
    if (!(onsetHop > 0)) return 0;
    const from = Math.min(onsetEnv.length, Math.round(t / onsetHop));
    const to = Math.min(onsetEnv.length, Math.round((t + length) / onsetHop));
    let power = 0;
    for (let f = from; f < to; f++) power += onsetEnv[f] * onsetEnv[f];
    return 10 * Math.log10(Math.max(1e-12, power / Math.max(1, to - from)));
  });
  return { downbeats: [], bars, sections: sectionsFor(levels) };
}
