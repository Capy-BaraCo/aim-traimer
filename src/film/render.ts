/**
 * Canvas renderers for the film room: your screen (first person), your crosshair's path, and the
 * timeline. Pure drawing: give them a lesson, a beat and a time, they draw that frame.
 */

import type { Beat, Lesson } from './lessons';
import { speedAt } from './lessons';
import { phaseAt, posAt, speedSeries, type Take } from './take';

export const INK = {
  ink: '#14120f',
  ink2: '#1d1a16',
  bone: '#e9e1d2',
  bone2: 'rgba(233,225,210,0.72)',
  dust: '#9d9280',
  hair: 'rgba(233,225,210,0.12)',
  hair2: 'rgba(233,225,210,0.22)',
  signal: '#ff4b1f',
  cobalt: '#7282f5',
  neutral: '#6e665a',
};

const MONO = '"Martian Mono", ui-monospace, monospace';
const DEG = Math.PI / 180;

export interface Frame {
  lesson: Lesson;
  beat: Beat;
  /** ms since the target appeared */
  t: number;
  /** Vertical field of view, degrees. */
  vfov: number;
  crosshair: string;
  /** Playback rate shown in the corner. */
  rate: number;
}

/** Aim angles (yaw right +, pitch up +) of a take at time t, relative to where the flick started. */
function aimOf(take: Take, t: number): { yaw: number; pitch: number } {
  const p = posAt(take, t);
  return toAngles(take, p.along, p.perp);
}

function toAngles(take: Take, along: number, perp: number): { yaw: number; pitch: number } {
  const ux = Math.cos(take.dirDeg * DEG);
  const uy = Math.sin(take.dirDeg * DEG);
  return { yaw: take.distance * (along * ux - perp * uy), pitch: take.distance * (along * uy + perp * ux) };
}

// ------------------------------------------------------------------------------------ projection

interface Cam {
  f: [number, number, number];
  r: [number, number, number];
  u: [number, number, number];
}

const dirVec = (yaw: number, pitch: number): [number, number, number] => {
  const y = yaw * DEG;
  const p = pitch * DEG;
  return [Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y)];
};

