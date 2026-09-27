/**
 * Inline-SVG charts for the debrief, Logbook and certificate.
 *
 * Rules (from the dataviz method): thin marks, 2px lines, >=8px dots with a 2px surface ring,
 * solid hairline grids, a legend whenever there are 2+ series, text in text colours (never the
 * series colour), hover tooltips via [data-tip], and a table view for the dense charts.
 * Series colours were validated for CVD separation and contrast on both surfaces.
 */

import { BUCKET_LABEL, type FlickRecord, type FlickSummary, type TrackingPoint } from '../core/analytics';
import { esc } from './dom';

export type Surface = 'dark' | 'light';

interface Theme {
  surface: string;
  ink: string;
  muted: string;
  grid: string;
  band: string;
  short: string;
  wide: string;
  under: string;
  over: string;
  neutral: string;
}

const THEMES: Record<Surface, Theme> = {
  dark: {
    surface: '#1d1a16',
    ink: '#e9e1d2',
    muted: '#9d9280',
    grid: 'rgba(233,225,210,0.12)',
    band: 'rgba(233,225,210,0.07)',
    short: '#ff4b1f',
    wide: '#7282f5',
    under: '#7282f5',
    over: '#ff4b1f',
    neutral: '#6e665a',
  },
  light: {
    surface: '#e9e1d2',
    ink: '#14120f',
    muted: '#6c6356',
    grid: 'rgba(20,18,15,0.14)',
    band: 'rgba(20,18,15,0.06)',
    short: '#e0421a',
    wide: '#3148ff',
    under: '#3148ff',
    over: '#e0421a',
    neutral: '#a39985',
  },
};

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const tip = (s: string) => `data-tip="${esc(s)}" tabindex="0"`;
const text = (x: number, y: number, s: string, fill: string, anchor = 'start', extra = '') =>
  `<text x="${x}" y="${y}" fill="${fill}" text-anchor="${anchor}" ${extra}>${esc(s)}</text>`;

function svg(w: number, h: number, body: string, label: string): string {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" style="--w:${w}px" role="img" aria-label="${esc(label)}" font-family="Martian Mono, monospace" font-size="10">${body}</svg>`;
}

function legend(items: { color: string; label: string; kind?: 'dot' | 'line' | 'rect' }[], t: Theme): string {
  return `<div class="chart-legend">${items
    .map(
      (i) =>
        `<span><i class="k-${i.kind ?? 'dot'}" style="background:${i.color}"></i><span style="color:${t.muted}">${esc(i.label)}</span></span>`,
    )
    .join('')}</div>`;
}

const judgedOf = (records: readonly FlickRecord[]) => records.filter((r) => r.cls !== 'micro' && Number.isFinite(r.endAlong));

/**
 * Landing map: where each flick's first movement stopped, relative to the target.
 * x = how far along the way you got (100% = on target), y = sideways drift.
 */
