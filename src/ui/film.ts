/**
 * The film room: a guided, animated replay of one of your flicks next to the right way to do it.
 * Opens on top of whatever you were looking at (debrief, Logbook, manual) and returns to it.
 */

import type { DirSector, FlickRecord } from '../core/analytics';
import type { DrillId } from '../core/coach';
import { verticalFovFromOw } from '../core/sens';
import { store } from '../core/store';
import { drillDef } from '../drills/registry';
import { buildLesson, demoLesson, examplesFor, type Lesson, type LessonKind } from '../film/lessons';
import { drawMap, drawScreen, drawTimeline, type Frame } from '../film/render';
import type { App } from './app';
import { esc, h } from './dom';

export interface FilmSource {
  kind: LessonKind;
  /** Your flicks to pick an example from. Omit to use a built-in example. */
  records?: readonly FlickRecord[];
  dir?: DirSector;
  /** "From this Snap run" … */
  source: string;
  tip?: string;
  drill?: DrillId;
  /** What "Practise" does (the film closes first). */
  onPractise?: (drill: DrillId) => void;
}

/** True when there is something to replay for this lesson. */
export function canFilm(kind: LessonKind | null, records?: readonly FlickRecord[], dir?: DirSector): kind is LessonKind {
  return !!kind && (!records || examplesFor(records, kind, dir).length > 0);
}

interface Prefs {
  auto: boolean;
  voice: boolean;
  slow: boolean;
}

const PREFS_KEY = 'azimuth.film';

