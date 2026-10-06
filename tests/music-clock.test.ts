import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audio } from '../src/core/audio';
import { ContextClock, LATENCY_DEADBAND, MAX_LEAD, MusicClock, outputLatencyOf, START_LEAD } from '../src/core/music-clock';

/** Small seeded PRNG, so the simulations are the same on every run. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A sound card: its clock runs at `rate` against performance.now() (real ones are off by up to a few
 * hundred ppm), and the page only sees currentTime move once per `block` of audio.
 */
function soundCard(rate: number, block: number) {
  return {
    truth: (perf: number) => perf * rate,
    currentTime: (perf: number) => Math.floor((perf * rate) / block) * block,
  };
}

describe('output latency', () => {
  it('uses outputLatency when the browser has it', () => {
    expect(outputLatencyOf({ outputLatency: 0.042, baseLatency: 0.01 })).toBe(0.042);
  });

  it('falls back to baseLatency without outputLatency (Firefox, Safari) or when it reads 0', () => {
    expect(outputLatencyOf({ baseLatency: 0.012 })).toBe(0.012);
    expect(outputLatencyOf({ outputLatency: undefined, baseLatency: 0.012 })).toBe(0.012);
    expect(outputLatencyOf({ outputLatency: 0, baseLatency: 0.012 })).toBe(0.012);
    expect(outputLatencyOf({ outputLatency: NaN, baseLatency: 0.012 })).toBe(0.012);
  });

  it('is 0 when the browser reports neither', () => {
    expect(outputLatencyOf({})).toBe(0);
    expect(outputLatencyOf({ outputLatency: 0, baseLatency: 0 })).toBe(0);
  });
});

describe('song time', () => {
  const LAT = 0.04;

  it('reads 0 and stays frozen before any song plays', () => {
    const c = new MusicClock();
    expect(c.state).toBe('stopped');
    expect(c.songTime(0, LAT, 0)).toBe(0);
    expect(c.songTime(50, LAT, 0)).toBe(0);
  });

  it('plays from an offset: context time since the start + offset − latency − audio offset', () => {
    const c = new MusicClock();
    expect(c.play(10, 30, 240)).toBe(30);
    expect(c.songTime(12.5, LAT, 0)).toBeCloseTo(32.5 - LAT, 9);
    expect(c.songTime(100, LAT, 0)).toBeCloseTo(120 - LAT, 9);
  });

  it('holds still until the source starts, then counts up from there', () => {
    const c = new MusicClock();
    c.play(10, 30, 240);
    expect(c.songTime(9.9, LAT, 0)).toBeCloseTo(30 - LAT, 9);
    expect(c.songTime(10, LAT, 0)).toBeCloseTo(30 - LAT, 9);
    expect(c.songTime(10.25, LAT, 0)).toBeCloseTo(30.25 - LAT, 9);
  });

  it('subtracts a positive audio offset, so targets arrive later', () => {
    const late = new MusicClock();
    const none = new MusicClock();
    late.play(0, 0, 240);
    none.play(0, 0, 240);
    expect(late.songTime(5, LAT, 0.08)).toBeCloseTo(none.songTime(5, LAT, 0) - 0.08, 9);
  });

  it('freezes while paused and resumes from exactly the remembered position', () => {
    const c = new MusicClock();
    c.play(0, 0, 240);
    expect(c.pause(20, LAT, 0)).toBeCloseTo(20, 9);
    const frozen = c.songTime(20, LAT, 0);
    expect(c.songTime(25, LAT, 0)).toBe(frozen);
    expect(c.songTime(90, LAT, 0)).toBe(frozen);
    expect(c.resume(100)).toBeCloseTo(20, 9);
    expect(c.songTime(100, LAT, 0)).toBeCloseTo(frozen, 9);
    expect(c.songTime(101.5, LAT, 0)).toBeCloseTo(frozen + 1.5, 9);
  });

  it('after many pauses, song time is exactly the music played so far', () => {
    const c = new MusicClock();
    const r = rng(7);
    let now = 3;
    let played = 0;
    c.play(now, 0, 240);
    for (let i = 0; i < 25; i++) {
      const run = 0.2 + r() * 8;
      now += run;
      played += run;
      expect(c.songTime(now, LAT, 0)).toBeCloseTo(played - LAT, 9);
      c.pause(now, LAT, 0);
      now += r() * 5;
      expect(c.resume(now)).toBeCloseTo(played, 9);
    }
  });

  it('ignores small latency wobbles, follows a real change, and never steps back', () => {
    const c = new MusicClock();
    c.play(0, 0, 240);
    expect(c.songTime(10, 0.04, 0)).toBeCloseTo(9.96, 9);
    expect(c.songTime(10, 0.04 + LATENCY_DEADBAND * 0.9, 0)).toBeCloseTo(9.96, 9);
    // Headphones connected: the player now hears everything 150 ms later. Song time holds until it catches up.
    expect(c.songTime(10.05, 0.19, 0)).toBeCloseTo(9.96, 9);
    expect(c.songTime(10.2, 0.19, 0)).toBeCloseTo(10.01, 9);
  });

  it('does nothing when paused twice or resumed while playing', () => {
    const c = new MusicClock();
    expect(c.pause(1, LAT, 0)).toBeNull();
    expect(c.resume(1)).toBeNull();
    c.play(0, 0, 240);
    expect(c.resume(5)).toBeNull();
    expect(c.songTime(5, LAT, 0)).toBeCloseTo(5 - LAT, 9);
  });

  it('keeps counting past the end, so the drill sees the whole song heard; no source after the end', () => {
    const c = new MusicClock();
    c.play(0, 0, 10);
    expect(c.sounding(9.9)).toBe(true);
    expect(c.sounding(10)).toBe(false);
    expect(c.songTime(10, LAT, 0)).toBeLessThan(10);
    expect(c.songTime(10 + LAT, LAT, 0)).toBeCloseTo(10, 9);
    expect(c.songTime(12, LAT, 0)).toBeCloseTo(12 - LAT, 9);
    c.pause(12, LAT, 0);
    expect(c.resume(13)).toBeNull();
    expect(c.songTime(14, LAT, 0)).toBeCloseTo(13 - LAT, 9);
    expect(c.play(20, 10, 10)).toBeNull();
    expect(c.play(20, -5, 10)).toBe(0);
  });

  it('reads 0 again after stop', () => {
    const c = new MusicClock();
    c.play(0, 30, 240);
    c.songTime(5, LAT, 0);
    c.stop();
    expect(c.state).toBe('stopped');
    expect(c.songTime(9, LAT, 0)).toBe(0);
  });
});