export function landingMap(records: readonly FlickRecord[], surface: Surface = 'dark', title = 'Where your first movement stopped'): string {
  const t = THEMES[surface];
  const W = 560;
  const H = 250;
  const L = 44;
  const R = 16;
  const T = 26;
  const B = 36;
  const x0 = 0.5;
  const x1 = 1.5;
  const yr = 0.3;
  const sx = (v: number) => L + ((clamp(v, x0, x1) - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v: number) => T + ((yr - clamp(v, -yr, yr)) / (2 * yr)) * (H - T - B);
  const judged = judgedOf(records);
  const tol = judged.length ? judged.reduce((s, r) => s + r.radius / r.distance, 0) / judged.length : 0.04;
  let body = `<rect x="${sx(1 - tol)}" y="${T}" width="${sx(1 + tol) - sx(1 - tol)}" height="${H - T - B}" fill="${t.band}"/>`;
  for (const v of [0.6, 0.8, 1.0, 1.2, 1.4]) {
    body += `<line x1="${sx(v)}" y1="${T}" x2="${sx(v)}" y2="${H - B}" stroke="${v === 1 ? t.muted : t.grid}" stroke-width="1"/>`;
    body += text(sx(v), H - B + 16, `${Math.round(v * 100)}%`, t.muted, 'middle');
  }
  body += `<line x1="${L}" y1="${sy(0)}" x2="${W - R}" y2="${sy(0)}" stroke="${t.grid}" stroke-width="1"/>`;
  body += text(L, 14, '← STOPPED SHORT', t.muted);
  body += text(W - R, 14, 'WENT PAST →', t.muted, 'end');
  body += text(sx(1), 14, 'TARGET', t.ink, 'middle');
  body += text((L + W - R) / 2, H - 4, '% of the distance covered by your first movement', t.muted, 'middle');
  for (const r of judged) {
    const c = r.bucket === 'short' ? t.short : t.wide;
    const side = r.endPerp * r.distance;
    const desc = `${r.bucket === 'short' ? 'Short' : r.bucket === 'mid' ? 'Medium' : 'Wide'} flick ${Math.round(r.distance)}° ${r.dir} · first move stopped at ${pct(r.endAlong)} · ${f1(Math.abs(side))}° ${side >= 0 ? 'off-line (anticlockwise)' : 'off-line (clockwise)'} · ${r.hit ? `hit in ${Math.round(r.totalMs)} ms` : 'missed'}`;
    const cx = sx(r.endAlong);
    const cy = sy(r.endPerp);
    body += `<g class="mark" ${tip(desc)}><circle cx="${cx}" cy="${cy}" r="11" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="${r.hit ? c : 'none'}" stroke="${r.hit ? t.surface : c}" stroke-width="2"/></g>`;
  }
  const shortN = judged.filter((r) => r.bucket === 'short').length;
  const wideN = judged.length - shortN;
  const leg: { color: string; label: string }[] = [];
  if (shortN) leg.push({ color: t.short, label: `Short flicks (${shortN})` });
  if (wideN) leg.push({ color: t.wide, label: `Medium & wide flicks (${wideN})` });
  leg.push({ color: 'transparent', label: 'hollow = missed target' });
  const table = judged.length
    ? `<details class="chart-table"><summary>Show as table</summary><table><thead><tr><th>#</th><th>Range</th><th>Distance</th><th>First move stopped at</th><th>Result</th><th>Time</th></tr></thead><tbody>${judged
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td><td>${esc(r.bucket)}</td><td>${Math.round(r.distance)}°</td><td>${pct(r.endAlong)}</td><td>${esc(r.cls)}</td><td>${r.hit ? `${Math.round(r.totalMs)} ms` : 'miss'}</td></tr>`,
        )
        .join('')}</tbody></table></details>`
    : '';
  return `<figure class="chart-fig" data-chart="landing"><figcaption>${esc(title)}</figcaption>${svg(W, H, body, title)}${legend(leg, t)}${table}</figure>`;
}

/** Diverging bars: how far short (−) or past (+) you land, for each range of flick. */
export function rangeBars(s: FlickSummary, surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  const rows = (['short', 'mid', 'wide'] as const).filter((b) => s.buckets[b].n > 0);
  if (!rows.length) return '';
  const W = 560;
  const rowH = 34;
  const H = 30 + rows.length * rowH + 10;
  const L = 170;
  const R = 70;
  const mid = L + (W - L - R) / 2;
  const span = (W - L - R) / 2;
  const lim = 0.3;
  let body = `<line x1="${mid}" y1="18" x2="${mid}" y2="${H - 8}" stroke="${t.muted}" stroke-width="1"/>`;
  body += text(mid - span, 12, '30% SHORT', t.muted, 'start');
  body += text(mid, 12, 'ON TARGET', t.ink, 'middle');
  body += text(mid + span, 12, '30% PAST', t.muted, 'end');
  rows.forEach((b, i) => {
    const st = s.buckets[b];
    const v = clamp(st.landing - 1, -lim, lim);
    const y = 30 + i * rowH;
    const w = (Math.abs(v) / lim) * span;
    const x = v >= 0 ? mid : mid - w;
    const col = v >= 0 ? t.over : t.under;
    const r = Math.min(4, w / 2);
    // Rounded data end, square at the baseline.
    const path =
      v >= 0
        ? `M ${x} ${y} h ${Math.max(0, w - r)} q ${r} 0 ${r} ${r} v ${16 - 2 * r} q 0 ${r} ${-r} ${r} h ${-Math.max(0, w - r)} z`
        : `M ${x + w} ${y} h ${-Math.max(0, w - r)} q ${-r} 0 ${-r} ${r} v ${16 - 2 * r} q 0 ${r} ${r} ${r} h ${Math.max(0, w - r)} z`;
    const label = `${BUCKET_LABEL[b]} · ${st.n} flicks`;
    const val = `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(st.landing - 1) * 100)}% ${Math.abs(st.landing - 1) < 0.03 ? '(on target)' : v >= 0 ? 'past' : 'short'}`;
    body += text(0, y + 12, label, t.ink);
    body += `<g class="mark" ${tip(`${label}: first move stops at ${pct(st.landing)} of the distance · median hit time ${Math.round(st.totalMs)} ms`)}><rect x="${L}" y="${y - 6}" width="${W - L - R}" height="28" fill="transparent"/>${w > 0.5 ? `<path d="${path}" fill="${col}"/>` : ''}</g>`;
    body += text(W - R + 8, y + 12, val, t.ink);
  });
  return `<figure class="chart-fig" data-chart="range"><figcaption>Short vs long flicks</figcaption>${svg(W, H, body, 'Landing by flick range')}${legend(
    [
      { color: t.under, label: 'stops short', kind: 'rect' },
      { color: t.over, label: 'goes past', kind: 'rect' },
    ],
    t,
  )}</figure>`;
}

/** Four arms: landing by direction of the flick. */
export function directionChart(s: FlickSummary, surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  const W = 340;
  const H = 240;
  const cx = W / 2;
  const cy = H / 2;
  const full = 62; // radius of the 100% ring; bars can reach 140%
  const out = full * 1.4 + 10; // labels sit beyond the longest possible bar
  let body = `<circle cx="${cx}" cy="${cy}" r="${full}" fill="none" stroke="${t.muted}" stroke-width="1"/>`;
  body += `<circle cx="${cx}" cy="${cy}" r="${full * 0.8}" fill="none" stroke="${t.grid}" stroke-width="1"/>`;
  body += text(cx + full * 0.72 + 4, cy - full * 0.72 - 4, '100%', t.muted, 'start');
  const dirs = [
    ['right', 1, 0, 'start'],
    ['left', -1, 0, 'end'],
    ['up', 0, -1, 'middle'],
    ['down', 0, 1, 'middle'],
  ] as const;
  for (const [d, dx, dy, anchor] of dirs) {
    const st = s.dirs[d];
    const lx = cx + dx * out;
    const ly = cy + dy * out + (dy > 0 ? 10 : dy < 0 ? -2 : 4);
    if (!st.n) {
      body += text(lx, ly, `${d} —`, t.muted, anchor);
      continue;
    }
    const len = clamp(st.landing, 0.4, 1.4) * full;
    const col = st.landing >= 1 ? t.over : t.under;
    body += `<g class="mark" ${tip(`Flicks to the ${d} (${st.n}): first move stops at ${pct(st.landing)}`)}><line x1="${cx}" y1="${cy}" x2="${cx + dx * len}" y2="${cy + dy * len}" stroke="${col}" stroke-width="6" stroke-linecap="round"/><circle cx="${cx + dx * len}" cy="${cy + dy * len}" r="12" fill="transparent"/></g>`;
    body += text(lx, ly, `${d} ${pct(st.landing)}`, t.ink, anchor);
  }
  body += `<circle cx="${cx}" cy="${cy}" r="3" fill="${t.ink}"/>`;
  // This figure is drawn smaller than the others; bump the type so it reads at the same size.
  body = `<g font-size="11">${body}</g>`;
  return `<figure class="chart-fig" data-chart="direction"><figcaption>By direction</figcaption>${svg(W, H, body, 'Landing by direction')}${legend(
    [
      { color: t.under, label: 'stops short', kind: 'rect' },
      { color: t.over, label: 'goes past', kind: 'rect' },
    ],
    t,
  )}</figure>`;
}

/** Where the time goes on an average hit: waiting, throwing, fixing. */
export function timeSplit(s: FlickSummary, surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  const parts = [
    { k: 'React', v: s.reactionMs, c: t.neutral, d: 'before your hand starts moving' },
    { k: 'Flick', v: s.ballisticMs, c: t.short, d: 'the main movement' },
    { k: 'Fix', v: s.correctionMs, c: t.wide, d: 'small corrections + click' },
  ].filter((p) => Number.isFinite(p.v) && p.v > 0);
  const total = parts.reduce((a, p) => a + p.v, 0);
  if (!total) return '';
  const W = 560;
  const H = 64;
  let x = 0;
  let body = '';
  parts.forEach((p, i) => {
    const w = (p.v / total) * W - (i < parts.length - 1 ? 2 : 0);
    body += `<g class="mark" ${tip(`${p.k}: ${Math.round(p.v)} ms — ${p.d}`)}><rect x="${x}" y="8" width="${Math.max(1, w)}" height="22" rx="${i === parts.length - 1 ? 4 : 0}" fill="${p.c}"/></g>`;
    const label = `${p.k} ${Math.round(p.v)} ms`;
    body += text(x + 2, 48, label, t.ink, 'start');
    x += w + 2;
  });
  return `<figure class="chart-fig" data-chart="time"><figcaption>Where the time goes (median hit)</figcaption>${svg(W, H, body, 'Time split')}${legend(
    parts.map((p) => ({ color: p.c, label: `${p.k} — ${p.d}`, kind: 'rect' as const })),
    t,
  )}</figure>`;
}

/** Average speed shape of your flicks: a good one peaks in the middle. */
export function speedShape(s: FlickSummary, surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  if (!s.profile.some((v) => v > 0)) return '';
  const W = 260;
  const H = 140;
  const L = 8;
  const B = 24;
  const T = 14;
  const n = s.profile.length;
  const sx = (i: number) => L + (i / (n - 1)) * (W - 2 * L);
  const sy = (v: number) => T + (1 - clamp(v, 0, 1.1) / 1.1) * (H - T - B);
  let line = '';
  s.profile.forEach((v, i) => (line += `${i ? 'L' : 'M'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)} `));
  const area = `${line} L ${sx(n - 1)} ${sy(0)} L ${sx(0)} ${sy(0)} Z`;
  let body = `<line x1="${L}" y1="${sy(0)}" x2="${W - L}" y2="${sy(0)}" stroke="${t.grid}" stroke-width="1"/>`;
  body += `<line x1="${W / 2}" y1="${T}" x2="${W / 2}" y2="${sy(0)}" stroke="${t.grid}" stroke-width="1"/>`;
  body += `<path d="${area}" fill="${t.short}" opacity="0.12"/><path d="${line}" fill="none" stroke="${t.short}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const pk = clamp(s.peakAt, 0, 1);
  body += `<g class="mark" ${tip(`Your flicks reach top speed ${pct(pk)} of the way through (ideal ≈ 50%)`)}><circle cx="${L + pk * (W - 2 * L)}" cy="${sy(1)}" r="10" fill="transparent"/><circle cx="${L + pk * (W - 2 * L)}" cy="${sy(1)}" r="4.5" fill="${t.short}" stroke="${t.surface}" stroke-width="2"/></g>`;
  body += text(L, H - 6, 'START', t.muted);
  body += text(W / 2, H - 6, 'MIDDLE', t.muted, 'middle');
  body += text(W - L, H - 6, 'ARRIVAL', t.muted, 'end');
  return `<figure class="chart-fig" data-chart="speed"><figcaption>Speed through the flick (peak at ${pct(pk)})</figcaption>${svg(W, H, body, 'Flick speed profile')}</figure>`;
}

