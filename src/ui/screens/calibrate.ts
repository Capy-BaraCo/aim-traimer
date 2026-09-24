import { flickBias, type Focus, type FlickTally } from '../../core/metrics';
import {
  createPsa,
  currentStep,
  estimate,
  isDone,
  pick,
  sensOf,
  sideOf,
  undo,
  type PsaState,
  type Side,
} from '../../core/psa';
import {
  cmPer360,
  edpi,
  GAMES,
  gameToOw,
  inchesPer360,
  owToGame,
  roundSens,
  sensForCmPer360,
  STYLE_BANDS,
  styleFor,
} from '../../core/sens';
import { store } from '../../core/store';
import { CalibrationTrial, type TrialData } from '../../drills/trial';
import { App } from '../app';
import { actions, h } from '../dom';

type Source = 'current' | 'game' | 'cm' | 'pad';
type Sample = 'alpha' | 'beta';

interface PickRecord {
  round: number;
  low: number;
  high: number;
  side: Side;
  picked: Sample;
  alphaSens: number;
  betaSens: number;
  alphaScore: number | null;
  betaScore: number | null;
}

interface Session {
  stage: 'setup' | 'round' | 'result';
  source: Source;
  dpi: number;
  sensInput: number;
  gameId: string;
  gameSens: number;
  cmTarget: number;
  padWidth: number;
  focus: Focus;
  rounds: number;
  blind: boolean;
  fine: boolean;
  warmedUp: boolean;
  psa: PsaState | null;
  trials: { alpha?: TrialData; beta?: TrialData }[];
  picks: PickRecord[];
  saved: boolean;
}

let session: Session | null = null;

function freshSession(): Session {
  const s = store.settings;
  return {
    stage: 'setup',
    source: 'current',
    dpi: s.dpi,
    sensInput: s.sens,
    gameId: 'valorant',
    gameSens: 0.4,
    cmTarget: 35,
    padWidth: 22,
    focus: s.focus,
    rounds: s.rounds,
    blind: s.blind,
    fine: false,
    warmedUp: false,
    psa: null,
    trials: [],
    picks: [],
    saved: false,
  };
}

