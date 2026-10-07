import { PerspectiveCamera, Scene, Vector3, type Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/game';
import { WEAPONS } from '../src/core/game';
import { makeOverdrive, type OverdriveDrill, type OverdriveReportData } from '../src/drills/overdrive';
import { testBeats, testChart } from '../src/drills/overdrive-dev';
import type { Chart } from '../src/rhythm/types';
import type { Box } from '../src/world/collide';
import { Figure } from '../src/world/figure';
import { wallBox } from '../src/world/synthwave';

const FRAME = 1 / 60;
const DEG = Math.PI / 180;
const EYE = new Vector3(0, 1.65, 0);

/**
 * Just enough of Game for Overdrive: a song clock we set by hand, figures, aim, and a fire() that
 * resolves a shot the way Game.fire does (ray → damageEnabled → damage → onShot → onKill).
 */
function fakeGame(chart: Chart) {
  const scene = new Scene();
  const cam = new PerspectiveCamera();
  const figures: Figure[] = [];
  const walls: Box[] = chart.walls.map(wallBox);
  const clock = { t: 0, time: 0 };
  let music = false;
  const g = {
    figures,
    engine: { scene },
    audio: { songTime: () => clock.t, playMusic: () => (music = true), spawn() {}, miss() {} },
    hud: { setStats() {}, flashToast() {}, cue() {} },
    input: { fireHeld: false },
    clock: 0,
    yaw: 0,
    pitch: 0,
    enterSynthwave() {},
    exitSynthwave() {},
    spawnOrb(p: Vector3, radius: number, color?: Color) {
      const f = new Figure('orb', [], 200, color);
      f.orbRadius = radius;
      f.hp = f.maxHp = 1;
      f.mover.teleport(p.x, p.y, p.z);
      f.mover.onGround = false;
      figures.push(f);
      scene.add(f.group);
      return f;
    },
    spawnHumanoid(x: number, z: number, _brain: unknown, color?: Color) {
      const f = new Figure('humanoid', [], 200, color);
      f.mover.teleport(x, 0, z);
      figures.push(f);
      scene.add(f.group);
      return f;
    },
    removeFigure(f: Figure) {
      const i = figures.indexOf(f);
      if (i >= 0) figures.splice(i, 1);
      f.dispose();
    },
    clearFigures() {
      for (const f of [...figures]) g.removeFigure(f);
    },
    eye: (out = new Vector3()) => out.copy(EYE),
    aimDir(out = new Vector3()) {
      const cp = Math.cos(g.pitch);
      return out.set(-Math.sin(g.yaw) * cp, Math.sin(g.pitch), -Math.cos(g.yaw) * cp);
    },
    aimAngles: () => ({ yaw: -g.yaw / DEG, pitch: g.pitch / DEG }),
    anglesTo(p: Vector3) {
      const d = p.clone().sub(EYE);
      const h = Math.hypot(d.x, d.z);
      return { yaw: Math.atan2(d.x, -d.z) / DEG, pitch: Math.atan2(d.y, h) / DEG, dist: d.length() };
    },
    castRay() {
      const o = EYE.clone();
      const d = g.aimDir();
      let best = Infinity;
      let figure: Figure | null = null;
      for (const b of walls) best = Math.min(best, b.ray(o, d));
      for (const f of figures) {
        const h = f.ray(o, d);
        if (h && h.t < best) {
          best = h.t;
          figure = f;
        }
      }
      return { figure, part: figure ? ('body' as const) : null, t: best };
    },
    crosshairTarget: () => g.castRay(),
  };
  let drill: OverdriveDrill;
  const api = {
    g,
    clock,
    music: () => music,
    attach(d: OverdriveDrill) {
      drill = d;
    },
    /** One frame at song time t (and a frame-clock step, as Game.step does). */
    frame(t: number) {
      clock.t = t;
      g.clock += FRAME;
      drill.elapsed += FRAME;
      drill.update(FRAME);
      for (const f of figures) f.update(FRAME, (clock.time += FRAME), cam);
      for (const f of [...figures]) if (f.removable) g.removeFigure(f);
    },
    /** A shot along the current aim, as Game.fire resolves it. */
    fire(press: boolean) {
      const hit = g.castRay();
      let kill = false;
      if (hit.figure && drill.damageEnabled(hit.figure, press)) kill = hit.figure.damage(WEAPONS.pulse.body);
      drill.onShot({ figure: hit.figure, part: hit.part, point: new Vector3(), kill, at: g.clock, press });
      if (kill && hit.figure) drill.onKill(hit.figure);
      return hit.figure;
    },
    aimAt(f: Figure) {
      const a = g.anglesTo(f.aimPoint());
      g.yaw = -a.yaw * DEG;
      g.pitch = a.pitch * DEG;
    },
  };
  return api;
}

function start(chart: Chart) {
  const fake = fakeGame(chart);
  const drill = makeOverdrive(fake.g as unknown as Game, chart.level, { chart, buffer: {} as AudioBuffer, beats: testBeats() });
  fake.attach(drill);
  drill.setup();
  drill.begin();
  return { fake, drill };
}

const CHART = testChart(5);
const index = (kind: string, n = 0) => CHART.targets.map((t, i) => (t.kind === kind ? i : -1)).filter((i) => i >= 0)[n];

describe('Overdrive drill', () => {
  it('plays the hand-written chart to the end: clicks hit taps, the stream tracks movers, and the report has what the debrief needs', () => {
    const { fake, drill } = start(CHART);
    expect(drill.movable).toBe(false);
    expect(drill.weapon?.auto).toBe(true);
    expect(drill.duration).toBe(CHART.duration + 2);
    expect(fake.music()).toBe(true);

    const circle = index('flick');
    const diamond = index('flick', 1);
    const triangle = index('flick', 2);
    const burst = index('burst');
    const strafer = index('strafer');
    const hold = index('hold');
    const peeker = index('peeker');
    const decoy = index('decoy');
    const finale = index('flick', 4);
    const at = (i: number) => CHART.targets[i];
    const fig = (i: number, part = 0) => {
      const f = drill.figureOf(i, part);
      if (!f) throw new Error(`target ${i} part ${part} is not live at ${fake.clock.t}`);
      return f;
    };
    const clicked = new Set<string>();
    /** Click once at the first frame at or after `when` (aiming at the target first). */
    const clickAt = (t: number, when: number, i: number, part = 0) => {
      const key = `${i}:${part}`;
      if (t < when || clicked.has(key)) return;
      clicked.add(key);
      const f = fig(i, part);
      fake.aimAt(f);
      expect(fake.fire(true)).toBe(f);
    };
    let streamT = 0;
    let streamOnCircle = 0;

    for (let t = -0.1; !drill.done && t < CHART.duration + 1; t += FRAME) {
      fake.frame(t);
      fake.g.input.fireHeld = false;
      // Circle: first hold the stream across it (it must not count), then click on the beat.
      const c = at(circle);
      if (t >= c.landTime && t < c.targetTime) {
        fake.aimAt(fig(circle));
        fake.g.input.fireHeld = true;
        if (t >= streamT) {
          streamT = t + 0.1;
          expect(fake.fire(false)).toBe(fig(circle));
          streamOnCircle++;
        }
      }
      clickAt(t, c.targetTime, circle);
      clickAt(t, at(triangle).targetTime + 0.02, triangle);
      // The diamond is left alone: it must vanish at its window's end.
      const b = at(burst);
      if (b.kind === 'burst') b.orbs.forEach((o, k) => clickAt(t, o.time, burst, k));
      // Strafer and hold: aim at them every frame and hold the stream.
      for (const i of [strafer, hold]) {
        const f = drill.figureOf(i);
        if (!f?.alive || t < at(i).landTime) continue;
        fake.aimAt(f);
        fake.g.input.fireHeld = true;
        if (t >= streamT) {
          streamT = t + 0.1;
          fake.fire(false);
        }
      }
      clickAt(t, at(peeker).targetTime + 0.06, peeker);
      // Decoy: sweep the stream across it (must not count as shooting a friendly).
      const d = at(decoy);
      if (t >= d.landTime && t < d.windowEnd && drill.figureOf(decoy)) {
        fake.aimAt(fig(decoy));
        fake.fire(false);
      }
      clickAt(t, at(index('flick', 3)).targetTime, index('flick', 3));
      clickAt(t, at(finale).targetTime - 0.03, finale);
    }

    expect(drill.done).toBe(true);
    expect(streamOnCircle).toBeGreaterThan(3);

    // Every target launched within a frame of its launchTime, and the unhit diamond vanished within a frame of windowEnd.
    const launches = drill.trace.filter((e) => e.what === 'launch');
    expect(launches).toHaveLength(CHART.targets.length);
    for (const e of launches) expect((e.t - (e.at ?? 0)) * 60).toBeLessThanOrEqual(1 + 1e-6);
    const vanish = drill.trace.find((e) => e.what === 'vanish' && e.index === diamond);
    expect(vanish && (vanish.t - at(diamond).windowEnd) * 60).toBeLessThanOrEqual(1 + 1e-6);
    expect(drill.trace.find((e) => e.what === 'judged' && e.index === diamond)?.detail).toMatch(/^miss/);
    // The stream across the circle was ignored; the click judged it.
    expect(drill.trace.filter((e) => e.what === 'ignored' && e.index === circle && e.detail === 'stream shot').length).toBe(streamOnCircle);
    expect(drill.trace.find((e) => e.what === 'judged' && e.index === circle)?.detail).toMatch(/^perfect/);
    expect(drill.trace.some((e) => e.what === 'friendly')).toBe(false);
    expect(drill.trace.some((e) => e.what === 'spared' && e.index === decoy)).toBe(true);
    expect(drill.trace.find((e) => e.what === 'tracked' && e.index === strafer)?.detail).toMatch(/killed/);

    const r = drill.report();
    const data = r.data as OverdriveReportData;
    expect(r.id).toBe('overdrive');
    expect(r.level).toBe(5);
    expect(r.score).toBeGreaterThan(50);
    expect(r.score).toBeLessThan(100);
    expect(data.difficulty).toBe('normal');
    expect(data.level).toBe(5);
    expect(data.counts.miss).toBe(1);
    expect(data.hitRate).toEqual({ flick: 0.8, burst: 1, strafer: 1, hold: 1, peeker: 1 });
    expect(data.meanOffsetMs).toBeGreaterThan(-35);
    expect(data.meanOffsetMs).toBeLessThan(35);
    const label = (l: string) => r.stats.find((s) => s.label === l)?.value;
    expect(label('Difficulty')).toBe('Normal');
    expect(label('Level')).toBe('5');
    expect(label('Timing')).toMatch(/^[+−]?\d+$/);
    expect(label('Flicks hit')).toBe('80');
    expect(label('Strafers hit')).toBe('100');
    expect(r.analytics?.flicks).toHaveLength(5);
    expect(r.analytics?.flicks?.filter((f) => f.hit)).toHaveLength(4);

    drill.teardown();
    expect(fake.g.figures).toHaveLength(0);
  });

  it('a clicked decoy breaks the combo and shows in the report', () => {
    const { fake, drill } = start(CHART);
    const decoy = index('decoy');
    const d = CHART.targets[decoy];
    for (let t = -0.1; !drill.done; t += FRAME) {
      fake.frame(t);
      if (t >= d.targetTime && drill.figureOf(decoy)) {
        fake.aimAt(drill.figureOf(decoy)!);
        fake.fire(true);
      }
    }
    expect(drill.trace.filter((e) => e.what === 'friendly')).toHaveLength(1);
    const r = drill.report();
    expect((r.data as OverdriveReportData).decoysHit).toBe(1);
    expect(r.stats.find((s) => s.label === 'Friendlies shot')?.value).toBe('1');
  });

  it('a peeker behind its wall cannot be shot until it steps out on its beat', () => {
    const { fake, drill } = start(CHART);
    const peeker = index('peeker');
    const p = CHART.targets[peeker];
    for (let t = -0.1; t < p.targetTime - 0.1; t += FRAME) fake.frame(t);
    const f = drill.figureOf(peeker)!;
    fake.aimAt(f);
    // Hidden: the wall takes the shot.
    expect(fake.fire(true)).toBeNull();
    expect(drill.run.isLive(peeker)).toBe(true);
  });

  it('needs a song', () => {
    const fake = fakeGame(CHART);
    expect(() => makeOverdrive(fake.g as unknown as Game, 5)).toThrow(/song/);
  });
});
