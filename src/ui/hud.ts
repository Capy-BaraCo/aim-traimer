import type { CrosshairSettings } from '../core/store';

export interface HudStat {
  k: string;
  v: string;
  tone?: 'good' | 'bad' | '';
}

interface ScopeSample {
  t: number;
  yaw: number;
  pitch: number;
  r: number;
  on: boolean;
}

const SCOPE_WINDOW = 3.2;
const SCOPE_RANGE = 5;

/** Keep Greek sample letters (α/β) as italic serif glyphs even inside uppercase text. */
export const greek = (s: string): string => s.replace(/[αβ]/g, (m) => `<span class="gk">${m}</span>`);

export function crosshairSvg(c: CrosshairSettings, scale = 1): string {
  const s = 64;
  const m = s / 2;
  const L = c.length * scale;
  const T = c.thickness * scale;
  const G = c.gap * scale;
  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="butt"/>`;
  const cross = (stroke: string, w: number, ext: number) => {
    parts.push(line(m, m - G - L - ext, m, m - G + ext, stroke, w));
    parts.push(line(m, m + G - ext, m, m + G + L + ext, stroke, w));
    parts.push(line(m - G - L - ext, m, m - G + ext, m, stroke, w));
    parts.push(line(m + G - ext, m, m + G + L + ext, m, stroke, w));
  };
  const dot = (fill: string, r: number) => parts.push(`<circle cx="${m}" cy="${m}" r="${r}" fill="${fill}"/>`);
  const ring = (stroke: string, w: number) =>
    parts.push(`<circle cx="${m}" cy="${m}" r="${G + L / 2}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`);
  const ol = 'rgba(8,7,6,0.9)';
  if (c.outline) {
    if (c.style === 'cross' || c.style === 'crossdot') cross(ol, T + 2, 1);
    if (c.style === 'dot' || c.style === 'crossdot') dot(ol, T + 1);
    if (c.style === 'circle') ring(ol, T + 2);
  }
  if (c.style === 'cross' || c.style === 'crossdot') cross(c.color, T, 0);
  if (c.style === 'dot' || c.style === 'crossdot') dot(c.color, T);
  if (c.style === 'circle') {
    ring(c.color, T);
    dot(c.color, Math.max(1, T * 0.6));
  }
  return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" shape-rendering="crispEdges">${parts.join('')}</svg>`;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly hitmarker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly timerBar: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly center: HTMLElement;
  private readonly sample: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly scopeWrap: HTMLElement;
  private readonly scope: HTMLCanvasElement;
  private readonly sg: CanvasRenderingContext2D;
  private readonly legend: HTMLElement;
  private readonly toast: HTMLElement;
  private samples: ScopeSample[] = [];
  private lastRail = '';
  private lastTimer = '';
  private fpsAcc = 0;
  private fpsFrames = 0;
  private hitTimer = 0;
  private toastTimer = 0;
  private scopeEnabled = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-crosshair"></div>
      <div class="hud-hit"><svg viewBox="0 0 64 64" width="64" height="64">
        <g stroke-width="2.4" stroke-linecap="square">
          <line x1="20" y1="20" x2="26" y2="26"/><line x1="44" y1="20" x2="38" y2="26"/>
          <line x1="20" y1="44" x2="26" y2="38"/><line x1="44" y1="44" x2="38" y2="38"/>
        </g></svg></div>
      <header class="hud-tl">
        <div class="hud-kicker"></div>
        <div class="hud-title"></div>
        <div class="hud-phase"></div>
      </header>
      <div class="hud-tr">
        <div class="hud-timer">00.0</div>
        <div class="hud-timer-track"><div class="hud-timer-bar"></div></div>
      </div>
      <aside class="hud-rail"></aside>
      <div class="hud-scope">
        <canvas></canvas>
        <div class="hud-scope-legend"><span class="lg-yaw">ΔYAW</span><span class="lg-pitch">ΔPITCH</span><span class="lg-scale">±${SCOPE_RANGE}°</span></div>
      </div>
      <div class="hud-center"></div>
      <div class="hud-sample"></div>
      <div class="hud-toast"></div>
      <div class="hud-keys"><span><b>WASD</b> move</span><span><b>SPACE</b> jump</span><span><b>C/SHIFT</b> crouch</span><span><b>ESC</b> pause</span></div>
      <div class="hud-fps"></div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.crosshair = q('.hud-crosshair');
    this.hitmarker = q('.hud-hit');
    this.title = q('.hud-title');
    this.kicker = q('.hud-kicker');
    this.phase = q('.hud-phase');
    this.timer = q('.hud-timer');
    this.timerBar = q('.hud-timer-bar');
    this.rail = q('.hud-rail');
    this.center = q('.hud-center');
    this.sample = q('.hud-sample');
    this.fps = q('.hud-fps');
    this.scopeWrap = q('.hud-scope');
    this.scope = q('.hud-scope canvas');
    this.legend = q('.hud-scope-legend');
    this.toast = q('.hud-toast');
    this.sg = this.scope.getContext('2d')!;
    this.resizeScope();
    window.addEventListener('resize', () => this.resizeScope());
  }

  private resizeScope(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 300;
    const h = 120;
    this.scope.width = w * dpr;
    this.scope.height = h * dpr;
    this.scope.style.width = `${w}px`;
    this.scope.style.height = `${h}px`;
    this.sg.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  setCrosshair(c: CrosshairSettings): void {
    this.crosshair.innerHTML = crosshairSvg(c);
    this.hitmarker.style.setProperty('--hit', c.color);
  }

  setHeader(kicker: string, title: string): void {
    this.kicker.textContent = kicker;
    this.title.innerHTML = greek(title.replace(/[<>&]/g, ''));
  }

  setPhase(text: string): void {
    if (this.phase.textContent !== text) this.phase.textContent = text;
  }

  setTimer(remaining: number, total: number): void {
    const txt = Number.isFinite(remaining) ? Math.max(0, remaining).toFixed(1).padStart(4, '0') : '∞';
    if (txt !== this.lastTimer) {
      this.timer.textContent = txt;
      this.lastTimer = txt;
    }
    const f = Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 1;
    this.timerBar.style.transform = `scaleX(${f})`;
  }

  setStats(stats: HudStat[]): void {
    const key = stats.map((s) => `${s.k}${s.v}${s.tone ?? ''}`).join('|');
    if (key === this.lastRail) return;
    this.lastRail = key;
    this.rail.innerHTML = stats
      .map((s) => `<div class="cell ${s.tone ?? ''}"><span class="k">${s.k}</span><span class="v">${s.v}</span></div>`)
      .join('');
  }

  setSample(label: string, kind: 'alpha' | 'beta' | ''): void {
    this.sample.className = `hud-sample ${kind}`;
    this.sample.innerHTML = label;
  }

  message(html: string, sticky = false): void {
    this.center.innerHTML = html;
    this.center.classList.toggle('on', html !== '');
    this.center.classList.toggle('sticky', sticky);
  }

  flashToast(text: string, kind = ''): void {
    this.toast.textContent = text;
    this.toast.className = `hud-toast on ${kind}`;
    this.toastTimer = 0.7;
  }

  hit(head: boolean, kill: boolean): void {
    this.hitmarker.classList.remove('on', 'head', 'kill');
    void this.hitmarker.offsetWidth; // restart the CSS animation
    this.hitmarker.classList.add('on');
    if (head) this.hitmarker.classList.add('head');
    if (kill) this.hitmarker.classList.add('kill');
    this.hitTimer = kill ? 0.3 : 0.16;
  }

  setScopeEnabled(on: boolean): void {
    this.scopeEnabled = on;
    this.scopeWrap.classList.toggle('off', !on);
  }

  resetScope(): void {
    this.samples = [];
  }

  pushScope(t: number, yaw: number, pitch: number, r: number, on: boolean): void {
    this.samples.push({ t, yaw, pitch, r, on });
    while (this.samples.length && this.samples[0].t < t - SCOPE_WINDOW) this.samples.shift();
  }

  scopeIdle(): void {
    this.legend.classList.add('idle');
  }

  frame(dt: number, now: number, realDt = dt): void {
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('on', 'head', 'kill');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('on');
    }
    if (this.scopeEnabled && this.root.classList.contains('on')) this.drawScope(now);
  }

  showFps(on: boolean): void {
    this.fps.style.display = on ? '' : 'none';
  }

  private drawScope(now: number): void {
    const g = this.sg;
    const W = 300;
    const H = 120;
    g.clearRect(0, 0, W, H);
    const midY = H / 2;
    const yOf = (deg: number) => midY - (Math.max(-SCOPE_RANGE, Math.min(SCOPE_RANGE, deg)) / SCOPE_RANGE) * (H / 2 - 8);
    const xOf = (t: number) => W - ((now - t) / SCOPE_WINDOW) * W;

    // Grid
    g.strokeStyle = 'rgba(233,225,210,0.08)';
    g.lineWidth = 1;
    for (let d = -SCOPE_RANGE; d <= SCOPE_RANGE; d++) {
      const y = Math.round(yOf(d)) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    for (let s = 0; s <= SCOPE_WINDOW; s += 0.5) {
      const x = Math.round(W - (s / SCOPE_WINDOW) * W) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    const S = this.samples;
    if (S.length < 2) return;

    // Target band (± angular radius of what you're tracking)
    g.fillStyle = 'rgba(255,75,31,0.12)';
    g.beginPath();
    g.moveTo(xOf(S[0].t), yOf(S[0].r));
    for (const s of S) g.lineTo(xOf(s.t), yOf(s.r));
    for (let i = S.length - 1; i >= 0; i--) g.lineTo(xOf(S[i].t), yOf(-S[i].r));
    g.closePath();
    g.fill();

    // On-target ribbon along the bottom
    g.fillStyle = '#ff4b1f';
    for (let i = 1; i < S.length; i++) {
      if (!S[i].on) continue;
      const x0 = xOf(S[i - 1].t);
      const x1 = xOf(S[i].t);
      g.fillRect(x0, H - 4, Math.max(1, x1 - x0 + 0.5), 4);
    }

    const trace = (key: 'yaw' | 'pitch', color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      S.forEach((s, i) => (i ? g.lineTo(xOf(s.t), yOf(s[key])) : g.moveTo(xOf(s.t), yOf(s[key]))));
      g.stroke();
    };
    trace('pitch', 'rgba(120,138,255,0.9)', 1.2);
    trace('yaw', '#f2eadb', 1.6);
    this.legend.classList.remove('idle');
  }
}