function baseSens(s: Session): number {
  switch (s.source) {
    case 'current':
      return s.sensInput;
    case 'game': {
      const g = GAMES.find((x) => x.id === s.gameId) ?? GAMES[0];
      return gameToOw(s.gameSens, g);
    }
    case 'cm':
      return sensForCmPer360(s.cmTarget, s.dpi);
    case 'pad':
      // A comfortable full sweep of your free space should turn you about 180°.
      return sensForCmPer360(s.padWidth * 2, s.dpi);
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const FOCI: { id: Focus; title: string; heroes: string; blurb: string }[] = [
  { id: 'balanced', title: 'Balanced', heroes: 'Soldier · Sojourn · Ana · Ashe', blurb: '12 s tracking, 8 flicks' },
  { id: 'tracking', title: 'Tracking', heroes: 'Tracer · Sombra · Zarya · Bastion', blurb: '16 s tracking, 5 flicks' },
  { id: 'flick', title: 'Flick', heroes: 'Cassidy · Widowmaker · Hanzo', blurb: '8 s tracking, 11 flicks' },
];

App.register('calibrate', (app) => {
  if (!session) session = freshSession();
  const root = h('<div></div>');
  const S = () => session!;

  const render = () => {
    const s = S();
    root.className = 'screen enter';
    if (s.stage === 'setup') root.innerHTML = setupHtml(s);
    else if (s.stage === 'round') root.innerHTML = roundHtml(s);
    else root.innerHTML = resultHtml(s);
    root.querySelectorAll<HTMLElement>('.rise').forEach((el, i) => el.style.setProperty('--i', String(i)));
    root.classList.remove('enter');
    void root.offsetWidth;
    root.classList.add('enter');
  };

  const refreshBase = () => {
    const s = S();
    const out = root.querySelector('.base-out');
    if (!out) return;
    const b = baseSens(s);
    out.innerHTML = baseReadout(b, s.dpi);
    const viz = root.querySelector('.window-viz');
    if (viz) viz.outerHTML = windowViz(b * 0.5, b * 1.5, b * 0.5, b * 1.5, s.dpi, false, b);
  };

  root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    const key = t.dataset.bind as keyof Session | undefined;
    if (!key) return;
    const s = S() as unknown as Record<string, unknown>;
    s[key] = t.type === 'number' ? Number(t.value) : t.value;
    refreshBase();
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.bind === 'blind') S().blind = t.checked;
    if (t.dataset.bind === 'gameId') {
      S().gameId = t.value;
      refreshBase();
    }
  });

  const runPair = () => {
    const s = S();
    if (!s.psa) return;
    const step = currentStep(s.psa);
    const idx = step.round - 1;
    s.trials[idx] = {};
    const kicker = `${s.fine ? 'FINE-TUNE' : 'CALIBRATION'} · ROUND ${step.round}/${s.psa.rounds}`;
    const g = app.game;
    const label = (sample: Sample, sens: number) =>
      `<b>${sample === 'alpha' ? 'α' : 'β'}</b>SAMPLE${s.blind ? '' : ` · ${sens.toFixed(2)}`}`;
    const make = (sample: Sample) => () => {
      const sens = sensOf(step, sample);
      g.sens = sens;
      g.hud.setSample(label(sample, sens), sample);
      return new CalibrationTrial(g, sample === 'alpha' ? 'Sample α' : 'Sample β', kicker, s.focus);
    };
    app.play(
      make('alpha'),
      (ra) => {
        s.trials[idx].alpha = ra.data as TrialData;
        app.chain(
          make('beta'),
          (rb) => {
            s.trials[idx].beta = rb.data as TrialData;
            app.endPlay();
            render();
          },
          { countdown: 3, label: 'Switching to sample β' },
        );
      },
      { countdown: 3, label: 'Sample α' },
      () => render(),
    );
  };

  const choose = (sample: Sample) => {
    const s = S();
    if (!s.psa) return;
    const step = currentStep(s.psa);
    const tr = s.trials[step.round - 1];
    if (!tr?.alpha || !tr?.beta) return;
    app.game.audio.ui();
    s.picks[step.round - 1] = {
      round: step.round,
      low: step.low,
      high: step.high,
      side: sideOf(step, sample),
      picked: sample,
      alphaSens: sensOf(step, 'alpha'),
      betaSens: sensOf(step, 'beta'),
      alphaScore: tr.alpha.score,
      betaScore: tr.beta.score,
    };
    s.psa = pick(s.psa, sideOf(step, sample));
    if (isDone(s.psa)) s.stage = 'result';
    render();
    root.scrollTop = 0;
  };

  const start = (fine: boolean, base: number) => {
    const s = S();
    s.fine = fine;
    s.psa = fine ? createPsa(base, 4, 0.1) : createPsa(base, s.rounds, 0.5);
    s.trials = [];
    s.picks = [];
    s.saved = false;
    s.stage = 'round';
    store.setSettings({ focus: s.focus, rounds: s.rounds, blind: s.blind, dpi: s.dpi });
    render();
  };

  actions(root, {
    source: (el) => {
      S().source = el.dataset.v as Source;
      render();
    },
    style: (el) => {
      const band = STYLE_BANDS[el.dataset.v as keyof typeof STYLE_BANDS].range;
      S().cmTarget = Math.round((band[0] + band[1]) / 2);
      render();
    },
    focus: (el) => {
      S().focus = el.dataset.v as Focus;
      render();
    },
    rounds: (el) => {
      S().rounds = Number(el.dataset.v);
      render();
    },
    start: () => {
      const b = baseSens(S());
      if (!(b > 0.05 && b < 100)) {
        app.toast('That starting sensitivity is out of range — check DPI and values.');
        return;
      }
      start(false, b);
    },
    resume: () => {
      S().stage = 'round';
      render();
    },
    warmup: () => {
      const s = S();
      app.play(
        () => {
          app.game.sens = baseSens(s);
          return new CalibrationTrial(app.game, 'Warm-up', 'CALIBRATION · WARM-UP', s.focus);
        },
        () => {
          app.endPlay();
          s.warmedUp = true;
          render();
          app.toast('Warmed up. Your hands are ready — start round 1.');
        },
      );
    },
    play: () => runPair(),
    pick: (el) => choose(el.dataset.s as Sample),
    undo: () => {
      const s = S();
      if (!s.psa) return;
      const cur = currentStep(s.psa).round;
      s.psa = undo(s.psa);
      const now = currentStep(s.psa).round;
      s.trials[cur - 1] = {};
      s.trials[now - 1] = {};
      s.picks.length = now - 1;
      s.stage = 'round';
      render();
    },
    abort: () => {
      session = freshSession();
      render();
    },
    save: () => {
      const s = S();
      if (!s.psa) return;
      const result = roundSens(estimate(s.psa));
      store.setSettings({ sens: result, dpi: s.dpi });
      store.update((p) =>
        p.history.push({
          at: new Date().toISOString(),
          base: s.psa!.base,
          result,
          dpi: s.dpi,
          focus: s.focus,
          rounds: s.psa!.rounds,
          agreement: agreement(s).ratio,
        }),
      );
      s.saved = true;
      render();
      app.toast(`Saved. Set Overwatch → Options → Controls → Mouse sensitivity to ${result.toFixed(2)}.`);
    },
    fine: () => {
      const s = S();
      if (!s.psa) return;
      start(true, roundSens(estimate(s.psa)));
    },
    fresh: () => {
      session = freshSession();
      render();
    },
    manual: () => app.go('manual'),
  });

  render();
  return {
    el: root,
    onKey: (e) => {
      const s = S();
      if (s.stage !== 'round' || !s.psa) return;
      const tr = s.trials[currentStep(s.psa).round - 1];
      const played = !!(tr?.alpha && tr?.beta);
      if (e.code === 'Space') {
        e.preventDefault();
        runPair();
      } else if (played && (e.code === 'Digit1' || e.code === 'KeyA')) choose('alpha');
      else if (played && (e.code === 'Digit2' || e.code === 'KeyB')) choose('beta');
    },
  };
});

