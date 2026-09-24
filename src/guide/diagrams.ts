/**
 * Inline SVG diagrams for the Field Manual. Styling comes from CSS classes (see manual.css section
 * in main.css) so they follow the palette. Numbers are live where it teaches something.
 */

import { STYLE_BANDS } from '../core/sens';

const W = 640;

const svg = (h: number, body: string) =>
  `<svg viewBox="0 0 ${W} ${h}" role="img" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const t = (x: number, y: number, s: string, cls = '', anchor = 'start') =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;

export function ruler360(cm: number): string {
  const span = Math.max(40, Math.ceil(cm / 10) * 10);
  const x0 = 40;
  const x1 = 600;
  const sx = (v: number) => x0 + ((x1 - x0) * v) / span;
  let ticks = '';
  for (let i = 0; i <= span; i++) {
    const len = i % 10 === 0 ? 16 : i % 5 === 0 ? 10 : 5;
    ticks += `<line x1="${sx(i)}" y1="70" x2="${sx(i)}" y2="${70 + len}" class="s-line"/>`;
    if (i % 10 === 0) ticks += t(sx(i), 102, `${i}`, '', 'middle');
  }
  const half = sx(cm / 2);
  const full = sx(cm);
  // Aim-style band
  const b0 = 15;
  const b1 = 70;
  const bx = (v: number) => x0 + ((x1 - x0) * (Math.min(b1, Math.max(b0, v)) - b0)) / (b1 - b0);
  const band = (Object.keys(STYLE_BANDS) as (keyof typeof STYLE_BANDS)[])
    .map((k, i) => {
      const [a, b] = STYLE_BANDS[k].range;
      const op = [0.12, 0.22, 0.34][i];
      return `<rect x="${bx(a)}" y="170" width="${bx(b) - bx(a)}" height="22" style="fill: rgb(233 225 210 / ${op})"/>${t((bx(a) + bx(b)) / 2, 185, STYLE_BANDS[k].label.toUpperCase(), 'b', 'middle')}`;
    })
    .join('');
  const you = bx(cm);
  return svg(
    240,
    `
    ${t(40, 30, 'MOUSE TRAVEL FOR ONE FULL TURN (CM)')}
    <rect x="${x0}" y="46" width="${full - x0}" height="14" class="f-sig" opacity="0.9"/>
    <rect x="${x0}" y="46" width="${half - x0}" height="14" class="f-bone" opacity="0.9"/>
    ${t(half, 40, `180° · ${(cm / 2).toFixed(1)} CM`, 'b', 'middle')}
    ${t(full, 40, `360° · ${cm.toFixed(1)} CM`, 'sig', 'end')}
    <line x1="${x0}" y1="70" x2="${x1}" y2="70" class="s-line"/>
    ${ticks}
    ${t(40, 150, 'WHERE THAT SITS (CM/360)')}
    <line x1="${x0}" y1="192" x2="${x1}" y2="192" class="s-line"/>
    ${band}
    <path d="M ${you} 196 l -7 12 h 14 z" class="f-sig"/>
    ${t(you, 226, `YOU · ${cm.toFixed(1)}`, 'sig', 'middle')}
    ${t(x0, 214, `${b0}`)}${t(x1, 214, `${b1}+`, '', 'end')}
  `,
  );
}

export function funnel(): string {
  const rows = 7;
  const cx = 360;
  let body = '';
  let lo = 120;
  let hi = 600;
  const target = 372;
  for (let r = 0; r < rows; r++) {
    const y = 34 + r * 28;
    body += `<line x1="${lo}" y1="${y}" x2="${hi}" y2="${y}" class="s-bone" stroke-width="6"/>`;
    body += t(40, y + 4, `R${r + 1}`, 'b');
    body += t(80, y + 4, `±${(50 / 2 ** r).toFixed(r > 3 ? 1 : 0)}%`);
    const mid = (lo + hi) / 2;
    const pickLow = target < mid;
    body += `<circle cx="${pickLow ? lo : hi}" cy="${y}" r="5" class="f-sig"/>`;
    if (pickLow) hi = mid;
    else lo = mid;
  }
  body += `<line x1="${target}" y1="18" x2="${target}" y2="${34 + rows * 28}" class="s-sig" stroke-dasharray="3 4"/>`;
  body += t(target + 8, 242, 'YOUR SENSITIVITY', 'sig');
  body += t(cx + 110, 22, '● = the side you kept', '');
  return svg(250, body);
}

export function placement(): string {
  return svg(
    250,
    `
    <line x1="20" y1="214" x2="620" y2="214" class="s-line"/>
    <rect x="40" y="40" width="170" height="174" class="f-ink2"/>
    <rect x="40" y="40" width="170" height="174" class="s-line"/>
    ${t(125, 130, 'COVER', 'b', 'middle')}
    <g class="figure">
      <rect x="196" y="112" width="30" height="100" rx="15" class="f-sig" opacity="0.85"/>
      <circle cx="211" cy="92" r="13" class="f-sig"/>
    </g>
    <g transform="translate(470 196)">
      <circle r="11" class="s-cob"/><line x1="-18" x2="18" class="s-cob"/><line y1="-18" y2="18" class="s-cob"/>
    </g>
    <path d="M 462 190 Q 360 80 226 94" class="s-cob" stroke-dasharray="5 5" marker-end="url(#ah)"/>
    ${t(470, 236, 'FLOOR / OPEN SPACE → BIG FLICK', 'cob', 'middle')}
    <g transform="translate(232 92)">
      <circle r="9" class="s-sig"/><line x1="-14" x2="14" class="s-sig"/><line y1="-14" y2="14" class="s-sig"/>
    </g>
    ${t(250, 62, 'EDGE + HEAD HEIGHT → TINY ADJUST', 'sig')}
    <line x1="232" y1="70" x2="232" y2="80" class="s-sig"/>
    <line x1="20" y1="92" x2="620" y2="92" class="s-hair" stroke-dasharray="2 6"/>
    ${t(620, 86, 'HEAD HEIGHT', '', 'end')}
    <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="f-cob"/></marker></defs>
  `,
  );
}

export function trackingCurve(cm360: number): string {
  const x0 = 60;
  const x1 = 600;
  const y0 = 200;
  const y1 = 30;
  const dMin = 3;
  const dMax = 30;
  const vMax = 110;
  const sx = (d: number) => x0 + ((x1 - x0) * (d - dMin)) / (dMax - dMin);
  const sy = (v: number) => y0 - ((y0 - y1) * Math.min(v, vMax)) / vMax;
  const deg = (d: number) => ((5.5 / d) * 180) / Math.PI;
  let path = '';
  for (let d = dMin; d <= dMax; d += 0.25) path += `${path ? 'L' : 'M'} ${sx(d).toFixed(1)} ${sy(deg(d)).toFixed(1)} `;
  const marks = [5, 10, 20]
    .map((d) => {
      const v = deg(d);
      const cms = (v * cm360) / 360;
      return `<circle cx="${sx(d)}" cy="${sy(v)}" r="5" class="f-sig"/>
        ${t(sx(d) + 10, sy(v) - 10, `${d} M → ${v.toFixed(0)}°/S`, 'b')}
        ${t(sx(d) + 10, sy(v) + 6, `≈ ${cms.toFixed(1)} CM/S OF MOUSE`, '')}`;
    })
    .join('');
  let grid = '';
  for (let v = 0; v <= vMax; v += 20) grid += `<line x1="${x0}" y1="${sy(v)}" x2="${x1}" y2="${sy(v)}" class="s-hair"/>${t(x0 - 8, sy(v) + 3, `${v}`, '', 'end')}`;
  for (let d = 5; d <= dMax; d += 5) grid += t(sx(d), y0 + 18, `${d}`, '', 'middle');
  return svg(
    240,
    `${grid}
    <path d="${path}" class="s-sig" stroke-width="2.5"/>
    ${marks}
    ${t(x0, 16, 'ANGULAR SPEED OF A 5.5 M/S STRAFE (°/S) vs DISTANCE (M)')}
    ${t(x1, 236, 'DISTANCE (M)', '', 'end')}`,
  );
}

export function flickProfile(): string {
  const x0 = 50;
  const x1 = 610;
  const y0 = 200;
  const yT = 80;
  const sx = (u: number) => x0 + (x1 - x0) * u;
  const sy = (p: number) => y0 - (y0 - yT) * p;
  const curve = (end: number, settle: boolean) => {
    let d = '';
    for (let u = 0; u <= 1.0001; u += 0.01) {
      let p: number;
      if (u < 0.45) {
        const x = u / 0.45;
        p = end * (10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5);
      } else if (settle) {
        const x = Math.min(1, (u - 0.55) / 0.3);
        p = u < 0.55 ? end : end + (1 - end) * (x * x * (3 - 2 * x));
      } else p = end;
      d += `${d ? 'L' : 'M'} ${sx(u).toFixed(1)} ${sy(p).toFixed(1)} `;
    }
    return d;
  };
  return svg(
    240,
    `
    <rect x="${x0}" y="${sy(1.06)}" width="${x1 - x0}" height="${sy(0.94) - sy(1.06)}" style="fill: rgb(255 75 31 / 0.12)"/>
    <line x1="${x0}" y1="${sy(1)}" x2="${x1}" y2="${sy(1)}" class="s-sig" stroke-dasharray="4 4"/>
    ${t(x1, sy(1) - 8, 'TARGET', 'sig', 'end')}
    <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" class="s-line"/>
    <path d="${curve(1.22, true)}" class="s-bone" stroke-width="2"/>
    <path d="${curve(0.8, true)}" class="s-cob" stroke-width="2"/>
    <path d="${curve(1.0, false)}" class="s-sig" stroke-width="2.5"/>
    ${t(sx(0.47), sy(1.22) - 8, 'OVERSHOOT', 'b')}
    ${t(sx(0.47), sy(0.8) + 16, 'UNDERSHOOT', 'cob')}
    ${t(sx(0.2), sy(1) - 10, 'CLEAN', 'sig')}
    <line x1="${sx(0.45)}" y1="${y0}" x2="${sx(0.45)}" y2="${yT - 10}" class="s-hair" stroke-dasharray="2 4"/>
    ${t(sx(0.225), y0 + 18, 'BALLISTIC FLICK', '', 'middle')}
    ${t(sx(0.72), y0 + 18, 'CORRECTION', '', 'middle')}
    ${t(x0, 22, 'CROSSHAIR POSITION ALONG THE FLICK (TIME →)')}
  `,
  );
}

export function switching(): string {
  const ox = 320;
  const oy = 220;
  const tgt = [
    { a: -12, r: 150, n: '×', dead: true },
    { a: 22, r: 170, n: '1' },
    { a: -52, r: 120, n: '2' },
    { a: 78, r: 150, n: '3' },
  ];
  const p = (a: number, r: number) => [ox + Math.sin((a * Math.PI) / 180) * r, oy - Math.cos((a * Math.PI) / 180) * r];
  const [ax, ay] = p(-12, 150);
  let body = `<circle cx="${ox}" cy="${oy}" r="7" class="f-bone"/>`;
  body += `<line x1="${ox}" y1="${oy}" x2="${ax}" y2="${ay}" class="s-hair" stroke-dasharray="3 4"/>`;
  for (const g of tgt) {
    const [x, y] = p(g.a, g.r);
    if (g.dead) body += `<g class="s-line"><line x1="${x - 8}" y1="${y - 8}" x2="${x + 8}" y2="${y + 8}"/><line x1="${x + 8}" y1="${y - 8}" x2="${x - 8}" y2="${y + 8}"/></g>`;
    else {
      body += `<circle cx="${x}" cy="${y}" r="12" class="f-sig" opacity="0.85"/>${t(x, y + 4, g.n, 'ink', 'middle')}`;
      const d = Math.abs(g.a - -12);
      body += t(x, y - 20, `${d}°`, 'b', 'middle');
    }
  }
  body += t(20, 24, 'AFTER A KILL: NEXT = SMALLEST ANGLE FROM WHERE YOUR CROSSHAIR ALREADY IS');
  return svg(240, body);
}

export function precision(mm: number, deg: number): string {
  return svg(
    220,
    `
    <circle cx="60" cy="100" r="10" class="f-bone"/>
    <line x1="70" y1="100" x2="560" y2="84" class="s-line"/>
    <line x1="70" y1="100" x2="560" y2="116" class="s-line"/>
    <circle cx="560" cy="100" r="16" class="f-sig"/>
    ${t(560, 66, 'HEAD · 30 M', 'sig', 'middle')}
    ${t(300, 84, `${deg.toFixed(2)}° OF YOUR VIEW`, 'b', 'middle')}
    <rect x="200" y="160" width="${Math.max(4, mm * 40)}" height="10" class="f-sig"/>
    <line x1="200" y1="176" x2="${200 + Math.max(4, mm * 40)}" y2="176" class="s-line"/>
    ${t(200, 200, `= ${mm.toFixed(2)} MM OF MOUSE TRAVEL AT YOUR SENSITIVITY (×40 SCALE)`, '')}
  `,
  );
}

export function movement(): string {
  let zig = 'M 120 200';
  let x = 120;
  const steps = [44, -30, 52, -18, 36, -40, 60];
  let y = 200;
  for (const s of steps) {
    x += 60;
    y = 200 + s * 0.6;
    zig += ` L ${x} ${y}`;
  }
  return svg(
    250,
    `
    <path d="${zig}" class="s-sig" stroke-width="2.5"/>
    <circle cx="${x}" cy="${y}" r="9" class="f-sig"/>
    ${t(x + 16, y + 4, 'YOU · ADAD', 'sig')}
    <circle cx="320" cy="30" r="7" class="f-cob"/>
    ${t(334, 34, 'ENEMY', 'cob')}
    ${[160, 240, 300, 380, 460]
      .map((tx, i) => `<line x1="320" y1="36" x2="${tx}" y2="${196 + (i % 2 ? 22 : -18)}" class="s-cob" stroke-dasharray="4 6" opacity="0.7"/>`)
      .join('')}
    ${t(20, 236, 'OVERWATCH HITSCAN HAS NO MOVEMENT PENALTY: MOVING COSTS YOU NOTHING, STANDING STILL COSTS YOU EVERYTHING')}
  `,
  );
}

export function routine(): string {
  const segs: [string, number][] = [
    ['DUELIST · SMOOTH', 2],
    ['DUELIST', 2],
    ['SNAP', 2],
    ['TRIAD', 2],
    ['PIN', 1],
    ['CROSSFIRE', 1],
  ];
  const x0 = 30;
  const x1 = 610;
  const unit = (x1 - x0) / 10;
  let x = x0;
  let body = '';
  segs.forEach(([name, m], i) => {
    const w = m * unit;
    body += `<rect x="${x}" y="70" width="${w - 4}" height="60" class="${i % 2 ? 'f-bone' : 'f-sig'}" opacity="${i % 2 ? 0.85 : 0.9}"/>`;
    body += t(x + 8, 92, name, 'ink');
    body += t(x + 8, 120, `${m} MIN`, 'ink');
    x += w;
  });
  for (let m = 0; m <= 10; m++) body += `<line x1="${x0 + m * unit}" y1="140" x2="${x0 + m * unit}" y2="${m % 5 ? 146 : 152}" class="s-line"/>${m % 5 ? '' : t(x0 + m * unit, 168, `${m}:00`, '', 'middle')}`;
  body += t(x0, 40, 'THE DAILY 10 — TRACK → FLICK → SWITCH → PRECISION → MOVE');
  return svg(190, body);
}