describe('context clock smoothing', () => {
  /** Reads once a frame (±0.5 ms jitter) for `seconds`, returning the worst error after a 1 s warm-up. */
  function run(rate: number, block: number, seconds: number, fps = 144, seed = 1) {
    const card = soundCard(rate, block);
    const clock = new ContextClock();
    const r = rng(seed);
    let worst = 0;
    let rawWorst = 0;
    let prev = -Infinity;
    for (let perf = 0; perf < seconds; perf += 1 / fps + (r() - 0.5) * 0.001) {
      const ct = card.currentTime(perf);
      const t = clock.read(ct, perf);
      expect(t).toBeGreaterThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(ct);
      expect(t).toBeLessThanOrEqual(ct + MAX_LEAD);
      prev = t;
      if (perf > 1) {
        worst = Math.max(worst, Math.abs(t - card.truth(perf)));
        rawWorst = Math.max(rawWorst, Math.abs(ct - card.truth(perf)));
      }
    }
    return { worst, rawWorst };
  }

  it('fills in between 10 ms and 21 ms audio blocks to within 3 ms of the audio clock, at 60 and 144 Hz', () => {
    for (const block of [0.01, 1024 / 48000]) {
      for (const fps of [60, 144]) {
        const { worst, rawWorst } = run(1, block, 30, fps);
        expect(worst).toBeLessThan(0.003);
        expect(rawWorst).toBeGreaterThan(block * 0.8); // what reading currentTime directly would cost
      }
    }
  });

  it('stays locked to a sound card running 300 ppm fast or slow over 4 minutes', () => {
    for (const rate of [1 + 300e-6, 1 - 300e-6]) expect(run(rate, 0.01, 240, 144, 3).worst).toBeLessThan(0.002);
  });

  it('holds still through an audio stall, then locks back on', () => {
    const clock = new ContextClock();
    // Audio runs for 5 s, freezes for 2 s (device change), then carries on from where it froze.
    const truth = (p: number) => (p < 5 ? p : p < 7 ? 5 : p - 2);
    let prev = -Infinity;
    let worstAfter = 0;
    for (let perf = 0; perf < 10; perf += 1 / 144) {
      const ct = Math.floor(truth(perf) / 0.01) * 0.01;
      const t = clock.read(ct, perf);
      expect(t).toBeGreaterThanOrEqual(prev);
      expect(t).toBeLessThanOrEqual(ct + MAX_LEAD + 1e-9);
      prev = t;
      if (perf > 7.6) worstAfter = Math.max(worstAfter, Math.abs(t - truth(perf)));
    }
    expect(worstAfter).toBeLessThan(0.002);
  });
});

