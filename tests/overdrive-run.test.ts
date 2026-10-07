import { describe, expect, it } from 'vitest';
import { testChart } from '../src/drills/overdrive-dev';
import { levelParams } from '../src/rhythm/levels';
import { ChartRun, takesShot, type RunEvent } from '../src/rhythm/run';
import { TARGET_KINDS } from '../src/rhythm/types';

const FRAME = 1 / 60;
const chart = testChart(5);
const idx = (pred: (i: number) => boolean) => chart.targets.findIndex((_, i) => pred(i));
const CIRCLE = idx((i) => chart.targets[i].kind === 'flick');
const BURST = idx((i) => chart.targets[i].kind === 'burst');
const STRAFER = idx((i) => chart.targets[i].kind === 'strafer');
const HOLD = idx((i) => chart.targets[i].kind === 'hold');
const PEEKER = idx((i) => chart.targets[i].kind === 'peeker');
const DECOY = idx((i) => chart.targets[i].kind === 'decoy');

/** Step a run frame by frame (launch, then expire, as the drill does), calling `each` after every frame. */
function play(run: ChartRun, each: (t: number) => void = () => {}): { launched: Map<number, number>; events: { t: number; e: RunEvent }[] } {
  const launched = new Map<number, number>();
  const events: { t: number; e: RunEvent }[] = [];
  for (let t = -0.1; t < chart.duration + FRAME; t += FRAME) {
    for (const i of run.launch(t)) launched.set(i, t);
    for (const e of run.expire(t)) events.push({ t, e });
    each(t);
  }
  for (const e of run.finish()) events.push({ t: chart.duration, e });
  return { launched, events };
}

describe('Overdrive test chart', () => {
  it('has one target of each kind and every flick shape, sorted by target beat', () => {
    for (const kind of TARGET_KINDS) expect(chart.targets.some((t) => t.kind === kind)).toBe(true);
    const shapes = new Set(chart.targets.flatMap((t) => (t.kind === 'flick' ? [t.shape] : [])));
    expect([...shapes].sort()).toEqual(['circle', 'diamond', 'triangle']);
    const times = chart.targets.map((t) => t.targetTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const t of chart.targets) {
      expect(t.launchTime).toBeLessThan(t.landTime);
      expect(t.landTime).toBeLessThanOrEqual(t.targetTime);
      expect(t.targetTime).toBeLessThan(t.windowEnd);
      expect(t.windowEnd).toBeLessThanOrEqual(chart.duration);
    }
  });
});