// ------------------------------------------------------------------------------------------------

function baseReadout(b: number, dpi: number): string {
  return `<div class="num" style="font-size:64px;line-height:.9">${b.toFixed(2)}</div>
    <div class="mono muted" style="font-size:10.5px;margin-top:6px">BASE SENS · ${cmPer360(b, dpi).toFixed(1)} CM/360 · eDPI ${Math.round(edpi(b, dpi))}</div>`;
}

function windowViz(lo0: number, hi0: number, lo: number, hi: number, dpi: number, blind: boolean, base?: number): string {
  const span = hi0 - lo0;
  const p = (v: number) => ((v - lo0) / span) * 100;
  const lbl = (v: number, top = false) =>
    blind ? '' : `<span class="lbl ${top ? 'top hi' : 'lo'}" style="left:${p(v)}%">${v.toFixed(2)} · ${cmPer360(v, dpi).toFixed(0)}cm</span>`;
  return `<div class="window-viz">
    <div class="track"></div>
    <div class="win" style="left:${p(lo)}%;width:${Math.max(0.6, p(hi) - p(lo))}%"></div>
    ${base !== undefined ? `<div class="base" style="left:${p(base)}%"></div>` : ''}
    ${lbl(lo)}${lbl(hi, true)}
  </div>`;
}

