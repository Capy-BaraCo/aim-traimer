/**
 * Tiny WebAudio synth — every sound is generated, nothing is sampled.
 * Hit feedback is the most important audio cue in an aim trainer, so it is crisp and distinct.
 *
 * Target sounds are positional: they play from where the target is in the world, through an HRTF
 * panner (the same idea as game "3D audio" for headphones). The listener follows the camera every
 * frame, so a sound behind you stays behind you while you turn.
 */

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
  private readonly lis = { pos: { x: 0, y: 1.6, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };

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
}