describe('ChartRun', () => {
  it('launches every target within one frame of its launchTime and closes it within one frame of windowEnd', () => {
    const run = new ChartRun(chart, chart.level);
    const { launched, events } = play(run);
    expect(launched.size).toBe(chart.targets.length);
    for (const [i, t] of launched) {
      expect(t - chart.targets[i].launchTime).toBeGreaterThanOrEqual(0);
      expect(t - chart.targets[i].launchTime).toBeLessThanOrEqual(FRAME + 1e-9);
    }
    for (const { t, e } of events) {
      const end = chart.targets[e.index].windowEnd;
      expect(t - end).toBeGreaterThanOrEqual(0);
      expect(t - end).toBeLessThanOrEqual(FRAME + 1e-9);
    }
    chart.targets.forEach((_, i) => expect(run.isResolved(i)).toBe(true));
  });

  it('counts an untouched run as misses, zero tracking and a decoy left alone', () => {
    const run = new ChartRun(chart, chart.level);
    const { events } = play(run);
    const r = run.result();
    const taps = chart.targets.filter((t) => t.kind === 'flick' || t.kind === 'peeker').length;
    const orbs = chart.targets.reduce((n, t) => n + (t.kind === 'burst' ? t.orbs.length : 0), 0);
    expect(r.counts.miss).toBe(taps + orbs);
    expect(r.score).toBe(0);
    expect(events.filter(({ e }) => e.type === 'tracked').map(({ e }) => (e.type === 'tracked' ? e.hit : null))).toEqual([false, false]);
    expect(events.some(({ e }) => e.type === 'spared' && e.index === DECOY)).toBe(true);
    expect(r.hitRate.decoy).toBeUndefined();
  });

  it('takes clicks on tap targets but never the held stream (D13)', () => {
    expect(takesShot('flick', false)).toBe(false);
    expect(takesShot('burst', false)).toBe(false);
    expect(takesShot('peeker', false)).toBe(false);
    expect(takesShot('decoy', false)).toBe(false);
    expect(takesShot('strafer', false)).toBe(true);
    expect(takesShot('hold', false)).toBe(true);
    for (const k of TARGET_KINDS) expect(takesShot(k, true)).toBe(true);

    const run = new ChartRun(chart, chart.level);
    const c = chart.targets[CIRCLE];
    run.launch(c.targetTime);
    expect(run.shot(CIRCLE, 0, false, c.targetTime)).toEqual([]);
    expect(run.isLive(CIRCLE)).toBe(true);
    const [e] = run.shot(CIRCLE, 0, true, c.targetTime + 0.01);
    expect(e).toMatchObject({ type: 'judged', judgement: 'perfect' });
    expect(e.type === 'judged' && Math.round(e.offsetMs)).toBe(10);
    expect(run.isResolved(CIRCLE)).toBe(true);
    // Once judged it takes nothing more.
    expect(run.shot(CIRCLE, 0, true, c.targetTime + 0.02)).toEqual([]);
  });

  it('ignores clicks before landing or after the window, and judges Early and Late inside it', () => {
    const run = new ChartRun(chart, chart.level);
    const c = chart.targets[CIRCLE];
    const perfect = levelParams(chart.level).perfectMs / 1000;
    run.launch(c.launchTime);
    expect(run.shot(CIRCLE, 0, true, c.landTime - 0.01)).toEqual([]);
    expect(run.shot(CIRCLE, 0, true, c.targetTime - perfect - 0.05)[0]).toMatchObject({ judgement: 'early' });
    const late = new ChartRun(chart, chart.level);
    late.launch(c.launchTime);
    expect(late.shot(CIRCLE, 0, true, c.windowEnd + 0.001)).toEqual([]);
    expect(late.shot(CIRCLE, 0, true, c.targetTime + perfect + 0.05)[0]).toMatchObject({ judgement: 'late' });
  });

  it('opens burst orbs in turn and finishes the burst with its last orb', () => {
    const run = new ChartRun(chart, chart.level);
    const b = chart.targets[BURST];
    if (b.kind !== 'burst') throw new Error('not a burst');
    run.launch(b.landTime);
    // Orb 2's window opens on orb 1's beat.
    expect(run.shot(BURST, 2, true, b.orbs[0].time)).toEqual([]);
    b.orbs.forEach((o, k) => {
      const [e] = run.shot(BURST, k, true, o.time);
      expect(e).toMatchObject({ type: 'judged', part: k, judgement: 'perfect' });
      expect(run.isResolved(BURST)).toBe(k === b.orbs.length - 1);
    });
    expect(run.result().hitRate.burst).toBe(1);
  });

  it('scores strafers and holds on the share of their life tracked, and a strafer kill ends its life', () => {
    const run = new ChartRun(chart, chart.level);
    const s = chart.targets[STRAFER];
    const h = chart.targets[HOLD];
    run.launch(h.launchTime);
    // Strafer: on target from landing, killed a second in: its whole (short) life was tracked.
    for (let t = s.landTime; t <= s.landTime + 1; t += FRAME) run.track(STRAFER, true, t);
    const [kill] = run.kill(STRAFER, s.landTime + 1);
    expect(kill).toMatchObject({ type: 'tracked', hit: true, killed: true });
    expect(kill.type === 'tracked' && kill.fraction).toBeGreaterThan(0.95);
    // Hold: tracked for the first 40% of its glide (from its target beat), then lost.
    const span = h.windowEnd - h.targetTime;
    for (let t = h.landTime; t <= h.windowEnd; t += FRAME) run.track(HOLD, t < h.targetTime + 0.4 * span, t);
    // (Everything earlier closes too, as misses: only the hold matters here.)
    const held = run.expire(h.windowEnd).find((e) => e.index === HOLD);
    expect(held).toMatchObject({ type: 'tracked', index: HOLD, hit: true, killed: false });
    expect(held?.type === 'tracked' && held.fraction).toBeCloseTo(0.4, 1);
    expect(run.result().hitRate).toMatchObject({ strafer: 1, hold: 1 });
  });

  it('breaks the combo for a shot decoy, but only on a click', () => {
    const run = new ChartRun(chart, chart.level);
    const c = chart.targets[CIRCLE];
    const d = chart.targets[DECOY];
    run.launch(c.targetTime);
    run.shot(CIRCLE, 0, true, c.targetTime);
    expect(run.combo).toBe(2);
    run.launch(d.targetTime);
    expect(run.shot(DECOY, 0, false, d.targetTime)).toEqual([]);
    expect(run.combo).toBe(2);
    expect(run.shot(DECOY, 0, true, d.targetTime)).toEqual([{ type: 'friendly', index: DECOY }]);
    expect(run.combo).toBe(0);
    expect(run.result().decoysHit).toBe(1);
  });

  it('judges a peeker against its target beat', () => {
    const run = new ChartRun(chart, chart.level);
    const p = chart.targets[PEEKER];
    run.launch(p.landTime);
    const [e] = run.shot(PEEKER, 0, true, p.targetTime + 0.03);
    expect(e).toMatchObject({ type: 'judged', judgement: 'perfect' });
    expect(run.result().meanOffsetMs).toBeCloseTo(30, 5);
  });
});