function setupHtml(s: Session): string {
  const b = baseSens(s);
  const sourceBtn = (id: Source, label: string) =>
    `<button class="${s.source === id ? 'on' : ''}" data-act="source" data-v="${id}">${label}</button>`;
  let inputs = '';
  if (s.source === 'current')
    inputs = `<label class="field"><span>Overwatch sensitivity</span><input class="input" type="number" step="0.01" min="0.01" max="100" data-bind="sensInput" value="${s.sensInput}"></label>`;
  else if (s.source === 'game')
    inputs = `<label class="field"><span>Game</span><select class="input" data-bind="gameId">${GAMES.map((g) => `<option value="${g.id}" ${g.id === s.gameId ? 'selected' : ''}>${g.name}</option>`).join('')}</select></label>
      <label class="field"><span>Sensitivity there</span><input class="input" type="number" step="0.001" min="0.001" data-bind="gameSens" value="${s.gameSens}"></label>`;
  else if (s.source === 'cm')
    inputs = `<label class="field"><span>Target cm/360</span><input class="input" type="number" step="0.5" min="5" max="150" data-bind="cmTarget" value="${s.cmTarget}"></label>
      <div class="field"><span>Or start from a style</span><div class="seg">${(Object.keys(STYLE_BANDS) as (keyof typeof STYLE_BANDS)[])
        .map((k) => `<button data-act="style" data-v="${k}">${STYLE_BANDS[k].label}</button>`)
        .join('')}</div></div>`;
  else
    inputs = `<label class="field"><span>Free mousepad width (cm)</span><input class="input" type="number" step="0.5" min="5" max="120" data-bind="padWidth" value="${s.padWidth}"></label>
      <p class="note" style="margin:0;align-self:end">A comfortable full sweep of your free space should turn you about <b>180°</b> — so cm/360 ≈ 2 × width.</p>`;

  const inProgress = s.psa && !isDone(s.psa);
  const minutes = Math.round((s.rounds * (2 * sampleSeconds(s.focus) + 15)) / 60);
  return `
  <div class="cal">
    <aside class="cal-side">
      <div class="kicker rise">Protocol · PSA</div>
      <h2 class="display rise">Calibrate<span class="serif">by feel, not by number.</span></h2>
      <ol class="steps rise">
        <li><span><b>Warm up.</b> Cold hands choose slow sensitivities.</span></li>
        <li><span><b>Play both samples.</b> α and β are the same drill at two hidden sensitivities, in random order.</span></li>
        <li><span><b>Keep the one you controlled.</b> Not the higher score — scores are only a tie-breaker.</span></li>
        <li><span><b>Repeat.</b> The window halves every round: ±50% becomes ±0.4% after seven.</span></li>
        <li><span><b>Live with it for a week</b> in Overwatch before you judge it.</span></li>
      </ol>
      <p class="note rise">Samples use Overwatch movement (5.5 m/s, instant strafes), the 0.0066° yaw and your FOV. Tracking phase: hold fire. Flick phase: one click per target.</p>
    </aside>
    <section class="cal-main">
      <div class="panel glass rise">
        <h4><span>01 · Starting point</span><span>the search opens at ±50%</span></h4>
        <div class="seg">${sourceBtn('current', 'My OW sens')}${sourceBtn('game', 'Other game')}${sourceBtn('cm', 'Target cm/360')}${sourceBtn('pad', 'Mousepad fit')}</div>
        <div class="grid2" style="margin-top:16px;align-items:end">
          <label class="field"><span>Mouse DPI</span><input class="input" type="number" step="50" min="100" max="32000" data-bind="dpi" value="${s.dpi}"></label>
          ${inputs}
        </div>
        <div class="grid2" style="margin-top:22px;align-items:end">
          <div class="base-out">${baseReadout(b, s.dpi)}</div>
          ${windowViz(b * 0.5, b * 1.5, b * 0.5, b * 1.5, s.dpi, false, b)}
        </div>
      </div>
      <div class="panel glass rise">
        <h4><span>02 · What do you play?</span><span>weights each sample</span></h4>
        <div class="focus-cards">${FOCI.map(
          (f) => `<button class="${s.focus === f.id ? 'on' : ''}" data-act="focus" data-v="${f.id}"><b>${f.title}</b><span>${f.heroes}</span><span class="mono" style="font-size:10px">${f.blurb}</span></button>`,
        ).join('')}</div>
      </div>
      <div class="panel glass rise">
        <h4><span>03 · Protocol</span><span>≈ ${minutes} min total</span></h4>
        <div class="grid2" style="align-items:center">
          <div class="seg">${[5, 7, 9].map((n) => `<button class="${s.rounds === n ? 'on' : ''}" data-act="rounds" data-v="${n}">${n} · ${n === 7 ? 'std' : n === 5 ? 'quick' : 'deep'}</button>`).join('')}</div>
          <label class="switch"><span class="note"><b>Blind samples</b> — hide the numbers until the end</span><input type="checkbox" data-bind="blind" ${s.blind ? 'checked' : ''}><i></i></label>
        </div>
      </div>
      <div class="actions rise">
        ${inProgress ? `<button class="btn" data-act="resume">Resume round ${currentStep(s.psa!).round} <span class="arr">→</span></button><button class="btn ghost" data-act="start">Restart from round 1</button>` : `<button class="btn" data-act="start">Start round 1 <span class="arr">→</span></button>`}
        <button class="btn ghost" data-act="warmup">${s.warmedUp ? 'Warm-up again' : 'Warm-up first'} · 40 s</button>
      </div>
    </section>
  </div>`;
}

