/**
 * Tiny WebAudio synth — every sound is generated, nothing is sampled.
 * Hit feedback is the most important audio cue in an aim trainer, so it is crisp and distinct.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;

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
}
