/**
 * Tiny WebAudio synth — every sound is generated, nothing is sampled.
 * Hit feedback is the most important audio cue in an aim trainer, so it is crisp and distinct.
 *
 * Target sounds are positional: they play from where the target is in the world, through an HRTF
 * panner (the same idea as game "3D audio" for headphones). The listener follows the camera every
 * frame, so a sound behind you stays behind you while you turn.
 *
 * Music (Overdrive) is the one thing that is not synthesised: the player's own song, played on the
 * AudioContext clock, with song time read from that clock (see music-clock.ts).
 */

import { ContextClock, MusicClock, outputLatencyOf, START_LEAD, type MusicState } from './music-clock';

/** Music level under the master volume. A mastered song at full scale would bury the hit sounds. */
const MUSIC_LEVEL = 0.4;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a point is relative to a listener: azimuth 0 = straight ahead, +90 = right, ±180 = behind;
 * elevation + = above. Degrees and metres.
 */
export function relativeDirection(pos: Vec3, fwd: Vec3, up: Vec3, src: Vec3): { az: number; el: number; dist: number } {
  const dx = src.x - pos.x;
  const dy = src.y - pos.y;
  const dz = src.z - pos.z;
  // right = forward × up
  let rx = fwd.y * up.z - fwd.z * up.y;
  let ry = fwd.z * up.x - fwd.x * up.z;
  let rz = fwd.x * up.y - fwd.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const x = dx * rx + dy * ry + dz * rz;
  const y = dx * up.x + dy * up.y + dz * up.z;
  const z = dx * fwd.x + dy * fwd.y + dz * fwd.z;
  const deg = 180 / Math.PI;
  return { az: Math.atan2(x, z) * deg, el: Math.atan2(y, Math.hypot(x, z)) * deg, dist: Math.hypot(dx, dy, dz) };
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  /** HRTF (headphones) when true, plain stereo panning (speakers) when false. */
  spatial = true;
  /** How late the player hears the audio, in ms. Subtracted in song time: positive makes targets arrive later. */
  audioOffsetMs = 0;
  private readonly lis = { pos: { x: 0, y: 1.6, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
  private music: GainNode | null = null;
  private musicLevel = MUSIC_LEVEL;
  private musicBuffer: AudioBuffer | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private readonly musicClock = new MusicClock();
  private readonly ctxClock = new ContextClock();
  private stopDriftLog: (() => void) | null = null;

  constructor() {
    if (import.meta.env.DEV && typeof window !== 'undefined') exposeMusicHook(this, () => this.ctx);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = this.musicLevel;
      this.music.connect(this.master);
      const len = this.ctx.sampleRate * 0.4;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shot(auto: boolean): void {
    this.burst(auto ? 0.07 : 0.12, auto ? 2400 : 1600, 0.9, auto ? 0.16 : 0.24);
    this.tone(auto ? 180 : 120, auto ? 0.05 : 0.09, 'sine', auto ? 0.12 : 0.2, 0, 60);
  }

  hit(head: boolean): void {
    if (head) {
      this.tone(2350, 0.07, 'triangle', 0.22);
      this.tone(3520, 0.09, 'sine', 0.12, 0.012);
    } else {
      this.tone(1760, 0.045, 'triangle', 0.16);
    }
  }

  kill(): void {
    this.tone(880, 0.12, 'triangle', 0.16);
    this.tone(1318.5, 0.14, 'triangle', 0.14, 0.05);
    this.tone(1760, 0.22, 'sine', 0.12, 0.1);
  }

  miss(): void {
    this.tone(220, 0.05, 'sine', 0.05);
  }

  tick(): void {
    this.tone(1200, 0.03, 'square', 0.04);
  }

  go(): void {
    this.tone(660, 0.1, 'triangle', 0.14);
    this.tone(990, 0.16, 'triangle', 0.14, 0.08);
  }

  ui(): void {
    this.tone(1500, 0.025, 'sine', 0.05);
  }

  land(): void {
    this.burst(0.06, 500, 0.7, 0.06);
  }

  // ---------------------------------------------------------------- positional

  /** Keep the listener on the camera. Cheap; call every frame. */
  listen(pos: Vec3, fwd: Vec3, up: Vec3): void {
    Object.assign(this.lis.pos, pos);
    Object.assign(this.lis.fwd, fwd);
    Object.assign(this.lis.up, up);
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Direction of a world point from the listener (see relativeDirection). */
  directionOf(at: Vec3): { az: number; el: number; dist: number } {
    return relativeDirection(this.lis.pos, this.lis.fwd, this.lis.up, at);
  }

  /** A world point `dist` metres away at azimuth `az` (0 ahead, 90 right, 180 behind), ear height. */
  pointAround(az: number, dist = 6): Vec3 {
    const { pos, fwd, up } = this.lis;
    const a = (az * Math.PI) / 180;
    const rx = fwd.y * up.z - fwd.z * up.y;
    const rz = fwd.x * up.y - fwd.y * up.x;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const rl = Math.hypot(rx, rz) || 1;
    return {
      x: pos.x + dist * (Math.cos(a) * (fwd.x / fl) + Math.sin(a) * (rx / rl)),
      y: pos.y,
      z: pos.z + dist * (Math.cos(a) * (fwd.z / fl) + Math.sin(a) * (rz / rl)),
    };
  }

  /**
   * Input node that plays from `at`. Behind you, a low-pass takes the air off the sound: real ears
   * hear sounds from behind as duller, and WebAudio's generic HRTF renders front/back only weakly.
   */
  private from(at: Vec3): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const d = this.directionOf(at);
    const behind = Math.max(0, (Math.abs(d.az) - 90) / 90); // 0 at the sides, 1 straight behind
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 16000 * Math.pow(2400 / 16000, behind);
    tone.Q.value = 0.5;
    if (this.spatial && typeof ctx.createPanner === 'function') {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 5;
      p.rolloffFactor = 0.35;
      p.maxDistance = 120;
      if (p.positionX) {
        p.positionX.value = at.x;
        p.positionY.value = at.y;
        p.positionZ.value = at.z;
      } else p.setPosition(at.x, at.y, at.z);
      tone.connect(p).connect(this.master);
    } else {
      const sp = ctx.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, Math.sin((d.az * Math.PI) / 180)));
      const g = ctx.createGain();
      g.gain.value = 1 - behind * 0.25;
      tone.connect(g).connect(sp).connect(this.master);
    }
    return tone;
  }

  private spatialBurst(out: AudioNode, when: number, dur: number, freq: number, q: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private spatialTone(out: AudioNode, when: number, freq: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A target appeared at `at`: a sharp, wide-band "tk-ting" that is easy to place by ear. */
  spawn(at: Vec3): void {
    const out = this.from(at);
    if (!out || !this.noise) return;
    this.spatialBurst(out, 0, 0.05, 4200, 0.7, 0.5);
    this.spatialBurst(out, 0.004, 0.09, 1500, 0.9, 0.32);
    this.spatialTone(out, 0.01, 1480, 1110, 0.16, 0.16);
  }

  /** The target is still out there: a soft footstep-like tick. */
  beacon(at: Vec3): void {
    const out = this.from(at);
    if (!out || !this.noise) return;
    this.spatialBurst(out, 0, 0.045, 2600, 0.8, 0.3);
    this.spatialBurst(out, 0.002, 0.07, 420, 1.2, 0.34);
  }

  // ---------------------------------------------------------------- music

  /** Music level under the master volume, 0–1. */
  setMusicVolume(v: number): void {
    this.musicLevel = v;
    if (this.music) this.music.gain.value = v;
  }

  /** Start a song `fromSec` seconds in, replacing any song already loaded. False if audio isn't unlocked yet. */
  playMusic(buffer: AudioBuffer, fromSec = 0): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.music) return false;
    this.stopMusic();
    this.musicBuffer = buffer;
    const at = ctx.currentTime + START_LEAD;
    const offset = this.musicClock.play(at, fromSec, buffer.duration);
    if (offset !== null) this.startSource(at, offset);
    if (import.meta.env.DEV) this.stopDriftLog = startDriftLog(ctx, this.musicClock, () => this.songTime(), () => this.audioOffsetMs / 1000);
    return true;
  }

  /**
   * Stop the song where it is and freeze song time. Only the music stops: the AudioContext keeps
   * running, so menu and hit sounds still play. Does nothing unless a song is playing.
   */
  pauseMusic(): void {
    if (this.musicClock.state !== 'playing') return;
    const now = this.contextNow();
    this.musicClock.pause(now, this.latency(), this.audioOffsetMs / 1000);
    this.musicSource?.stop(now);
    this.musicSource = null;
  }

  /** Carry on from where pauseMusic stopped, with song time picking up exactly where it froze. Does nothing unless paused. */
  resumeMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicClock.state !== 'paused') return;
    const at = ctx.currentTime + START_LEAD;
    const offset = this.musicClock.resume(at);
    if (offset !== null) this.startSource(at, offset);
  }

  /** Stop the song and forget it; song time reads 0. Safe to call at any time. */
  stopMusic(): void {
    this.stopDriftLog?.();
    this.stopDriftLog = null;
    this.musicSource?.stop();
    this.musicSource = null;
    this.musicBuffer = null;
    this.musicClock.stop();
  }

  /**
   * Song time: seconds into the song as the player hears it, read from the audio clock at this instant
   * (call it inside onShot for the click instant). Frozen while paused, 0 with no song, never steps back
   * during a song, and keeps counting past the end.
   */
  songTime(): number {
    return this.musicClock.songTime(this.contextNow(), this.latency(), this.audioOffsetMs / 1000);
  }

  /** 'stopped' (no song), 'playing' (including the moments after the end) or 'paused'. */
  get musicState(): MusicState {
    return this.musicClock.state;
  }

  /** True once the player has heard the whole song. */
  musicEnded(): boolean {
    return this.musicClock.state !== 'stopped' && this.songTime() >= this.musicClock.duration;
  }

  /** Context time now, smoothed between audio blocks (see ContextClock). */
  private contextNow(): number {
    return this.ctx ? this.ctxClock.read(this.ctx.currentTime, performance.now() / 1000) : 0;
  }

  private latency(): number {
    return this.ctx ? outputLatencyOf(this.ctx) : 0;
  }

  private startSource(at: number, offset: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.musicBuffer;
    src.connect(this.music!);
    // A stopped source still fires onended later, after a newer one may have started: only tidy up its own node.
    src.onended = () => {
      src.disconnect();
      if (this.musicSource === src) this.musicSource = null;
    };
    src.start(at, offset);
    this.musicSource = src;
  }
}