function sampleCard(sample: Sample, d: TrialData | undefined, other: TrialData | undefined, sens: number, blind: boolean, pickable: boolean): string {
  const glyph = sample === 'alpha' ? 'α' : 'β';
  const tag = pickable ? 'button' : 'div';
  if (!d)
    return `<${tag} class="sample ${sample}"><span class="glyph">${glyph}</span><span class="name">Sample ${sample} · not played yet</span>${blind ? '' : `<span class="val">${sens.toFixed(2)}<br>${cmPer360(sens, store.settings.dpi).toFixed(1)} cm</span>`}</${tag}>`;
  const m = d.metrics;
  const o = other?.metrics;
  const better = (a: number, b: number | undefined, higher = true) => (b === undefined ? '' : (higher ? a > b : a < b) ? 'win' : '');
  const bias = flickBias(m.tally);
  return `<${tag} class="sample ${sample} ${pickable ? 'pickable' : ''}" ${pickable ? `data-act="pick" data-s="${sample}"` : ''}>
    <span class="glyph">${glyph}</span>
    ${blind ? '' : `<span class="val">${sens.toFixed(2)}<br>${cmPer360(sens, store.settings.dpi).toFixed(1)} cm</span>`}
    <div class="score">${d.score.toFixed(1)}<small>DATA SCORE</small></div>
    <dl>
      <dt>Tracking on target</dt><dd class="${better(m.trackAcc, o?.trackAcc)}">${Math.round(m.trackAcc * 100)}%</dd>
      <dt>Flick time</dt><dd class="${better(m.flickTimeMs, o?.flickTimeMs, false)}">${Math.round(m.flickTimeMs)} ms</dd>
      <dt>Flicks landed</dt><dd class="${better(m.flickHitRate, o?.flickHitRate)}">${Math.round(m.flickHitRate * 100)}%</dd>
      <dt>Over / under</dt><dd>${m.tally.overshoot} / ${m.tally.undershoot}${Math.abs(bias) > 0.25 ? (bias > 0 ? ' ↗' : ' ↘') : ''}</dd>
    </dl>
    ${pickable ? `<span class="pick-hint"><span>Keep <span class="gk">${glyph}</span></span><span class="kbd">${sample === 'alpha' ? '1' : '2'}</span></span>` : ''}
  </${tag}>`;
}