function camOf(yaw: number, pitch: number): Cam {
  const y = yaw * DEG;
  const p = pitch * DEG;
  return {
    f: dirVec(yaw, pitch),
    r: [Math.cos(y), 0, Math.sin(y)],
    u: [-Math.sin(p) * Math.sin(y), Math.cos(p), Math.sin(p) * Math.cos(y)],
  };
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Screen position of a direction; z <= 0 means behind you. */
function project(cam: Cam, yaw: number, pitch: number, fpx: number, cx: number, cy: number): { x: number; y: number; z: number; cx: number; cy: number } {
  const d = dirVec(yaw, pitch);
  const x = dot(d, cam.r);
  const y = dot(d, cam.u);
  const z = dot(d, cam.f);
  return { x: cx + (x / Math.max(1e-4, z)) * fpx, y: cy - (y / Math.max(1e-4, z)) * fpx, z, cx: x, cy: y };
}

// ------------------------------------------------------------------------------------ your screen

function label(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, size = 10, align: CanvasTextAlign = 'left', weight = 400) {
  g.font = `${weight} ${size}px ${MONO}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
}

function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number, bg: string, fg: string, align: 'left' | 'right' = 'left') {
  g.font = `600 9.5px ${MONO}`;
  const w = g.measureText(s).width + 14;
  const x0 = align === 'left' ? x : x - w;
  g.fillStyle = bg;
  g.fillRect(x0, y - 13, w, 19);
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(s, x0 + 7, y + 1);
}

/** One first-person view of `take` at time t, into the rectangle (x0, y0, w, h). */
function drawView(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, take: Take, fr: Frame, name: string, tone: string) {
  const { t } = fr;
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const fpx = h / 2 / Math.tan((fr.vfov / 2) * DEG);
  const aim = aimOf(take, t);
  const cam = camOf(aim.yaw, aim.pitch);
  const P = (yaw: number, pitch: number) => project(cam, yaw, pitch, fpx, cx, cy);

  // Sky and floor. No roll, so the horizon is flat.
  const hy = cy + Math.tan(aim.pitch * DEG) * fpx;
  const sky = g.createLinearGradient(0, y0, 0, hy);
  sky.addColorStop(0, '#15120f');
  sky.addColorStop(1, '#3b3129');
  g.fillStyle = sky;
  g.fillRect(x0, y0, w, Math.max(0, hy - y0));
  const floor = g.createLinearGradient(0, hy, 0, y0 + h);
  floor.addColorStop(0, '#2c251f');
  floor.addColorStop(1, '#121009');
  g.fillStyle = floor;
  g.fillRect(x0, Math.max(y0, hy), w, y0 + h - Math.max(y0, hy));
  g.strokeStyle = 'rgba(233,225,210,0.25)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, hy);
  g.lineTo(x0 + w, hy);
  g.stroke();

  // The protractor dial on the floor: spokes every 15°, rings at 5, 10 and 20 m.
  const eye = 1.6;
  g.lineWidth = 1;
  for (let b = Math.floor((aim.yaw - 90) / 15) * 15; b <= aim.yaw + 90; b += 15) {
    g.strokeStyle = b % 90 === 0 ? 'rgba(233,225,210,0.16)' : 'rgba(233,225,210,0.07)';
    g.beginPath();
    let started = false;
    for (const d of [2.2, 3, 4.5, 7, 11, 18, 30, 60]) {
      const q = P(b, -Math.atan(eye / d) / DEG);
      if (q.z <= 0.05) continue;
      if (started) g.lineTo(q.x, q.y);
      else g.moveTo(q.x, q.y);
      started = true;
    }
    g.stroke();
  }
  for (const R of [5, 10, 20]) {
    g.strokeStyle = R === 10 ? 'rgba(255,75,31,0.18)' : 'rgba(233,225,210,0.07)';
    g.beginPath();
    let started = false;
    for (let b = aim.yaw - 80; b <= aim.yaw + 80; b += 3) {
      const q = P(b, -Math.atan(eye / R) / DEG);
      if (q.z <= 0.05) continue;
      if (started) g.lineTo(q.x, q.y);
      else g.moveTo(q.x, q.y);
      started = true;
    }
    g.stroke();
  }

  // Monoliths every 30°, so turning reads as turning.
  for (let b = Math.floor((aim.yaw - 90) / 30) * 30 + 15; b <= aim.yaw + 90; b += 30) {
    const half = Math.atan(0.7 / 14) / DEG;
    const top = Math.atan((4.6 - eye) / 14) / DEG;
    const bot = -Math.atan(eye / 14) / DEG;
    const a = P(b - half, top);
    const c = P(b + half, bot);
    if (a.z <= 0.1 || c.z <= 0.1) continue;
    g.fillStyle = '#231e19';
    g.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
    g.fillStyle = 'rgba(255,75,31,0.55)';
    g.fillRect(a.x, a.y, c.x - a.x, 2);
    const num = String(((Math.round(b) % 360) + 360) % 360).padStart(3, '0');
    label(g, num, (a.x + c.x) / 2, a.y + 14, 'rgba(233,225,210,0.35)', 9, 'center');
  }

  // Target: where it is on screen, where it was a moment ago (a short streak), and whether it's been hit.
  const tgt = toAngles(take, 1, 0);
  const hit = take.shots.find((s) => s.hit);
  const hitAge = hit ? t - hit.t : -1;
  const alive = !hit || hitAge < 0;
  const q = P(tgt.yaw, tgt.pitch);
  const rpx = Math.max(3, (Math.tan(take.radius * DEG) / Math.max(0.2, q.z)) * fpx);
  if (alive || hitAge < 180) {
    if (alive) {
      g.strokeStyle = 'rgba(255,75,31,0.35)';
      g.lineWidth = Math.max(2, rpx * 0.9);
      g.lineCap = 'round';
      g.beginPath();
      for (let k = 6; k >= 0; k--) {
        const past = aimOf(take, t - k * 16);
        const pc = camOf(past.yaw, past.pitch);
        const pq = project(pc, tgt.yaw, tgt.pitch, fpx, cx, cy);
        if (pq.z <= 0.05) continue;
        // Where the target sat on screen over the last ~100 ms: a motion streak.
        if (k === 6) g.moveTo(pq.x, pq.y);
        else g.lineTo(pq.x, pq.y);
      }
      if (q.z > 0.05) g.lineTo(q.x, q.y);
      g.stroke();
    }
    if (q.z > 0.05) {
      const k = alive ? 1 : 1 + hitAge / 90;
      g.globalAlpha = alive ? 1 : Math.max(0, 1 - hitAge / 180);
      const grad = g.createRadialGradient(q.x - rpx * 0.3, q.y - rpx * 0.3, rpx * 0.1, q.x, q.y, rpx * k);
      grad.addColorStop(0, '#ff8a5c');
      grad.addColorStop(1, '#c5300f');
      g.shadowColor = 'rgba(255,75,31,0.7)';
      g.shadowBlur = 14;
      g.fillStyle = grad;
      g.beginPath();
      g.arc(q.x, q.y, rpx * k, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = INK.bone;
      g.lineWidth = 1.5;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  // Off screen: an arrow at the edge pointing the short way to the target.
  const inView = q.z > 0.05 && q.x > x0 && q.x < x0 + w && q.y > y0 && q.y < y0 + h;
  if (alive && !inView) {
    let ax = q.cx;
    let ay = -q.cy;
    if (q.z <= 0.05 && Math.hypot(ax, ay) < 1e-3) ax = 1;
    const n = Math.hypot(ax, ay) || 1;
    ax /= n;
    ay /= n;
    const rx = w / 2 - 26;
    const ry = h / 2 - 26;
    const k = 1 / Math.max(Math.abs(ax) / rx, Math.abs(ay) / ry);
    const px = cx + ax * k;
    const py = cy + ay * k;
    const ang = Math.atan2(ay, ax);
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.fillStyle = INK.signal;
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-6, -8);
    g.lineTo(-6, 8);
    g.closePath();
    g.fill();
    g.restore();
    const off = Math.round(Math.acos(Math.max(-1, Math.min(1, q.z))) / DEG);
    label(g, `${off}°`, px - ax * 26, py - ay * 26 + 4, INK.bone, 11, 'center', 600);
  }

  // Crosshair, in your own colour.
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 4;
  const arm = 7;
  const gap = 4;
  const cross = () => {
    g.beginPath();
    g.moveTo(cx - gap - arm, cy);
    g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy);
    g.lineTo(cx + gap + arm, cy);
    g.moveTo(cx, cy - gap - arm);
    g.lineTo(cx, cy - gap);
    g.moveTo(cx, cy + gap);
    g.lineTo(cx, cy + gap + arm);
    g.stroke();
  };
  cross();
  g.strokeStyle = fr.crosshair;
  g.lineWidth = 2;
  cross();

  // Click flashes.
  for (const s of take.shots) {
    const age = t - s.t;
    if (age < 0 || age > 260) continue;
    g.strokeStyle = s.hit ? INK.bone : INK.signal;
    g.globalAlpha = 1 - age / 260;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 10 + age * 0.12, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    label(g, s.hit ? 'HIT' : 'MISS', cx + 20, cy - 16, s.hit ? INK.bone : INK.signal, 11, 'left', 600);
  }

  // Reaction mark: count the wait.
  if (fr.beat.marks.includes('reaction')) {
    const waiting = t < take.reactionMs;
    label(g, waiting ? `waiting… ${Math.round(Math.max(0, t))} ms` : `moved at ${Math.round(take.reactionMs)} ms`, cx, cy + 48, waiting ? INK.signal : INK.bone, 14, 'center', 600);
  }

  // Corners: who, when, what.
  chip(g, name, x0 + 10, y0 + 22, tone, INK.ink);
  label(g, `${(Math.max(0, t) / 1000).toFixed(3)} s`, x0 + w - 12, y0 + 22, INK.bone, 11, 'right', 600);
  const ph = phaseAt(take, t);
  const phName = { wait: 'WAITING', throw: 'FLICK', fix: 'FIX-UP', done: 'DONE' }[ph];
  chip(g, phName, x0 + 10, y0 + h - 12, 'rgba(20,18,15,0.8)', ph === 'throw' ? INK.signal : ph === 'fix' ? INK.cobalt : INK.bone);
  g.restore();
}

export function drawScreen(g: CanvasRenderingContext2D, w: number, h: number, fr: Frame): void {
  g.clearRect(0, 0, w, h);
  const { lesson, beat } = fr;
  if (beat.show === 'both') {
    drawView(g, 0, 0, w / 2 - 1, h, lesson.you, fr, 'YOU', INK.signal);
    drawView(g, w / 2 + 1, 0, w / 2 - 1, h, lesson.fix, fr, 'RIGHT WAY', INK.bone);
    g.fillStyle = INK.ink;
    g.fillRect(w / 2 - 1, 0, 2, h);
  } else if (beat.show === 'fix') drawView(g, 0, 0, w, h, lesson.fix, fr, 'RIGHT WAY', INK.bone);
  else drawView(g, 0, 0, w, h, lesson.you, fr, 'YOUR SCREEN', INK.signal);
  // Replay chrome: a blinking record dot and the playback speed.
  const blink = Math.floor(performance.now() / 500) % 2 === 0;
  g.fillStyle = blink ? INK.signal : 'rgba(255,75,31,0.35)';
  g.beginPath();
  g.arc(w - 16, h - 16, 4, 0, Math.PI * 2);
  g.fill();
  label(g, `REPLAY ${fr.rate === 1 ? '1×' : `${fr.rate}×`}`, w - 26, h - 12, INK.bone2, 9.5, 'right', 600);
}

// ------------------------------------------------------------------------------------ path

export function drawMap(g: CanvasRenderingContext2D, w: number, h: number, fr: Frame): void {
  const { lesson, beat, t } = fr;
  const { you, fix } = lesson;
  g.clearRect(0, 0, w, h);
  g.fillStyle = INK.ink2;
  g.fillRect(0, 0, w, h);
  const maxA = Math.max(1.3, ...you.trace.map((p) => p[1] + 0.08), ...fix.trace.map((p) => p[1] + 0.08));
  const maxP = Math.max(0.12, ...you.trace.map((p) => Math.abs(p[2]) + 0.06));
  const padL = 30;
  const padR = 24;
  const k = Math.min((w - padL - padR) / (maxA + 0.1), (h / 2 - 34) / maxP);
  const X = (a: number) => padL + (a + 0.1) * k;
  const Y = (p: number) => h / 2 - p * k;

  // Grid: 0%, 50%, 100% (the target) and 125%.
  for (const a of [0, 0.5, 1, 1.25]) {
    g.strokeStyle = a === 1 ? INK.hair2 : INK.hair;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(a), 26);
    g.lineTo(X(a), h - 26);
    g.stroke();
    label(g, `${Math.round(a * 100)}%`, X(a), h - 10, a === 1 ? INK.bone : INK.dust, 9.5, 'center');
  }
  g.setLineDash([3, 5]);
  g.strokeStyle = INK.hair2;
  g.beginPath();
  g.moveTo(X(0), Y(0));
  g.lineTo(X(maxA), Y(0));
  g.stroke();
  g.setLineDash([]);
  label(g, 'STRAIGHT LINE = SHORTEST WAY', X(0) + 4, Y(0) - 8, INK.dust, 8.5);

  // Target and start.
  const r = (you.radius / you.distance) * k;
  g.strokeStyle = INK.signal;
  g.fillStyle = 'rgba(255,75,31,0.14)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(X(1), Y(0), Math.max(4, r), 0, Math.PI * 2);
  g.fill();
  g.stroke();
  label(g, 'TARGET', X(1), 20, INK.bone, 9.5, 'center', 600);
  g.fillStyle = INK.bone;
  g.beginPath();
  g.arc(X(0), Y(0), 3, 0, Math.PI * 2);
  g.fill();
  label(g, 'START', X(0), Y(0) + 18, INK.dust, 9, 'center');

  const trail = (take: Take, until: number, colorOf: (tt: number) => string, width: number, alpha = 1) => {
    g.globalAlpha = alpha;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const pts = take.trace.filter((p) => p[0] <= until);
    const now = posAt(take, until);
    const seq: [number, number, number][] = [...pts, [until, now.along, now.perp]];
    for (let i = 1; i < seq.length; i++) {
      g.strokeStyle = colorOf(seq[i][0]);
      g.beginPath();
      g.moveTo(X(seq[i - 1][1]), Y(seq[i - 1][2]));
      g.lineTo(X(seq[i][1]), Y(seq[i][2]));
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const youColor = (tt: number) => (phaseAt(you, tt) === 'fix' || phaseAt(you, tt) === 'done' ? INK.cobalt : INK.signal);
  const showYou = beat.show !== 'fix';
  const showFix = beat.show !== 'you';
  const ghost = beat.marks.includes('ghost');
  if (ghost && !showYou) trail(you, Infinity, youColor, 2, 0.28);
  if (ghost && !showFix) trail(fix, Infinity, () => INK.bone, 2, 0.28);
  if (showFix) trail(fix, t, () => INK.bone, 2.5);
  if (showYou) trail(you, t, youColor, 2.5);

  const head = (take: Take, col: string) => {
    const p = posAt(take, t);
    g.fillStyle = col;
    g.strokeStyle = INK.ink2;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(p.along), Y(p.perp), 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  if (showFix) head(fix, INK.bone);
  if (showYou) head(you, INK.signal);

  // Telestrator marks.
  const main = beat.show === 'fix' ? fix : you;
  const landT = main.reactionMs + main.ballisticMs;
  if (beat.marks.includes('landing') && t >= landT) {
    const lx = X(main.endAlong);
    const ly = Y(main.endPerp);
    g.strokeStyle = INK.bone;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(lx, ly, 11, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(lx, ly - 11);
    g.lineTo(lx, 44);
    g.stroke();
    label(g, `first move stopped: ${Math.round(main.endAlong * 100)}%`, Math.min(w - 8, Math.max(8, lx)), 40, INK.bone, 10, lx > w * 0.6 ? 'right' : 'left', 600);
  }
  if (beat.marks.includes('gap') && t >= landT && Math.abs(main.endAlong - 1) > 0.02) {
    const yb = h - 42;
    const a = X(Math.min(1, main.endAlong));
    const b = X(Math.max(1, main.endAlong));
    g.strokeStyle = main.endAlong > 1 ? INK.signal : INK.cobalt;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a, yb - 6);
    g.lineTo(a, yb);
    g.lineTo(b, yb);
    g.lineTo(b, yb - 6);
    g.stroke();
    const deg = Math.abs(main.endAlong - 1) * main.distance;
    label(g, `${deg.toFixed(1)}° ${main.endAlong > 1 ? 'past' : 'short'}`, (a + b) / 2, yb + 14, main.endAlong > 1 ? INK.signal : INK.cobalt, 10, 'center', 600);
  }
  if (beat.marks.includes('curve')) {
    const inThrow = you.trace.filter((p) => p[0] >= you.reactionMs && p[0] <= you.reactionMs + you.ballisticMs && p[0] <= t);
    const top = inThrow.reduce<[number, number, number] | null>((m, p) => (!m || Math.abs(p[2]) > Math.abs(m[2]) ? p : m), null);
    if (top && Math.abs(top[2]) > 0.03) {
      g.strokeStyle = INK.bone;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(top[1]), Y(0));
      g.lineTo(X(top[1]), Y(top[2]));
      g.stroke();
      // Keep the label on the open side of the marker, away from the path's far end.
      const right = X(top[1]) < w * 0.55;
      label(g, `${Math.round(Math.abs(top[2]) * 100)}% off the line`, X(top[1]) + (right ? 8 : -8), (Y(0) + Y(top[2])) / 2 + 4, INK.bone, 10, right ? 'left' : 'right', 600);
    }
  }
  if (beat.marks.includes('cost') && t > landT) {
    const spent = Math.min(t, main.totalMs) - landT;
    const at = posAt(main, Math.min(t, main.totalMs));
    label(g, `fix-up: ${Math.round(Math.max(0, spent))} ms`, X(at.along) + 12, Y(at.perp) + 26, INK.cobalt, 11, 'left', 600);
  }
  if (beat.marks.includes('clicks')) {
    for (const s of main.shots) {
      if (s.t > t) continue;
      const sx = X(s.along);
      const sy = Y(s.perp);
      g.lineWidth = 2;
      if (s.hit) {
        g.strokeStyle = INK.bone;
        g.beginPath();
        g.arc(sx, sy, 7, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.strokeStyle = INK.signal;
        g.beginPath();
        g.moveTo(sx - 6, sy - 6);
        g.lineTo(sx + 6, sy + 6);
        g.moveTo(sx + 6, sy - 6);
        g.lineTo(sx - 6, sy + 6);
        g.stroke();
      }
      label(g, `click at ${Math.round(speedAt(main, s.t))}°/s`, sx, sy - 14, s.hit ? INK.bone : INK.signal, 10, 'center', 600);
    }
  }
}

// ------------------------------------------------------------------------------------ timeline

export function drawTimeline(g: CanvasRenderingContext2D, w: number, h: number, fr: Frame): void {
  const { lesson, beat, t } = fr;
  const { you, fix } = lesson;
  g.clearRect(0, 0, w, h);
  const L = 96;
  const R = 18;
  const end = Math.max(you.totalMs, fix.totalMs) + 220;
  const X = (ms: number) => L + (Math.max(0, Math.min(end, ms)) / end) * (w - L - R);
  const graphTop = 14;
  const graphH = h * 0.44;
  const laneH = 16;
  const laneY = [graphTop + graphH + 16, graphTop + graphH + 16 + laneH + 10];

  // Beat window.
  g.fillStyle = 'rgba(233,225,210,0.05)';
  g.fillRect(X(beat.from), 4, X(beat.to) - X(beat.from), h - 22);

  // Speed curves.
  const sy = speedSeries(you);
  const sf = speedSeries(fix);
  const vmax = Math.max(60, ...sy.map((p) => p.v), ...sf.map((p) => p.v)) * 1.08;
  const Y = (v: number) => graphTop + graphH - (v / vmax) * graphH;
  g.strokeStyle = INK.hair;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(L, graphTop + graphH);
  g.lineTo(w - R, graphTop + graphH);
  g.stroke();
  const emphasise = beat.marks.includes('speed');
  const curve = (pts: { t: number; v: number }[], col: string, on: boolean) => {
    g.strokeStyle = col;
    g.globalAlpha = on ? 1 : 0.35;
    g.lineWidth = emphasise ? 2.5 : 1.6;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v))));
    g.stroke();
    g.globalAlpha = 1;
  };
  curve(sf, INK.bone, beat.show !== 'you' || beat.marks.includes('ghost'));
  curve(sy, INK.signal, beat.show !== 'fix' || beat.marks.includes('ghost'));
  label(g, 'SPEED', 10, graphTop + 12, INK.dust, 9);
  label(g, `${Math.round(vmax / 1.08)}°/s`, 10, graphTop + 26, INK.dust, 8.5);

  // Phase lanes.
  const lane = (take: Take, y: number, name: string, flickCol: string) => {
    label(g, name, 10, y + 12, beat.show === 'both' || (name === 'YOU') === (beat.show === 'you') ? INK.bone : INK.dust, 9.5, 'left', 600);
    const segs: [number, number, string, string][] = [
      [0, take.reactionMs, INK.neutral, 'wait'],
      [take.reactionMs, take.reactionMs + take.ballisticMs, flickCol, 'flick'],
      [take.reactionMs + take.ballisticMs, take.totalMs, INK.cobalt, 'fix-up'],
    ];
    for (const [a, b, col, nm] of segs) {
      if (b - a <= 0) continue;
      g.fillStyle = col;
      g.fillRect(X(a), y, Math.max(1, X(b) - X(a) - 2), laneH);
      const wpx = X(b) - X(a);
      if (wpx > 64) label(g, `${nm} ${Math.round(b - a)}`, X(a) + 5, y + 12, INK.ink, 9, 'left', 600);
    }
    for (const s of take.shots) {
      g.fillStyle = s.hit ? INK.bone : INK.signal;
      g.fillRect(X(s.t) - 1, y - 4, 2, laneH + 8);
    }
    if (beat.marks.includes('totals')) label(g, `${Math.round(take.totalMs)} ms`, X(take.totalMs) + 6, y + 12, INK.bone, 10, 'left', 600);
  };
  lane(you, laneY[0], 'YOU', INK.signal);
  lane(fix, laneY[1], 'RIGHT WAY', INK.bone);

  // Axis.
  for (let ms = 0; ms <= end; ms += 100) {
    g.fillStyle = INK.hair2;
    g.fillRect(X(ms), h - 16, 1, ms % 500 === 0 ? 6 : 3);
    if (ms % 200 === 0) label(g, `${ms}`, X(ms), h - 2, INK.dust, 8.5, 'center');
  }

  // Playhead.
  g.strokeStyle = INK.signal;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(t), 2);
  g.lineTo(X(t), h - 18);
  g.stroke();
}
