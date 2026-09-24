import { cmPer360, edpi, verticalFovFromOw } from '../../core/sens';
import { DEFAULT_SETTINGS, store, type CrosshairStyle, type FxLevel, type Settings } from '../../core/store';
import { App } from '../app';
import { actions, h, syncRange } from '../dom';
import { crosshairSvg } from '../hud';

const COLORS = ['#3dffc8', '#ffffff', '#ff4b1f', '#f7ff3c', '#ff3df2', '#27e0ff'];

App.register('settings', () => {
  const el = h('<div class="tools settings-grid"></div>');

  const render = () => {
    const s = store.settings;
    const c = s.crosshair;
    const row = (label: string, hint: string, control: string) =>
      `<div class="row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>${control}</div>`;
    const range = (key: string, min: number, max: number, step: number, value: number, fmt = (v: number) => String(v)) =>
      `<label style="display:grid;grid-template-columns:1fr 64px;gap:12px;align-items:center"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-set="${key}"><span class="mono" style="text-align:right;font-size:12px">${fmt(value)}</span></label>`;
    const seg = (key: string, opts: [string, string][], val: string) =>
      `<div class="seg">${opts.map(([v, l]) => `<button class="${v === val ? 'on' : ''}" data-act="seg" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const sw = (key: keyof Settings, on: boolean) =>
      `<label class="switch" style="justify-content:flex-end"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;

    el.innerHTML = `
      <header>
        <div class="kicker rise">Settings</div>
        <h2 class="display rise">Tune the <span class="serif">instrument.</span></h2>
        <p class="lede rise">Match these to Overwatch so what you practise here transfers. Everything saves locally in this browser.</p>
      </header>
      <section class="panel glass span-7 rise">
        <h4><span>Mouse</span><span>${Math.round(edpi(s.sens, s.dpi))} eDPI · ${cmPer360(s.sens, s.dpi).toFixed(1)} cm/360</span></h4>
        ${row('Sensitivity', 'Same scale as Overwatch.', `<input class="input" type="number" step="0.01" min="0.01" max="100" data-set="sens" value="${s.sens}">`)}
        ${row('Mouse DPI', 'What your mouse software is set to.', `<input class="input" type="number" step="50" min="100" max="32000" data-set="dpi" value="${s.dpi}">`)}
        ${row('Raw input', 'Asks the browser for unaccelerated counts (Chromium). Overwatch always uses raw input.', sw('rawInput', s.rawInput))}
        ${row('Invert vertical look', '', sw('invertY', s.invertY))}
        ${row('Browser input scale', 'Leave at 1.00 unless the Protractor shows your 360 is off by a constant factor.', range('inputScale', 0.5, 2, 0.01, s.inputScale, (v) => v.toFixed(2)))}
      </section>
      <section class="panel glass span-5 push-1 rise">
        <h4><span>View</span><span>${verticalFovFromOw(s.fov).toFixed(1)}° vertical</span></h4>
        ${row('Field of view', 'Overwatch horizontal FOV at 16:9. Most players use 103.', range('fov', 80, 103, 1, s.fov))}
        ${row('Weapon model', '', sw('viewmodel', s.viewmodel))}
        ${row('Aim oscilloscope', 'Live error trace, bottom-right.', sw('showScope', s.showScope))}
        ${row('FPS counter', '', sw('showFps', s.showFps))}
      </section>
      <section class="panel glass span-7 rise">
        <h4><span>Crosshair</span></h4>
        ${row('Style', '', seg('crosshair.style', [['cross', 'Cross'], ['crossdot', 'Cross + dot'], ['dot', 'Dot'], ['circle', 'Circle']], c.style))}
        ${row('Colour', '', `<div class="swatches">${COLORS.map((col) => `<button style="background:${col}" class="${col === c.color ? 'on' : ''}" data-act="color" data-v="${col}" aria-label="${col}"></button>`).join('')}</div>`)}
        ${row('Length', '', range('crosshair.length', 2, 16, 1, c.length))}
        ${row('Thickness', '', range('crosshair.thickness', 1, 5, 1, c.thickness))}
        ${row('Gap', '', range('crosshair.gap', 0, 12, 1, c.gap))}
        ${row('Outline', '', sw('crosshair.outline' as keyof Settings, c.outline))}
      </section>
      <section class="span-5 push-1 rise" style="display:grid;gap:16px;align-content:start">
        <div class="xhair-preview">${crosshairSvg(c)}</div>
        <div class="panel glass">
          <h4><span>Graphics &amp; audio</span></h4>
          ${row('Effects', 'Bloom and grade cost a little GPU. Turn off if your FPS drops below your monitor’s refresh rate.', seg('fx', [['full', 'Full'], ['lite', 'Lite'], ['off', 'Off']], s.fx))}
          ${row('Render scale', '', range('renderScale', 0.5, 1, 0.05, s.renderScale, (v) => `${Math.round(v * 100)}%`))}
          ${row('Volume', '', range('volume', 0, 1, 0.05, s.volume, (v) => `${Math.round(v * 100)}%`))}
        </div>
        <div class="actions"><button class="btn ghost small" data-act="reset">Reset to defaults</button></div>
      </section>`;
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(syncRange);
    el.querySelectorAll<HTMLElement>('.rise').forEach((r, i) => r.style.setProperty('--i', String(i)));
  };

  const apply = (key: string, value: unknown) => {
    if (key.startsWith('crosshair.')) {
      const k = key.slice(10);
      store.update((p) => ((p.settings.crosshair as unknown as Record<string, unknown>)[k] = value));
    } else store.setSettings({ [key]: value } as Partial<Settings>);
  };

  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.set;
    if (!key || t.type === 'checkbox') return;
    const v = Number(t.value);
    if (!Number.isFinite(v)) return;
    if (t.type === 'range') {
      syncRange(t);
      const lbl = t.nextElementSibling;
      if (lbl) lbl.textContent = key === 'renderScale' || key === 'volume' ? `${Math.round(v * 100)}%` : key === 'inputScale' ? v.toFixed(2) : String(v);
    }
    if ((key === 'sens' && v > 0) || (key === 'dpi' && v >= 50) || (key !== 'sens' && key !== 'dpi')) apply(key, v);
    const prev = el.querySelector('.xhair-preview');
    if (prev && key.startsWith('crosshair.')) prev.innerHTML = crosshairSvg(store.settings.crosshair);
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.type === 'checkbox' && t.dataset.set) apply(t.dataset.set, t.checked);
    if (t.type === 'number') render();
  });

  actions(el, {
    seg: (b) => {
      const key = b.dataset.key!;
      apply(key, key === 'crosshair.style' ? (b.dataset.v as CrosshairStyle) : (b.dataset.v as FxLevel));
      render();
    },
    color: (b) => {
      apply('crosshair.color', b.dataset.v);
      render();
    },
    reset: () => {
      store.update((p) => (p.settings = structuredClone(DEFAULT_SETTINGS)));
      render();
    },
  });

  render();
  return { el };
});