/**
 * Dev builds only. Every 5 s while a song plays, log how far song time has drifted from the song as
 * the browser says it is being heard: getOutputTimestamp() pairs a context time with the moment it
 * reaches the speakers, stamped by the audio thread, so it doesn't share song time's currentTime and
 * performance.now() readings. The first sample is the baseline (its constant part is latency
 * bookkeeping that the audio offset calibrates away); what follows is drift.
 */
function startDriftLog(ctx: AudioContext, clock: MusicClock, songTime: () => number, offsetSec: () => number): () => void {
  let base: number | null = null;
  let worst = 0;
  const id = setInterval(() => {
    if (typeof ctx.getOutputTimestamp !== 'function') return;
    const st = songTime();
    const ts = ctx.getOutputTimestamp();
    if (!ts.contextTime || !ts.performanceTime) return;
    const heardAt = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    if (!clock.sounding(heardAt)) return;
    const gap = st - (clock.position(heardAt) - offsetSec());
    base ??= gap;
    const drift = (gap - base) * 1000;
    worst = Math.max(worst, Math.abs(drift));
    console.debug(
      `[music] ${clock.position(heardAt).toFixed(1)} s · drift ${drift.toFixed(1)} ms (worst ${worst.toFixed(1)}) · latency ${(outputLatencyOf(ctx) * 1000).toFixed(1)} ms · gap ${(gap * 1000).toFixed(1)} ms`,
    );
  }, 5000);
  return () => clearInterval(id);
}

/**
 * Dev builds only: play a song from the browser console to check the music clock before Overdrive
 * exists. `await __music('/some-song.mp3')` fetches, decodes and plays it (the drift log runs while it
 * plays); then `__music.pause()`, `.resume()`, `.stop()` and `.time()` (song time).
 */
function exposeMusicHook(a: Audio, context: () => AudioContext | null): void {
  const music = async (url: string, fromSec = 0): Promise<boolean> => {
    const ctx = context();
    if (!ctx) {
      console.warn('[music] Click anywhere in the page first: browsers only start audio after a click.');
      return false;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[music] ${url}: HTTP ${res.status}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    console.info(`[music] Playing ${buffer.duration.toFixed(1)} s from ${fromSec} s. Drift log every 5 s (console level: Verbose).`);
    return a.playMusic(buffer, fromSec);
  };
  (window as unknown as { __music: unknown }).__music = Object.assign(music, {
    pause: () => a.pauseMusic(),
    resume: () => a.resumeMusic(),
    stop: () => a.stopMusic(),
    time: () => a.songTime(),
  });
}
