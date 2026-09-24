import { cmPer360, degPerCm, edpi, GAMES, inchesPer360, mmForDegrees, owToGame, roundSens, sensForNewDpi } from '../../core/sens';
import { store } from '../../core/store';
import { ProtractorDrill } from '../../drills/range';
import { App } from '../app';
import { actions, h } from '../dom';

interface ToolState {
  sens: number;
  dpi: number;
  newDpi: number;
  pad: number;
  measuredCm: number;
  counts: number;
}

App.register('tools', (app) => {
  const st: ToolState = {
    sens: store.settings.sens,
    dpi: store.settings.dpi,
    newDpi: store.settings.dpi === 800 ? 1600 : 800,
    pad: 40,
    measuredCm: 10,
    counts: 0,
  };
  const el = h(`
    <div class="tools">
      <header>
        <div class="kicker rise">Instruments</div>
        <h2 class="display rise">Measure <span class="serif">everything.</span></h2>
        <p class="lede rise">The maths behind every number in Azimuth, as calculators you can poke. All conversions keep your physical feel (cm/360) constant.</p>
      </header>
      <section class="panel glass span-7 rise">
        <h4><span>01 · Converter</span><span>Overwatch · 0.0066°/count</span></h4>
        <div class="grid2">
          <label class="field"><span>Overwatch sensitivity</span><input class="input" type="number" step="0.01" data-k="sens" value="${st.sens}"></label>
          <label class="field"><span>Mouse DPI</span><input class="input" type="number" step="50" data-k="dpi" value="${st.dpi}"></label>
        </div>
        <div class="big-out" data-out="core"></div>
        <table class="conv" style="margin-top:14px" data-out="games"></table>
      </section>
      <section class="panel glass span-5 push-1 rise">
        <h4><span>02 · Changing DPI?</span></h4>
        <label class="field"><span>New DPI</span><input class="input" type="number" step="50" data-k="newDpi" value="${st.newDpi}"></label>
        <div class="big-out" style="grid-template-columns:1fr" data-out="dpi"></div>
        <p class="note">Higher DPI with a lower in-game sensitivity gives the same feel with finer steps. Most players settle between 800 and 1600.</p>
      </section>
      <section class="panel glass span-6 rise">
        <h4><span>03 · Mousepad fit</span></h4>
        <label class="field"><span>Free width you can sweep (cm)</span><input class="input" type="number" step="1" data-k="pad" value="${st.pad}"></label>
        <div data-out="pad"></div>
      </section>
      <section class="panel glass span-6 rise">
        <h4><span>04 · DPI check</span><span>needs a ruler</span></h4>
        <p class="note" style="margin-top:0">Mice often report a different DPI than printed on the box. Launch the Protractor, move exactly along a ruler (e.g. 10 cm), press <span class="kbd">ENTER</span>, then type the distance you moved.</p>
        <div class="actions"><button class="btn" data-act="protractor">Launch protractor <span class="arr">→</span></button></div>
        <div class="grid2" style="margin-top:14px">
          <label class="field"><span>Distance moved (cm)</span><input class="input" type="number" step="0.1" data-k="measuredCm" value="${st.measuredCm}"></label>
          <label class="field"><span>Counts recorded</span><input class="input" type="number" step="1" data-k="counts" value="${st.counts}"></label>
        </div>
        <div data-out="dpicheck"></div>
      </section>
      <section class="panel glass span-12 rise">
        <h4><span>05 · Calibration log</span></h4>
        <div data-out="history"></div>
      </section>
    </div>`);

  const out = (k: string) => el.querySelector(`[data-out="${k}"]`) as HTMLElement;

  const update = () => {
    const { sens, dpi } = st;
    const ok = sens > 0 && dpi > 0;
    const cm = ok ? cmPer360(sens, dpi) : NaN;
    out('core').innerHTML = `
      <div><span>eDPI</span><b>${ok ? Math.round(edpi(sens, dpi)) : '—'}</b></div>
      <div><span>cm / 360</span><b>${ok ? cm.toFixed(2) : '—'}</b></div>
      <div><span>in / 360</span><b>${ok ? inchesPer360(sens, dpi).toFixed(2) : '—'}</b></div>
      <div><span>° per cm</span><b>${ok ? degPerCm(sens, dpi).toFixed(2) : '—'}</b></div>
      <div><span>mm per 1°</span><b>${ok ? mmForDegrees(1, sens, dpi).toFixed(2) : '—'}</b></div>
      <div><span>180° turn</span><b>${ok ? (cm / 2).toFixed(1) : '—'}<small class="mono muted" style="font-size:10px"> cm</small></b></div>`;
    out('games').innerHTML = GAMES.map((g) => `<tr><td>${g.name}</td><td>${ok ? owToGame(sens, g).toFixed(g.decimals) : '—'}</td></tr>`).join('');
    const nd = st.newDpi > 0 ? roundSens(sensForNewDpi(sens, dpi, st.newDpi)) : NaN;
    out('dpi').innerHTML = `<div><span>Overwatch sens at ${st.newDpi} DPI</span><b>${Number.isFinite(nd) ? nd.toFixed(2) : '—'}</b></div>`;
    const turn = ok ? (st.pad / cm) * 360 : 0;
    const pct = Math.min(100, (turn / 360) * 100);
    out('pad').innerHTML = `
      <div class="padbar"><div class="fill" style="width:${pct}%"></div>
        <span class="mk" style="left:50%">180°</span><span class="mk" style="left:100%">360°</span></div>
      <p class="note">A full sweep of ${st.pad} cm turns you <b>${turn.toFixed(0)}°</b>. ${
        turn < 180
          ? 'Less than 180°: you will run out of pad in fights. Consider a higher sens or more space.'
          : turn > 540
            ? 'More than 1.5 turns: plenty of room — maybe more than you use. Fine control may suffer.'
            : 'Comfortable: a 180° flick fits without lifting.'
      }</p>`;
    const realDpi = st.measuredCm > 0 && st.counts > 0 ? st.counts / (st.measuredCm / 2.54) : NaN;
    out('dpicheck').innerHTML = Number.isFinite(realDpi)
      ? `<div class="big-out"><div><span>Real DPI</span><b>${Math.round(realDpi)}</b></div><div><span>Deviation</span><b>${(((realDpi - dpi) / dpi) * 100).toFixed(1)}%</b></div><div><span>Real cm/360</span><b>${cmPer360(sens, realDpi).toFixed(1)}</b></div></div>`
      : '<p class="note">Run the protractor to fill in counts.</p>';
    const hist = store.get().history;
    out('history').innerHTML = hist.length
      ? `<table class="conv"><tbody>${hist
          .slice()
          .reverse()
          .map(
            (r) =>
              `<tr><td>${new Date(r.at).toLocaleString()}</td><td>${r.focus.toUpperCase()} · ${r.rounds} rounds · ${r.dpi} DPI</td><td>${r.base.toFixed(2)} → <b>${r.result.toFixed(2)}</b> · ${cmPer360(r.result, r.dpi).toFixed(1)} cm</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="note">No calibrations yet. Results you save appear here, so you can see whether your number is stable over weeks.</p>';
  };

  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k as keyof ToolState | undefined;
    if (!k) return;
    st[k] = Number(t.value);
    update();
  });

  actions(el, {
    protractor: () =>
      app.play(
        () => new ProtractorDrill(app.game),
        (r) => {
          app.endPlay();
          const d = r.data as { counts: number; rotation: number };
          st.counts = Math.abs(d.counts);
          const inp = el.querySelector('[data-k="counts"]') as HTMLInputElement;
          inp.value = String(st.counts);
          update();
          app.toast(`Recorded ${st.counts} counts over ${Math.abs(d.rotation).toFixed(1)}° of rotation.`);
        },
      ),
  });

  update();
  return { el };
});