/** Tracking: horizontal error over time, with the target's width as a band. */
export function trackingChart(series: readonly TrackingPoint[], surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  if (series.length < 4) return '';
  const W = 560;
  const H = 180;
  const L = 34;
  const R = 8;
  const T = 12;
  const B = 28;
  const t0 = series[0].t;
  const t1 = series[series.length - 1].t;
  const lim = 4;
  const sx = (v: number) => L + ((v - t0) / Math.max(1e-6, t1 - t0)) * (W - L - R);
  const sy = (v: number) => T + ((lim - clamp(v, -lim, lim)) / (2 * lim)) * (H - T - B);
  let band = '';
  series.forEach((p, i) => (band += `${i ? 'L' : 'M'} ${sx(p.t).toFixed(1)} ${sy(p.r).toFixed(1)} `));
  for (let i = series.length - 1; i >= 0; i--) band += `L ${sx(series[i].t).toFixed(1)} ${sy(-series[i].r).toFixed(1)} `;
  let line = '';
  series.forEach((p, i) => (line += `${i ? 'L' : 'M'} ${sx(p.t).toFixed(1)} ${sy(p.e).toFixed(1)} `));
  let body = '';
  for (const g of [-4, -2, 0, 2, 4]) {
    body += `<line x1="${L}" y1="${sy(g)}" x2="${W - R}" y2="${sy(g)}" stroke="${g === 0 ? t.muted : t.grid}" stroke-width="1"/>`;
    body += text(L - 6, sy(g) + 3, `${g > 0 ? '+' : ''}${g}°`, t.muted, 'end');
  }
  body += `<path d="${band} Z" fill="${t.band}"/>`;
  body += `<path d="${line}" fill="none" stroke="${t.short}" stroke-width="2" stroke-linejoin="round"/>`;
  // Crosshair-style hit columns.
  const cols = 60;
  for (let c = 0; c < cols; c++) {
    const idx = Math.min(series.length - 1, Math.round((c / (cols - 1)) * (series.length - 1)));
    const p = series[idx];
    const x = L + (c / cols) * (W - L - R);
    body += `<rect class="mark col" x="${x}" y="${T}" width="${(W - L - R) / cols}" height="${H - T - B}" fill="transparent" ${tip(`${(p.t - t0).toFixed(1)} s · ${Math.abs(p.e).toFixed(2)}° ${p.e >= 0 ? 'target to the right' : 'target to the left'} · ${p.on ? 'on target' : 'off target'}`)}/>`;
  }
  body += text(L, H - 6, '0 s', t.muted);
  body += text(W - R, H - 6, `${(t1 - t0).toFixed(0)} s`, t.muted, 'end');
  return `<figure class="chart-fig"><figcaption>Your crosshair vs the target over time (0° = dead centre)</figcaption>${svg(W, H, body, 'Tracking error over time')}${legend(
    [
      { color: t.short, label: 'horizontal error', kind: 'line' },
      { color: t.band, label: 'target width', kind: 'rect' },
    ],
    t,
  )}</figure>`;
}

