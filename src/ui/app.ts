import { Game } from '../core/game';
import { cmPer360, edpi } from '../core/sens';
import { store } from '../core/store';
import type { Drill, DrillReport } from '../drills/drill';
import { $, actions, esc, h, stagger } from './dom';

export type Route = 'home' | 'calibrate' | 'manual' | 'range' | 'tools' | 'settings';

export interface Screen {
  el: HTMLElement;
  destroy?(): void;
  onKey?(e: KeyboardEvent): void;
}

type ScreenFactory = (app: App, arg?: unknown) => Screen;

const NAV: { route: Route; n: string; label: string }[] = [
  { route: 'calibrate', n: '01', label: 'CALIBRATE' },
  { route: 'manual', n: '02', label: 'FIELD MANUAL' },
  { route: 'range', n: '03', label: 'FREE RANGE' },
  { route: 'tools', n: '04', label: 'INSTRUMENTS' },
  { route: 'settings', n: '05', label: 'SETTINGS' },
];

interface Launch {
  make: () => Drill;
  onDone: (r: DrillReport) => void;
  opts?: { countdown?: number; label?: string };
  onQuit?: () => void;
}

export class App {
  readonly game: Game;
  route: Route = 'home';
  private readonly screens: HTMLElement;
  private readonly spine: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly ui: HTMLElement;
  private readonly brg: HTMLElement;
  private current: Screen | null = null;
  private overlay: HTMLElement | null = null;
  private launch: Launch | null = null;
  private brgT = 0;
  private static registry = new Map<Route, ScreenFactory>();