function loadPrefs(): Prefs {
  try {
    return { auto: false, voice: false, slow: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { auto: false, voice: false, slow: false };
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: prefs just won't stick.
  }
}

/** Seconds to linger on a finished beat before looping it (or moving on). */
const HOLD = 1.3;

export class FilmRoom {
  readonly el: HTMLElement;
  private lesson: Lesson;
  private readonly examples: FlickRecord[];
  private exIdx = 0;
  private beatIdx = 0;
  private t = 0;
  private hold = 0;
  private playing = true;
  private spoken = true;
  private readonly prefs = loadPrefs();
  private raf = 0;
  private last = performance.now();
  private readonly cv: { el: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number }[] = [];

  constructor(
    private readonly app: App,
    private readonly src: FilmSource,
  ) {
    this.examples = src.records ? examplesFor(src.records, src.kind, src.dir) : [];
    this.lesson = this.build();
    this.el = h(`
      <div class="film-layer" role="dialog" aria-modal="true" aria-label="Film room">
        <div class="film">
          <aside class="film-side">
            <div class="film-kicker"><i class="rec"></i>Film room · <span data-f="src"></span></div>
            <h3 class="film-title" data-f="title"></h3>
            <div class="film-beat" aria-live="polite">
              <div class="film-beat-n" data-f="n"></div>
              <h4 data-f="bt"></h4>
              <p data-f="bx"></p>
            </div>
            <div class="film-nav">
              <button class="btn ghost small" data-act="prev" aria-label="Previous beat">←</button>
              <button class="btn" data-act="next">Next <span class="arr">→</span></button>
            </div>
            <ol class="film-beats" data-f="beats"></ol>
            <div class="film-try">
              <div class="kicker plain">Try this</div>
              <p data-f="tip"></p>
              <button class="btn small" data-act="practise"></button>
            </div>
          </aside>
          <section class="film-main">
            <header class="film-bar">
              <div class="film-keys"><span class="kbd">SPACE</span> pause · <span class="kbd">←</span> <span class="kbd">→</span> beats · <span class="kbd">R</span> replay · <span class="kbd">ESC</span> close</div>
              <button class="film-x" data-act="close" aria-label="Close film room">✕</button>
            </header>
            <div class="film-stage">
              <figure class="film-fig ff-fpv"><canvas role="img"></canvas><figcaption>Your screen — the replay, slowed down</figcaption></figure>
              <figure class="film-fig ff-path"><canvas role="img"></canvas><figcaption>Your crosshair's path — start on the left, target on the right</figcaption></figure>
            </div>
            <figure class="film-fig ff-time"><canvas role="img" aria-label="Timeline: speed and phases"></canvas></figure>
            <div class="film-controls">
              <button class="fc" data-act="play"></button>
              <button class="fc" data-act="replay">↻ Replay beat</button>
              <button class="fc" data-act="slow"></button>
              <label class="fc-toggle"><input type="checkbox" data-opt="auto"> Auto-advance</label>
              <label class="fc-toggle"><input type="checkbox" data-opt="voice"> Read aloud</label>
              <button class="fc" data-act="another">Another example</button>
              <span class="fc-note" data-f="ex"></span>
            </div>
          </section>
        </div>
      </div>`);
    for (const c of this.el.querySelectorAll('canvas')) this.cv.push({ el: c, g: c.getContext('2d')!, w: 0, h: 0 });
    (this.el.querySelector('[data-opt="auto"]') as HTMLInputElement).checked = this.prefs.auto;
    (this.el.querySelector('[data-opt="voice"]') as HTMLInputElement).checked = this.prefs.voice;
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('change', this.onChange);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.resize);
    app.ui.appendChild(this.el);
    app.film = this;
    this.renderLesson();
    this.goto(0);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): Lesson {
    const { sens, dpi } = store.settings;
    const ex = this.examples[this.exIdx];
    const built = ex ? buildLesson(this.src.kind, ex, { sens, dpi, source: this.src.source, tip: this.src.tip, drill: this.src.drill }) : null;
    return built ?? demoLesson(this.src.kind, sens, dpi);
  }

  private get beat() {
    return this.lesson.beats[this.beatIdx];
  }

  private q(f: string): HTMLElement {
    return this.el.querySelector(`[data-f="${f}"]`) as HTMLElement;
  }

  private renderLesson(): void {
    const l = this.lesson;
    this.q('src').textContent = l.source;
    this.q('title').textContent = l.title;
    this.q('tip').textContent = l.tip;
    const def = drillDef(l.drill);
    (this.el.querySelector('[data-act="practise"]') as HTMLElement).innerHTML = `Practise in ${esc(def?.name ?? l.drill)} <span class="arr">→</span>`;
    this.q('beats').innerHTML = l.beats.map((b, i) => `<li><button data-act="beat" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(b.title)}</button></li>`).join('');
    const another = this.el.querySelector('[data-act="another"]') as HTMLButtonElement;
    another.hidden = this.examples.length < 2;
    this.q('ex').textContent = this.examples.length ? `Your flick · example ${this.exIdx + 1} of ${this.examples.length}` : 'Built-in example';
  }

  goto(i: number): void {
    this.beatIdx = Math.max(0, Math.min(this.lesson.beats.length - 1, i));
    const b = this.beat;
    this.t = b.from;
    this.hold = 0;
    this.playing = true;
    this.q('n').textContent = `${String(this.beatIdx + 1).padStart(2, '0')} / ${String(this.lesson.beats.length).padStart(2, '0')}`;
    this.q('bt').textContent = b.title;
    this.q('bx').textContent = b.text;
    this.el.querySelectorAll('.film-beats button').forEach((x, k) => x.classList.toggle('on', k === this.beatIdx));
    this.el.querySelector('[data-act="next"]')!.classList.remove('ready');
    (this.el.querySelector('[data-act="next"]') as HTMLButtonElement).disabled = this.beatIdx >= this.lesson.beats.length - 1;
    const [screen, map] = this.cv;
    screen.el.setAttribute('aria-label', `Replay of your screen. ${b.title}: ${b.text}`);
    map.el.setAttribute('aria-label', "Your crosshair's path from the start to the target");
    this.syncControls();
    this.speak();
  }

  /** Jump into a beat at a fraction of its window (automation and screenshots). */
  seek(beat: number, fraction: number): void {
    this.goto(beat);
    const b = this.beat;
    this.t = b.from + (b.to - b.from) * Math.min(1, Math.max(0, fraction));
    this.playing = false;
    this.syncControls();
    this.draw();
  }

  private syncControls(): void {
    (this.el.querySelector('[data-act="play"]') as HTMLElement).textContent = this.playing ? '❚❚ Pause' : '▶ Play';
    (this.el.querySelector('[data-act="slow"]') as HTMLElement).textContent = this.prefs.slow ? 'Slow-mo: on' : 'Slow-mo: off';
  }

  private speak(): void {
    const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    synth?.cancel();
    if (!this.prefs.voice || !synth) {
      this.spoken = true;
      return;
    }
    const b = this.beat;
    const u = new SpeechSynthesisUtterance(`${b.title}. ${b.text}`);
    const voices = synth.getVoices();
    const v = voices.find((x) => /en-GB/i.test(x.lang)) ?? voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = 1.03;
    this.spoken = false;
    u.onend = () => (this.spoken = true);
    u.onerror = () => (this.spoken = true);
    synth.speak(u);
  }

  private readonly resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of this.cv) {
      const r = c.el.getBoundingClientRect();
      c.w = Math.max(10, r.width);
      c.h = Math.max(10, r.height);
      c.el.width = Math.round(c.w * dpr);
      c.el.height = Math.round(c.h * dpr);
      c.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.draw();
  };

  private draw(): void {
    const b = this.beat;
    const fr: Frame = {
      lesson: this.lesson,
      beat: b,
      t: this.t,
      vfov: verticalFovFromOw(store.settings.fov),
      crosshair: store.settings.crosshair.color,
      rate: b.rate * (this.prefs.slow ? 0.5 : 1),
    };
    const [screen, map, timeline] = this.cv;
    drawScreen(screen.g, screen.w, screen.h, fr);
    drawMap(map.g, map.w, map.h, fr);
    drawTimeline(timeline.g, timeline.w, timeline.h, fr);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const b = this.beat;
    if (this.playing) {
      const rate = b.rate * (this.prefs.slow ? 0.5 : 1);
      if (this.t < b.to) this.t = Math.min(b.to, this.t + dt * 1000 * rate);
      else {
        this.el.querySelector('[data-act="next"]')!.classList.toggle('ready', this.beatIdx < this.lesson.beats.length - 1);
        this.hold += dt;
        if (this.hold > HOLD && this.spoken) {
          if (this.prefs.auto && this.beatIdx < this.lesson.beats.length - 1) this.goto(this.beatIdx + 1);
          else {
            this.t = b.from;
            this.hold = 0;
          }
        }
      }
    }
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || !this.el.contains(b)) return;
    switch (b.dataset.act) {
      case 'next':
        this.goto(this.beatIdx + 1);
        break;
      case 'prev':
        this.goto(this.beatIdx - 1);
        break;
      case 'beat':
        this.goto(Number(b.dataset.i));
        break;
      case 'play':
        this.playing = !this.playing;
        this.syncControls();
        break;
      case 'replay':
        this.goto(this.beatIdx);
        break;
      case 'slow':
        this.prefs.slow = !this.prefs.slow;
        savePrefs(this.prefs);
        this.syncControls();
        break;
      case 'another':
        this.exIdx = (this.exIdx + 1) % Math.max(1, this.examples.length);
        this.lesson = this.build();
        this.renderLesson();
        this.goto(this.beatIdx);
        break;
      case 'practise': {
        const drill = this.lesson.drill;
        this.close();
        this.src.onPractise?.(drill);
        break;
      }
      case 'close':
        this.close();
        break;
    }
  };

  private readonly onChange = (e: Event): void => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.opt as 'auto' | 'voice' | undefined;
    if (!k) return;
    this.prefs[k] = t.checked;
    savePrefs(this.prefs);
    if (k === 'voice') this.speak();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const map: Record<string, () => void> = {
      Escape: () => this.close(),
      ' ': () => {
        this.playing = !this.playing;
        this.syncControls();
      },
      ArrowRight: () => this.goto(this.beatIdx + 1),
      ArrowLeft: () => this.goto(this.beatIdx - 1),
      r: () => this.goto(this.beatIdx),
      R: () => this.goto(this.beatIdx),
    };
    const fn = map[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  close(): void {
    cancelAnimationFrame(this.raf);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.resize);
    this.el.remove();
    if (this.app.film === this) this.app.film = null;
  }
}

export function openFilm(app: App, src: FilmSource): FilmRoom {
  app.film?.close();
  return new FilmRoom(app, src);
}