/** Corner Watch: where the crosshair was (relative to the head) when each head appeared. */
export function placementChart(points: readonly { x: number; y: number }[], surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  if (!points.length) return '';
  const W = 560;
  const H = 240;
  const lim = Math.max(6, Math.ceil(Math.max(...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y) * 1.8))) / 5) * 5);
  const sx = (v: number) => W / 2 + (clamp(v, -lim, lim) / lim) * (W / 2 - 20);
  const sy = (v: number) => H / 2 - (clamp(v, -lim / 1.8, lim / 1.8) / (lim / 1.8)) * (H / 2 - 20);
  let body = `<line x1="20" y1="${H / 2}" x2="${W - 20}" y2="${H / 2}" stroke="${t.grid}"/><line x1="${W / 2}" y1="12" x2="${W / 2}" y2="${H - 12}" stroke="${t.grid}"/>`;
  body += `<circle cx="${W / 2}" cy="${H / 2}" r="9" fill="none" stroke="${t.ink}" stroke-width="2"/>`;
  body += text(W / 2 + 14, H / 2 - 12, 'HEAD', t.ink);
  body += text(W - 20, H / 2 - 6, `${lim}° right`, t.muted, 'end');
  body += text(20, H / 2 - 6, `${lim}° left`, t.muted);
  body += text(W / 2 + 6, 22, 'above', t.muted);
  body += text(W / 2 + 6, H - 14, 'below', t.muted);
  points.forEach((p, i) => {
    body += `<g class="mark" ${tip(`Peek ${i + 1}: crosshair ${Math.abs(p.x).toFixed(1)}° ${p.x >= 0 ? 'right' : 'left'} and ${Math.abs(p.y).toFixed(1)}° ${p.y >= 0 ? 'above' : 'below'} the head`)}><circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="11" fill="transparent"/><circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4.5" fill="${t.short}" stroke="${t.surface}" stroke-width="2"/></g>`;
  });
  return `<figure class="chart-fig"><figcaption>Where your crosshair was when each head appeared</figcaption>${svg(W, H, body, 'Crosshair placement')}</figure>`;
}