  static register(route: Route, f: ScreenFactory): void {
    App.registry.set(route, f);
  }

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <canvas id="scene" tabindex="-1"></canvas>
      <div id="ui">
        <div class="scrim"></div>
        <div class="screens"></div>
        <aside class="spine">
          <button class="wordmark" data-act="home" aria-label="Home"><i></i>AZIMUTH</button>
          <nav>${NAV.map((n) => `<button data-act="nav" data-route="${n.route}" data-label="${n.label}">${n.n}</button>`).join('')}</nav>
          <div class="brg">BRG <b>000.0°</b></div>
        </aside>
        <div class="topbar"><button class="chip" data-act="settings"></button></div>
        <div class="nomouse"><div><h2 class="display" style="font-size:64px">Mouse required.</h2><p class="lede">Azimuth measures real mouse movement with pointer lock. Open it on a desktop browser.</p></div></div>
      </div>`;
    this.ui = $(root, '#ui');
    this.screens = $(root, '.screens');
    this.spine = $(root, '.spine');
    this.chip = $(root, '.chip');
    this.brg = $(root, '.brg b');

    this.game = new Game($(root, '#scene'), this.ui);
    this.game.applySettings(store.settings);
    store.subscribe((p) => {
      if (this.game.mode !== 'play') this.game.applySettings(p.settings);
      this.renderChip();
    });
    this.renderChip();

    actions(this.ui, {
      home: () => this.go('home'),
      nav: (el) => this.go(el.dataset.route as Route),
      settings: () => this.go('settings'),
    });

    this.game.onPause = (paused) => (paused ? this.showPause() : this.closeOverlay());
    this.game.onFrame = (dt) => {
      this.brgT -= dt;
      if (this.brgT <= 0) {
        this.brgT = 0.1;
        this.brg.textContent = `${this.game.cameraBearing.toFixed(1).padStart(5, '0')}°`;
      }
    };

    window.addEventListener('keydown', (e) => {
      if (this.game.input.locked) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      this.current?.onKey?.(e);
    });
    // First interaction unlocks audio (autoplay policy).
    window.addEventListener('pointerdown', () => this.game.audio.unlock(), { once: true });

    this.game.start();
  }

  private renderChip(): void {
    const s = store.settings;
    this.chip.innerHTML = `<i class="dot"></i><span>SENS <b>${s.sens.toFixed(2)}</b></span><i class="sep"></i><span><b>${s.dpi}</b> DPI</span><i class="sep"></i><span>eDPI <b>${Math.round(edpi(s.sens, s.dpi))}</b></span><i class="sep"></i><span><b>${cmPer360(s.sens, s.dpi).toFixed(1)}</b> CM/360</span>`;
  }

  go(route: Route, arg?: unknown): void {
    const f = App.registry.get(route);
    if (!f) return;
    this.closeOverlay();
    this.current?.destroy?.();
    this.route = route;
    const screen = f(this, arg);
    this.current = screen;
    screen.el.classList.add('screen');
    this.screens.replaceChildren(screen.el);
    stagger(screen.el);
    requestAnimationFrame(() => screen.el.classList.add('enter'));
    this.spine.querySelectorAll<HTMLElement>('nav button').forEach((b) => b.classList.toggle('on', b.dataset.route === route));
    this.ui.querySelector('.scrim')!.classList.toggle('heavy', route === 'manual' || route === 'settings');
  }

  /** Enter play mode. MUST be called from a click/keyboard handler: pointer lock needs a user gesture. */
  play(make: () => Drill, onDone: (r: DrillReport) => void, opts?: Launch['opts'], onQuit?: () => void): void {
    this.launch = { make, onDone, opts, onQuit };
    this.closeOverlay();
    this.game.audio.unlock();
    void this.game.input.lock(store.settings.rawInput).then((ok) => {
      if (!ok) {
        this.toast('The browser refused mouse capture. Click again — after pressing Esc, browsers need about a second.');
        return;
      }
      document.body.classList.add('playing');
      this.game.startDrill(make(), (r) => onDone(r), opts);
    });
  }

  /** Chain another drill while still captured (used between PSA samples). */
  chain(make: () => Drill, onDone: (r: DrillReport) => void, opts?: Launch['opts']): void {
    if (!this.game.input.locked) {
      this.play(make, onDone, opts, this.launch?.onQuit);
      return;
    }
    this.launch = { make, onDone, opts, onQuit: this.launch?.onQuit };
    this.game.startDrill(make(), onDone, opts);
  }

  /** Leave play mode, release the mouse, restore saved settings. */
  endPlay(): void {
    document.body.classList.remove('playing');
    this.game.exitPlay();
    this.game.applySettings(store.settings);
  }

  closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private showPause(): void {
    this.closeOverlay();
    const el = h(`
      <div class="overlay">
        <div class="pause">
          <div class="kicker">PAUSED · MOUSE RELEASED</div>
          <h3 class="display">Hold <span class="serif signal">steady.</span></h3>
          <p class="note" style="max-width:40ch">The clock is frozen. Resume re-captures your mouse. If the browser refuses, wait a second and click again.</p>
          <div class="actions">
            <button class="btn" data-act="resume">Resume <span class="arr">→</span></button>
            <button class="btn ghost" data-act="restart">Restart</button>
            <button class="btn ghost" data-act="quit">Quit</button>
          </div>
        </div>
      </div>`);
    actions(el, {
      resume: () => {
        void this.game.input.lock(store.settings.rawInput).then((ok) => {
          if (ok) {
            this.closeOverlay();
            this.game.resume();
          } else this.toast('Mouse capture refused — try again in a moment.');
        });
      },
      restart: () => {
        const l = this.launch;
        if (!l) return;
        this.game.exitPlay();
        this.play(l.make, l.onDone, l.opts, l.onQuit);
      },
      quit: () => {
        const q = this.launch?.onQuit;
        this.closeOverlay();
        this.endPlay();
        q?.();
      },
    });
    this.overlay = el;
    this.ui.appendChild(el);
  }

  showReport(r: DrillReport, opts: { retry?: () => void; back?: () => void; extra?: string; best?: number | null; isBest?: boolean } = {}): void {
    this.closeOverlay();
    const statHtml = r.stats
      .map(
        (s) =>
          `<div title="${esc(s.hint ?? '')}"><span>${esc(s.label)}</span><b>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</b></div>`,
      )
      .join('');
    const el = h(`
      <div class="overlay">
        <div class="report">
          <div class="report-score">
            <div>
              <div class="kicker plain" style="color:#6c6356">SCORE / 100</div>
              <div class="val">${r.score}</div>
            </div>
            <div>
              ${opts.isBest ? '<span class="pb">NEW PERSONAL BEST</span>' : opts.best != null ? `<span class="mono" style="font-size:10.5px;color:#6c6356">BEST ${opts.best}</span>` : ''}
            </div>
          </div>
          <div class="report-body">
            <div class="kicker">DRILL COMPLETE</div>
            <h3 class="display">${esc(r.title)}</h3>
            <div class="stats">${statHtml}</div>
            ${r.notes.length ? `<ul class="coach">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            ${opts.extra ?? ''}
            <div class="actions">
              ${opts.retry ? '<button class="btn" data-act="retry">Run it again <span class="arr">↻</span></button>' : ''}
              <button class="btn ghost" data-act="back">Back</button>
            </div>
          </div>
        </div>
      </div>`);
    actions(el, {
      retry: () => opts.retry?.(),
      back: () => {
        this.closeOverlay();
        opts.back?.();
      },
    });
    this.overlay = el;
    this.ui.appendChild(el);
  }

  get overlayEl(): HTMLElement | null {
    return this.overlay;
  }

  toast(msg: string): void {
    const el = h(`<div class="toast">${esc(msg)}</div>`);
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /** Standard run: play → report overlay with retry. */
  runDrill(make: () => Drill, after?: (r: DrillReport) => string | void): void {
    const go = () =>
      this.play(
        make,
        (r) => {
          this.endPlay();
          const isBest = r.score > 0 && store.recordBest(r.id, r.score);
          const best = store.get().bests[r.id] ?? null;
          const extra = after?.(r) ?? '';
          this.showReport(r, { retry: go, back: () => {}, extra, best, isBest });
        },
        undefined,
      );
    go();
  }
}
