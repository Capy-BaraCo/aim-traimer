import { cmPer360, degPerCm, edpi, inchesPer360, STYLE_BANDS, styleFor } from '../../core/sens';
import { store } from '../../core/store';
import { App } from '../app';
import { actions, h } from '../dom';

/** A dial showing how far a 10 cm swipe turns you. */
function swipeDial(deg: number): string {
  const r = 46;
  const c = 56;
  const a = Math.min(deg, 359.9);
  const rad = ((a - 90) * Math.PI) / 180;
  const x = c + r * Math.cos(rad);
  const y = c + r * Math.sin(rad);
  const large = a > 180 ? 1 : 0;
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const tr = ((i * 10 - 90) * Math.PI) / 180;
    const r0 = i % 9 === 0 ? 38 : 42;
    ticks += `<line x1="${c + r0 * Math.cos(tr)}" y1="${c + r0 * Math.sin(tr)}" x2="${c + 50 * Math.cos(tr)}" y2="${c + 50 * Math.sin(tr)}" stroke="rgb(233 225 210 / ${i % 9 === 0 ? 0.6 : 0.22})" stroke-width="1"/>`;
  }
  return `<svg width="112" height="112" viewBox="0 0 112 112" aria-label="10 cm swipe dial">
    ${ticks}
    <path d="M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${large} 1 ${x} ${y} Z" fill="rgb(255 75 31 / 0.22)" stroke="#ff4b1f" stroke-width="1.5"/>
    <line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#ff4b1f" stroke-width="2"/>
    <circle cx="${c}" cy="${c}" r="3" fill="#e9e1d2"/>
    <text x="${c}" y="${c + 22}" text-anchor="middle" font-family="Martian Mono, monospace" font-size="9" fill="#e9e1d2">${Math.round(deg)}°</text>
  </svg>`;
}

App.register('home', (app) => {
  const s = store.settings;
  const cm = cmPer360(s.sens, s.dpi);
  const last = store.get().history.at(-1);
  const el = h(`
    <div class="home">
      <section class="home-hero">
        <div class="kicker rise">Overwatch · sensitivity calibration &amp; aim field manual</div>
        <h1 class="display rise">Find your<span class="row2"><span class="serif">true</span>bearing.</span></h1>
        <p class="lede rise">Blind A/B trials using the community's PSA method, inside a range that moves like Overwatch — 5.5&nbsp;m/s strafes with instant direction changes, 0.0066° per mouse count, 103° field of view.</p>
        <div class="cta rise">
          <button class="btn" data-act="cal">Begin calibration <span class="arr">→</span></button>
          <button class="btn ghost" data-act="manual">Open the field manual</button>
        </div>
        <div class="home-facts rise">
          <div><b>7</b>blind rounds</div>
          <div><b>±50%</b>opening window</div>
          <div><b>1/128</b>final precision</div>
          <div><b>9 · 7</b>chapters · drills</div>
        </div>
        <div class="ticker rise">
          <span>0.0066° / COUNT / SENS</span>
          <span>5.5 M/S STRAFE · 4.95 BACKPEDAL · 3.0 CROUCH</span>
          <span>JUMP 5.72 M/S · G 17.5 M/S²</span>
          <span>103° HFOV → 70.5° VFOV</span>
        </div>
      </section>

      <section class="instruments">
        <button class="inst rise" data-act="cal"><span class="n">01</span><span><h3>Calibrate</h3><p>PSA protocol · blind α/β samples · certificate</p></span><span class="go">→</span></button>
        <button class="inst rise" data-act="manual"><span class="n">02</span><span><h3>Field manual</h3><p>Placement · tracking · flicks · switching · precision</p></span><span class="go">→</span></button>
        <button class="inst rise" data-act="range"><span class="n">03</span><span><h3>Free range</h3><p>Sandbox bots · live sens nudge · movement practice</p></span><span class="go">→</span></button>
        <button class="inst rise" data-act="tools"><span class="n">04</span><span><h3>Instruments</h3><p>Converter · mousepad fit · DPI check</p></span><span class="go">→</span></button>
        <div class="readout glass rise">
          ${swipeDial(degPerCm(s.sens, s.dpi) * 10)}
          <div>
            <div class="kicker" style="margin-bottom:8px">Your instrument · 10 cm swipe</div>
            <table>
              <tr><td>SENSITIVITY</td><td>${s.sens.toFixed(2)}</td></tr>
              <tr><td>DPI / eDPI</td><td>${s.dpi} / ${Math.round(edpi(s.sens, s.dpi))}</td></tr>
              <tr><td>CM · IN / 360</td><td>${cm.toFixed(1)} · ${inchesPer360(s.sens, s.dpi).toFixed(1)}</td></tr>
              <tr><td>STYLE</td><td>${STYLE_BANDS[styleFor(cm)].label.toUpperCase()}</td></tr>
              <tr><td>LAST CALIBRATION</td><td>${last ? `${last.result.toFixed(2)} · ${new Date(last.at).toLocaleDateString()}` : '—'}</td></tr>
            </table>
          </div>
        </div>
      </section>
    </div>`);
  actions(el, {
    cal: () => app.go('calibrate'),
    manual: () => app.go('manual'),
    range: () => app.go('range'),
    tools: () => app.go('tools'),
  });
  return { el };
});