/** Aim fingerprint: 0..1 per skill. */
export function radar(axes: { label: string; value: number | null }[], surface: Surface = 'dark'): string {
  const t = THEMES[surface];
  const W = 380;
  const H = 290;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 100;
  const n = axes.length;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  let body = '';
  for (const k of [0.25, 0.5, 0.75, 1]) {
    body += `<polygon points="${axes.map((_, i) => pt(i, R * k).join(',')).join(' ')}" fill="none" stroke="${k === 1 ? t.muted : t.grid}" stroke-width="1"/>`;
  }
  axes.forEach((a, i) => {
    const [x, y] = pt(i, R);
    body += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${t.grid}"/>`;
    const [lx, ly] = pt(i, R + 12);
    const anchor = lx > cx + 6 ? 'start' : lx < cx - 6 ? 'end' : 'middle';
    const dy = ly < cy - R * 0.9 ? -4 : ly > cy + R * 0.6 ? 12 : 4;
    body += text(lx, ly + dy, a.label.toUpperCase(), a.value === null ? t.muted : t.ink, anchor);
  });
  const vals = axes.map((a) => clamp(a.value ?? 0, 0, 1));
  body += `<polygon points="${vals.map((v, i) => pt(i, R * Math.max(0.04, v)).join(',')).join(' ')}" fill="${t.short}" fill-opacity="0.12" stroke="${t.short}" stroke-width="2" stroke-linejoin="round"/>`;
  vals.forEach((v, i) => {
    const [x, y] = pt(i, R * Math.max(0.04, v));
    const a = axes[i];
    body += `<g class="mark" ${tip(`${a.label}: ${a.value === null ? 'no data yet' : `${Math.round(v * 100)} / 100`}`)}><circle cx="${x}" cy="${y}" r="11" fill="transparent"/><circle cx="${x}" cy="${y}" r="4.5" fill="${a.value === null ? t.neutral : t.short}" stroke="${t.surface}" stroke-width="2"/></g>`;
  });
  return svg(W, H, body, 'Aim fingerprint');
}

