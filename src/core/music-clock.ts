/**
 * Song time for music played on the AudioContext clock (R1). Pure: every method takes the clock
 * readings as arguments, so vitest can drive it without WebAudio. All times are in seconds.
 *
 *   song time = (context time − startedAt) + startOffset − output latency − audio offset
 *
 * It is the point in the song the player is hearing right now, so everything in an Overdrive run is
 * timed from it, never from frame time (which freezes, hitches and drifts against the audio).
 */

/**
 * The music starts this long after it is asked to. Scheduling the source a little ahead, rather than
 * "now", means it starts on exactly the context time we wrote down, even when the audio thread has
 * already rendered past the currentTime the page can see.
 */
export const START_LEAD = 0.1;

/**
 * Latency readings that move by less than this are ignored, so a rounded or jittery reading can't
 * shake song time. A real change (Bluetooth headphones connecting, say) is far bigger and is followed.
 */
export const LATENCY_DEADBAND = 0.015;

/** The parts of an AudioContext that say how late its output is heard. */
export interface LatencySource {
  outputLatency?: number;
  baseLatency?: number;
}

/**
 * How late the output is heard: outputLatency, else baseLatency (for browsers without outputLatency,
 * or that report 0 because they can't measure it), else 0.
 */
export function outputLatencyOf(ctx: LatencySource): number {
  const { outputLatency: out, baseLatency: base } = ctx;
  if (typeof out === 'number' && out > 0 && Number.isFinite(out)) return out;
  if (typeof base === 'number' && base > 0 && Number.isFinite(base)) return base;
  return 0;
}

export type MusicState = 'stopped' | 'playing' | 'paused';

/**
 * Where the song is across play, pause and resume. A WebAudio source plays once, so pausing stops it
 * and resuming starts a new one from the remembered position; this keeps that bookkeeping and the
 * song-time maths. Song time is frozen while paused, reads 0 with no song, and never steps backwards
 * during a song. After the song ends it keeps counting on the audio clock, so a drill sees the end
 * as a song time at or past `duration`.
 */
export class MusicClock {
  state: MusicState = 'stopped';
  /** Song length (the buffer's duration). */
  duration = 0;
  /** Context time the current source starts at. */
  private startedAt = 0;
  /** Song position at startedAt. While paused, the position to resume from. */
  private startOffset = 0;
  /** Latency in use (see LATENCY_DEADBAND). NaN until the first reading of a song. */
  private latency = NaN;
  /** Song time while not playing. */
  private frozen = 0;
  /** Highest song time handed out this song. */
  private high = -Infinity;

  /**
   * Start the song `fromSec` seconds in, with the source starting at context time `at`. Returns the
   * buffer offset to start the source at, or null when that is already the end (nothing to play).
   */
  play(at: number, fromSec: number, duration: number): number | null {
    this.duration = Math.max(0, duration);
    this.startOffset = Math.min(Math.max(0, fromSec), this.duration);
    this.startedAt = at;
    this.latency = NaN;
    this.high = -Infinity;
    this.state = 'playing';
    return this.startOffset < this.duration ? this.startOffset : null;
  }

  /** Seconds into the song at context time `now`: the source's position. Holds still while paused. */
  position(now: number): number {
    return this.state === 'playing' ? this.startOffset + Math.max(0, now - this.startedAt) : this.startOffset;
  }

  /** True while a source is actually making sound at context time `now`. */
  sounding(now: number): boolean {
    return this.state === 'playing' && now >= this.startedAt && this.position(now) < this.duration;
  }

  /** Song time at context time `now`, given the output latency and the audio offset (both seconds). */
  songTime(now: number, latency: number, offsetSec: number): number {
    if (this.state !== 'playing') return this.frozen;
    if (!(Math.abs(latency - this.latency) <= LATENCY_DEADBAND)) this.latency = latency;
    this.high = Math.max(this.high, this.position(now) - this.latency - offsetSec);
    return this.high;
  }

  /** Freeze song time at `now`. Returns the position to resume from, or null if nothing was playing. */
  pause(now: number, latency: number, offsetSec: number): number | null {
    if (this.state !== 'playing') return null;
    this.frozen = this.songTime(now, latency, offsetSec);
    this.startOffset = this.position(now);
    this.state = 'paused';
    return this.startOffset;
  }

  /**
   * Carry on from the remembered position with a new source starting at context time `at`. Song time
   * picks up exactly where it froze. Returns the buffer offset to start the source at, or null when
   * there is no source to start (not paused, or paused after the end; song time still carries on).
   */
  resume(at: number): number | null {
    if (this.state !== 'paused') return null;
    this.startedAt = at;
    this.state = 'playing';
    return this.startOffset < this.duration ? this.startOffset : null;
  }

  /** Forget the song: song time reads 0 until the next play. */
  stop(): void {
    this.state = 'stopped';
    this.duration = 0;
    this.startOffset = 0;
    this.frozen = 0;
    this.high = -Infinity;
  }
}

/** ContextClock never runs more than this far ahead of currentTime (it holds still instead). */
export const MAX_LEAD = 0.1;
/** How far back ContextClock looks for its freshest reading. Real clock drift over this is far below 1 ms. */
const WINDOW = 0.5;

/**
 * ctx.currentTime only moves when the audio thread finishes a block (often 10–40 ms, coarser where a
 * browser rounds its timers), so reading it once a frame makes moving targets judder and click timing
 * coarse. This fills in between blocks with performance.now() and stays locked to the audio clock.
 *
 * currentTime only ever lags the audio clock, so of the recent readings of (currentTime − now) the
 * largest is the freshest; the clock is now + that. It never reads below currentTime, never more than
 * MAX_LEAD above it, and never goes backwards: after a stall it holds still until the audio catches up,
 * and old readings leave the window within WINDOW seconds.
 */
export class ContextClock {
  /** Recent readings of (context time − performance time), largest first, with when they were taken. */
  private readonly skews: number[] = [];
  private readonly times: number[] = [];
  private last = -Infinity;

  /** Context time now, from ctx.currentTime and performance.now(), both in seconds. */
  read(ctxTime: number, perf: number): number {
    const skew = ctxTime - perf;
    const { skews, times } = this;
    while (skews.length && skews[skews.length - 1] <= skew) {
      skews.pop();
      times.pop();
    }
    skews.push(skew);
    times.push(perf);
    while (times[0] < perf - WINDOW) {
      skews.shift();
      times.shift();
    }
    this.last = Math.max(this.last, perf + Math.min(skews[0], skew + MAX_LEAD));
    return this.last;
  }
}