function roundHtml(s: Session): string {
  const psa = s.psa!;
  const step = currentStep(psa);
  const tr = s.trials[step.round - 1] ?? {};
  const played = !!(tr.alpha && tr.beta);
  const pips = Array.from({ length: psa.rounds }, (_, i) => `<i class="${i + 1 < step.round ? 'done' : i + 1 === step.round ? 'now' : ''}"></i>`).join('');
  const lo0 = psa.base * (1 - psa.spread);
  const hi0 = psa.base * (1 + psa.spread);
  let verdict = '';
  if (played) {
    const diff = tr.alpha!.score - tr.beta!.score;
    verdict =
      Math.abs(diff) < 3
        ? '<span>The numbers are <b>too close to call</b> (±3). This round is pure feel.</span>'
        : `<span>The numbers lean <b>${diff > 0 ? 'α' : 'β'}</b> by ${Math.abs(diff).toFixed(1)} — a tie-breaker, not a verdict.</span>`;
  }
  return `
  <div class="cal">
    <aside class="cal-side">
      <div class="kicker rise">${s.fine ? 'Fine-tune · ±10%' : 'Calibration'} · ${FOCI.find((f) => f.id === s.focus)!.title}</div>
      <div class="round-head rise"><span class="big">${pad2(step.round)}</span><span class="of">/ ${pad2(psa.rounds)}<br>ROUNDS</span></div>
      <div class="pips rise">${pips}</div>
      <div class="panel glass rise">
        <h4><span>Search window</span><span>${(((step.high - step.low) / (hi0 - lo0)) * 100).toFixed(1)}% of start</span></h4>
        ${windowViz(lo0, hi0, step.low, step.high, s.dpi, s.blind)}
        <p class="note" style="margin:6px 0 0">${s.blind ? 'Numbers are hidden until the certificate. The bar shows how far the search has narrowed.' : `Testing ${step.low.toFixed(2)} vs ${step.high.toFixed(2)}.`}</p>
      </div>
      <div class="actions rise">
        ${step.round > 1 ? '<button class="btn ghost small" data-act="undo">Undo last pick</button>' : ''}
        <button class="btn ghost small" data-act="abort">Abandon</button>
      </div>
    </aside>
    <section class="cal-main">
      ${
        played
          ? `<div class="kicker rise">Which one felt more in control?</div>`
          : `<div class="panel glass rise">
              <h4><span>Round ${step.round}</span><span>≈ ${Math.round(2 * sampleSeconds(s.focus))} s</span></h4>
              <p class="lede" style="margin:0 0 18px">Play α then β back to back. You'll feel the difference in the first seconds — keep playing anyway: the second half, when you've adapted, is what matters.</p>
              <div class="actions"><button class="btn" data-act="play">Play <span class="gk">α</span> then <span class="gk">β</span> <span class="arr">→</span></button><span class="note"><span class="kbd">SPACE</span> also works · <span class="kbd">ESC</span> pauses</span></div>
            </div>`
      }
      <div class="samples rise">
        ${sampleCard('alpha', tr.alpha, tr.beta, sensOf(step, 'alpha'), s.blind, played)}
        ${sampleCard('beta', tr.beta, tr.alpha, sensOf(step, 'beta'), s.blind, played)}
      </div>
      ${played ? `<div class="verdict glass rise">${verdict}<button class="btn ghost small" data-act="play">Replay both</button></div>` : ''}
      <p class="note rise">Trust control over score: fewer surprise overshoots, smoother tracking, a looser grip. If you can't tell them apart, pick the one you'd rather play a whole match with.</p>
    </section>
  </div>`;
}

/** Rough length of one sample: tracking seconds + ~1.6 s per flick + countdown. */
function sampleSeconds(focus: Focus): number {
  const plan = { balanced: [12, 8], tracking: [16, 5], flick: [8, 11] }[focus];
  return plan[0] + plan[1] * 1.6 + 3;
}

function agreement(s: Session): { agreed: number; decisive: number; ratio: number } {
  let agreed = 0;
  let decisive = 0;
  for (const p of s.picks) {
    if (!p || p.alphaScore === null || p.betaScore === null) continue;
    const d = p.alphaScore - p.betaScore;
    if (Math.abs(d) < 3) continue;
    decisive++;
    if ((d > 0 ? 'alpha' : 'beta') === p.picked) agreed++;
  }
  return { agreed, decisive, ratio: decisive ? agreed / decisive : 1 };
}