/** Small trend line for a series of scores. */
export function sparkline(values: readonly number[], surface: Surface = 'dark', w = 140, h = 36): string {
  const t = THEMES[surface];
  if (values.length < 2) return '';
  const max = Math.max(100, ...values);
  const sx = (i: number) => 3 + (i / (values.length - 1)) * (w - 6);
  const sy = (v: number) => 3 + (1 - v / max) * (h - 6);
  let d = '';
  values.forEach((v, i) => (d += `${i ? 'L' : 'M'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)} `));
  const last = values[values.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="Score trend"><path d="${d}" fill="none" stroke="${t.neutral}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx(values.length - 1)}" cy="${sy(last)}" r="4" fill="${t.short}" stroke="${t.surface}" stroke-width="2"/></svg>`;
}

export function stars(n: number, of = 3, cls = ''): string {
  return `<span class="stars ${cls}" aria-label="${n} of ${of} stars">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
}

/** One shared tooltip for every [data-tip] mark inside `root`. Hover and keyboard focus. */
export function installTooltips(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'chart-tip';
  root.appendChild(el);
  const show = (target: Element, x: number, y: number) => {
    const s = target.getAttribute('data-tip');
    if (!s) return;
    el.textContent = s;
    el.classList.add('on');
    const r = root.getBoundingClientRect();
    const tw = el.offsetWidth;
    el.style.left = `${Math.min(r.width - tw - 8, Math.max(8, x - r.left + 14))}px`;
    el.style.top = `${Math.max(8, y - r.top - 38)}px`;
  };
  root.addEventListener('pointermove', (e) => {
    const m = (e.target as Element).closest?.('[data-tip]');
    if (m) show(m, e.clientX, e.clientY);
    else el.classList.remove('on');
  });
  root.addEventListener('pointerleave', () => el.classList.remove('on'));
  root.addEventListener('focusin', (e) => {
    const m = (e.target as Element).closest?.('[data-tip]');
    if (!m) return;
    const b = m.getBoundingClientRect();
    show(m, b.left + b.width / 2, b.top);
  });
  root.addEventListener('focusout', () => el.classList.remove('on'));
}