describe('a 4-minute song on a real-ish sound card', () => {
  it('keeps song time within 10 ms of the source position, across pauses, while frozen when paused', () => {
    const LAT = 0.045;
    const OFFSET = 0.03;
    const card = soundCard(1 + 200e-6, 1024 / 48000);
    const ctxClock = new ContextClock();
    const music = new MusicClock();
    const r = rng(11);
    const pauses = [37.3, 101.9, 102.4, 188.05]; // perf seconds; two close together
    // Truth: the source plays from `from` starting at context time `at`, on the card's real clock.
    let at = 0;
    let from = 0;
    let worst = 0;
    let frozen: number | null = null;
    let perf = 0.5;
    const now = () => ctxClock.read(card.currentTime(perf), perf);

    at = card.currentTime(perf) + START_LEAD;
    music.play(at, 0, 240);
    for (let heard = 0; heard < 240 - LAT; perf += 1 / 144 + (r() - 0.5) * 0.001) {
      if (pauses.length && perf >= pauses[0]) {
        pauses.shift();
        from = music.pause(now(), LAT, OFFSET)!;
        frozen = music.songTime(now(), LAT, OFFSET);
        perf += 1 + r() * 3; // menu open
        expect(music.songTime(now(), LAT, OFFSET)).toBe(frozen);
        at = card.currentTime(perf) + START_LEAD;
        expect(music.resume(at)).toBeCloseTo(from, 9);
        continue;
      }
      const st = music.songTime(now(), LAT, OFFSET);
      if (frozen !== null) expect(st).toBeGreaterThanOrEqual(frozen);
      heard = from + Math.max(0, card.truth(perf) - at) - LAT - OFFSET;
      worst = Math.max(worst, Math.abs(st - heard));
    }
    expect(pauses).toHaveLength(0);
    expect(worst).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------- Audio wiring, on a fake AudioContext

class FakeParam {
  value = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
}

class FakeNode {
  readonly out: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: [number, number] | null = null;
  stoppedAt: number | null = null;
  start(when: number, offset = 0): void {
    this.started = [when, offset];
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  started = false;
  start(): void {
    this.started = true;
  }
  stop(): void {}
}

class FakeContext {
  static last: FakeContext;
  currentTime = 0;
  state = 'running';
  sampleRate = 48000;
  outputLatency: number | undefined = 0.04;
  baseLatency = 0.01;
  suspends = 0;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  constructor() {
    FakeContext.last = this;
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 299 } as AudioBuffer);
  }
  suspend(): Promise<void> {
    this.suspends++;
    return Promise.resolve();
  }
}

describe('Audio music, on a fake AudioContext', () => {
  let perfMs = 0;
  let audio: Audio;
  let ctx: FakeContext;
  const song = (duration: number) => ({ duration }) as AudioBuffer;
  /** Move the audio clock and performance.now() on together. */
  const advance = (s: number) => {
    ctx.currentTime += s;
    perfMs += s * 1000;
  };
  /** The node a source or oscillator ends up in, following the first connection of each node. */
  const chain = (n: FakeNode): FakeNode[] => (n.out[0] ? [n.out[0], ...chain(n.out[0])] : []);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('window', { AudioContext: FakeContext });
    vi.spyOn(performance, 'now').mockImplementation(() => perfMs);
    audio = new Audio();
    audio.unlock();
    ctx = FakeContext.last;
    advance(5);
  });

  afterEach(() => {
    audio.stopMusic();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('plays through a music gain under master, starting on a scheduled context time', () => {
    expect(audio.playMusic(song(240), 30)).toBe(true);
    const src = ctx.sources.at(-1)!;
    expect(src.started).toEqual([5 + START_LEAD, 30]);
    const [music, master, out] = chain(src);
    expect(out).toBe(ctx.destination);
    expect((music as FakeGain).gain.value).toBeCloseTo(0.4, 9);
    expect((master as FakeGain).gain.value).toBeCloseTo(0.6, 9);
    audio.setMusicVolume(0.25);
    expect((music as FakeGain).gain.value).toBe(0.25);
    advance(START_LEAD + 10);
    expect(audio.songTime()).toBeCloseTo(40 - 0.04, 6);
  });

  it('pauses by stopping the source, not the context, so menu sounds still play', () => {
    audio.playMusic(song(240), 30);
    const src = ctx.sources.at(-1)!;
    advance(START_LEAD + 10);
    audio.pauseMusic();
    expect(audio.musicState).toBe('paused');
    expect(src.stoppedAt).toBeCloseTo(ctx.currentTime, 6);
    expect(ctx.suspends).toBe(0);
    expect(ctx.state).toBe('running');
    const frozen = audio.songTime();
    advance(30);
    expect(audio.songTime()).toBe(frozen);
    audio.ui();
    const click = ctx.oscillators.at(-1)!;
    expect(click.started).toBe(true);
    expect(chain(click).at(-1)).toBe(ctx.destination);
  });

  it('resumes on a new source from the remembered position; the old source ending later changes nothing', () => {
    audio.playMusic(song(240), 30);
    const first = ctx.sources.at(-1)!;
    advance(START_LEAD + 10);
    audio.pauseMusic();
    const frozen = audio.songTime();
    advance(30);
    audio.resumeMusic();
    const second = ctx.sources.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.started![0]).toBeCloseTo(ctx.currentTime + START_LEAD, 9);
    expect(second.started![1]).toBeCloseTo(40, 6);
    expect(audio.songTime()).toBeCloseTo(frozen, 9);
    first.onended!();
    advance(START_LEAD + 2);
    expect(audio.songTime()).toBeCloseTo(frozen + 2, 6);
    audio.pauseMusic();
    expect(second.stoppedAt).not.toBeNull();
  });

  it('falls back to baseLatency without outputLatency, and applies the audio offset', () => {
    ctx.outputLatency = undefined;
    audio.audioOffsetMs = 50;
    audio.playMusic(song(240));
    advance(START_LEAD + 1);
    expect(audio.songTime()).toBeCloseTo(1 - 0.01 - 0.05, 6);
  });

  it('stops the old source when a new song starts, and reads 0 after stopMusic', () => {
    audio.playMusic(song(240));
    const first = ctx.sources.at(-1)!;
    audio.playMusic(song(180));
    expect(first.stoppedAt).not.toBeNull();
    const second = ctx.sources.at(-1)!;
    audio.stopMusic();
    expect(second.stoppedAt).not.toBeNull();
    expect(audio.musicState).toBe('stopped');
    expect(audio.songTime()).toBe(0);
    audio.resumeMusic();
    expect(ctx.sources.at(-1)).toBe(second);
  });

  it('dev console hook: asks for a click before audio is unlocked, then fetches, decodes and plays', async () => {
    type Hook = ((url: string) => Promise<boolean>) & { stop: () => void };
    const fresh = new Audio();
    const hook = (window as unknown as { __music: Hook }).__music;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await hook('/song.mp3')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    fresh.unlock();
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }));
    expect(await hook('/song.mp3')).toBe(true);
    expect(fresh.musicState).toBe('playing');
    hook.stop();
    expect(fresh.musicState).toBe('stopped');
  });

  it('reports the end once the whole song has been heard', () => {
    audio.playMusic(song(10));
    advance(START_LEAD + 10);
    expect(audio.musicEnded()).toBe(false);
    advance(0.05);
    expect(audio.musicEnded()).toBe(true);
  });
});