function funnelSvg(s: Session, final: number): string {
  const psa = s.psa!;
  const lo0 = psa.base * (1 - psa.spread);
  const hi0 = psa.base * (1 + psa.spread);
  const W = 640;
  const x0 = 70;
  const x1 = 620;
  const sx = (v: number) => x0 + ((v - lo0) / (hi0 - lo0)) * (x1 - x0);
  const rows = s.picks.length;
  const H = 40 + rows * 26 + 30;
  let body = '';
  s.picks.forEach((p, i) => {
    const y = 30 + i * 26;
    body += `<text x="10" y="${y + 4}" fill="#6c6356">R${p.round}</text>`;
    body += `<line x1="${sx(p.low)}" y1="${y}" x2="${sx(p.high)}" y2="${y}" stroke="#14120f" stroke-width="5" opacity="0.18"/>`;
    const kept = p.side === 'low' ? p.low : p.high;
    const drop = p.side === 'low' ? p.high : p.low;
    body += `<circle cx="${sx(drop)}" cy="${y}" r="4.5" fill="none" stroke="#14120f" stroke-width="1.2"/>`;
    body += `<circle cx="${sx(kept)}" cy="${y}" r="5.5" fill="#ff4b1f"/>`;
    body += `<text x="${sx(kept) + (p.side === 'low' ? -10 : 10)}" y="${y + 4}" text-anchor="${p.side === 'low' ? 'end' : 'start'}" fill="#14120f">${kept.toFixed(2)}</text>`;
  });
  const yEnd = 30 + rows * 26;
  body += `<line x1="${sx(final)}" y1="14" x2="${sx(final)}" y2="${yEnd}" stroke="#ff4b1f" stroke-dasharray="3 3"/>`;
  body += `<text x="${sx(final)}" y="${yEnd + 16}" text-anchor="middle" fill="#ff4b1f" font-weight="600">${final.toFixed(2)}</text>`;
  body += `<text x="${x0}" y="${yEnd + 16}" fill="#6c6356">${lo0.toFixed(2)}</text><text x="${x1}" y="${yEnd + 16}" text-anchor="end" fill="#6c6356">${hi0.toFixed(2)}</text>`;
  return `<svg class="funnel" viewBox="0 0 ${W} ${H}" width="100%">${body}</svg>`;
}

function biasGauge(t: FlickTally): string {
  const b = flickBias(t);
  const x = 50 + b * 50;
  let note: string;
  if (t.total < 6) note = 'Not enough flicks near your result to read a pattern.';
  else if (b > 0.25) note = `Near your result you overshot ${t.overshoot}/${t.total} flicks. If that persists in Snap over a few days, try a notch lower (−3 to −5%).`;
  else if (b < -0.25) note = `Near your result you undershot ${t.undershoot}/${t.total} flicks. If that persists in Snap over a few days, try a notch higher (+3 to +5%).`;
  else note = `Balanced: ${t.overshoot} over, ${t.undershoot} under of ${t.total}. That's the signature of a sensitivity you can stop on.`;
  return `<div style="position:relative;height:30px;margin:6px 0 10px;border-top:1px solid var(--hair-2)">
      <span class="mono muted" style="position:absolute;left:0;top:8px;font-size:9.5px">UNDER</span>
      <span class="mono muted" style="position:absolute;right:0;top:8px;font-size:9.5px">OVER</span>
      <span style="position:absolute;left:50%;top:-5px;width:1px;height:10px;background:var(--bone-3)"></span>
      <span style="position:absolute;left:${x}%;top:-7px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--signal)"></span>
    </div><p class="note" style="margin:0">${note}</p>`;
}

function resultHtml(s: Session): string {
  const psa = s.psa!;
  const final = roundSens(estimate(psa));
  const cm = cmPer360(final, s.dpi);
  const delta = ((final - psa.base) / psa.base) * 100;
  const ag = agreement(s);
  const tally: FlickTally = { overshoot: 0, undershoot: 0, clean: 0, total: 0 };
  s.picks.slice(-3).forEach((p) => {
    const tr = s.trials[p.round - 1];
    const d = tr?.[p.picked];
    if (!d) return;
    tally.overshoot += d.metrics.tally.overshoot;
    tally.undershoot += d.metrics.tally.undershoot;
    tally.clean += d.metrics.tally.clean;
    tally.total += d.metrics.tally.total;
  });
  const no = String(store.get().history.length + 1).padStart(4, '0');
  const rows = s.picks
    .map((p) => {
      const tr = s.trials[p.round - 1];
      return `<tr><td>R${p.round}</td><td class="${p.picked === 'alpha' ? 'pick' : ''}">${p.alphaSens.toFixed(2)}</td><td class="${p.picked === 'beta' ? 'pick' : ''}">${p.betaSens.toFixed(2)}</td><td>${tr?.alpha?.score.toFixed(1) ?? '—'}</td><td>${tr?.beta?.score.toFixed(1) ?? '—'}</td><td>${p.picked === 'alpha' ? 'α' : 'β'}</td></tr>`;
    })
    .join('');
  return `
  <div class="cert-wrap">
    <article class="cert rise">
      <div class="cert-head"><span>Azimuth · Calibration certificate</span><span>No. ${no} · ${new Date().toLocaleDateString()}</span></div>
      <div class="cert-main">
        <div class="cert-sens">${final.toFixed(2)}<small>OVERWATCH MOUSE SENSITIVITY @ ${s.dpi} DPI</small></div>
        <div class="cert-figs">
          <div><span>eDPI</span><b>${Math.round(edpi(final, s.dpi))}</b></div>
          <div><span>cm / 360</span><b>${cm.toFixed(1)}</b></div>
          <div><span>in / 360</span><b>${inchesPer360(final, s.dpi).toFixed(1)}</b></div>
          <div><span>Style band</span><b>${STYLE_BANDS[styleFor(cm)].label}</b></div>
          <div><span>From base ${psa.base.toFixed(2)}</span><b>${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</b></div>
          <div><span>Feel ↔ data agreement</span><b>${ag.decisive ? `${ag.agreed}/${ag.decisive}` : '—'}</b></div>
        </div>
      </div>
      <div class="stamp">${s.fine ? 'FINE-TUNED' : 'CALIBRATED'}<small>PSA · ${psa.rounds} ROUNDS · ${s.blind ? 'BLIND' : 'OPEN'}</small></div>
      <section class="cert-section"><h5>Convergence — ● kept · ○ rejected</h5>${funnelSvg(s, final)}</section>
      <section class="cert-section"><h5>Rounds</h5>
        <table><thead><tr><th>ROUND</th><th>α SENS</th><th>β SENS</th><th>α SCORE</th><th>β SCORE</th><th>KEPT</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <section class="cert-section"><h5>Same feel in other games (same DPI)</h5>
        <table><tbody>${GAMES.map((g) => `<tr><td>${g.name}</td><td style="text-align:right">${owToGame(final, g).toFixed(g.decimals)}</td></tr>`).join('')}</tbody></table>
      </section>
    </article>
    <aside class="cert-side">
      <div class="panel glass rise">
        <h4><span>Apply it</span></h4>
        <p>Overwatch → <b>Options → Controls → Mouse sensitivity</b>: <span class="live">${final.toFixed(2)}</span>. Keep your mouse at <b>${s.dpi} DPI</b>.</p>
        <p>Give it a week before you judge it — the first sessions will feel strange even when the number is right.</p>
        <button class="btn" data-act="save" ${s.saved ? 'disabled' : ''}>${s.saved ? 'Saved ✓' : 'Save as my sensitivity'} <span class="arr">→</span></button>
      </div>
      <div class="panel glass rise">
        <h4><span>Flick balance</span><span>last 3 rounds</span></h4>
        ${biasGauge(tally)}
      </div>
      <div class="panel glass rise">
        <h4><span>Feel vs data</span></h4>
        <p class="note" style="margin:0">${
          ag.decisive === 0
            ? 'Every round was too close for the numbers to have an opinion — this result is pure feel.'
            : ag.ratio >= 0.6
              ? `Your picks matched the numbers in ${ag.agreed} of ${ag.decisive} decisive rounds. Feel and performance point the same way — a trustworthy result.`
              : `Your picks went against the numbers in ${ag.decisive - ag.agreed} of ${ag.decisive} decisive rounds. That's allowed (comfort matters), but if you were tired, redo it fresh.`
        }</p>
      </div>
      <div class="actions rise">
        ${s.fine ? '' : '<button class="btn ghost small" data-act="fine">Fine-tune ±10%</button>'}
        <button class="btn ghost small" data-act="fresh">New calibration</button>
        <button class="btn ghost small" data-act="manual">Field manual</button>
      </div>
    </aside>
  </div>`;
}

