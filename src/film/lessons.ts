/**
 * Lessons: a coach finding turned into a short guided film.
 * Each lesson picks a typical flick of yours that shows the problem (typical, not the worst — that
 * is the one you will recognise), builds the corrected version, and scripts "beats": what to watch,
 * the moment it goes wrong, why, what it costs, the fix, and both side by side.
 */

import type { DirSector, FlickRecord } from '../core/analytics';
import type { DrillId } from '../core/coach';
import { cmPer360 } from '../core/sens';
import { demoRecord, type DemoKind } from './synth';
import { idealOf, posAt, takeOf, type Take } from './take';

export type LessonKind = DemoKind;

/** Things the stage can draw on top of the replay. */
export type Mark = 'landing' | 'gap' | 'speed' | 'cost' | 'clicks' | 'curve' | 'reaction' | 'ghost' | 'totals';

export interface Beat {
  title: string;
  text: string;
  show: 'you' | 'fix' | 'both';
  /** Timeline window in ms, and playback rate (1 = real time, 0.25 = quarter speed). */
  from: number;
  to: number;
  rate: number;
  marks: Mark[];
}

export interface Lesson {
  kind: LessonKind;
  title: string;
  source: string;
  you: Take;
  fix: Take;
  beats: Beat[];
  tip: string;
  drill: DrillId;
}

export const LESSON_TITLE: Record<LessonKind, string> = {
  overshoot: 'Going past the target',
  undershoot: 'Stopping short',
  curve: 'A curved path',
  driveby: 'Clicking while moving',
  slowstart: 'A slow start',
  slowfix: 'A long fix-up',
  clean: 'A clean flick',
};

export const LESSON_KINDS: LessonKind[] = ['overshoot', 'undershoot', 'curve', 'driveby', 'slowstart', 'slowfix', 'clean'];

/** Which lesson replays a coach finding (null: that finding isn't about single flicks). */
export function lessonKindFor(findingId: string): LessonKind | null {
  if (findingId.startsWith('dir-')) return 'undershoot';
  const map: Record<string, LessonKind> = {
    overshoot: 'overshoot',
    undershoot: 'undershoot',
    curve: 'curve',
    'drive-by': 'driveby',
    'early-click': 'driveby',
    'late-click': 'driveby',
    'slow-start': 'slowstart',
    'slow-fix': 'slowfix',
    balanced: 'clean',
    consistent: 'clean',
    'quick-start': 'clean',
  };
  return map[findingId] ?? null;
}

const usable = (r: FlickRecord) => (r.trace?.length ?? 0) >= 6 && r.cls !== 'micro';

/** Sorted by how typical they are: closest to the group's median first. */
function byTypical(xs: FlickRecord[], key: (r: FlickRecord) => number): FlickRecord[] {
  if (!xs.length) return [];
  const vals = xs.map(key).sort((a, b) => a - b);
  const mid = vals[Math.floor(vals.length / 2)];
  return [...xs].sort((a, b) => Math.abs(key(a) - mid) - Math.abs(key(b) - mid));
}

/** Your flicks that show this lesson, most typical first. */
export function examplesFor(records: readonly FlickRecord[], kind: LessonKind, dir?: DirSector): FlickRecord[] {
  let pool = records.filter(usable);
  if (dir) {
    const d = pool.filter((r) => r.dir === dir);
    if (d.length) pool = d;
  }
  switch (kind) {
    case 'overshoot':
      return byTypical(
        pool.filter((r) => r.cls === 'overshoot'),
        (r) => r.endAlong,
      );
    case 'undershoot':
      return byTypical(
        pool.filter((r) => r.cls === 'undershoot'),
        (r) => r.endAlong,
      );
    case 'curve':
      return byTypical(
        pool.filter((r) => r.curve > 0.1),
        (r) => r.curve,
      );
    case 'driveby': {
      const thru = byTypical(
        pool.filter((r) => r.flickThrough),
        (r) => r.clickSpeed,
      );
      return thru.length ? thru : pool.filter((r) => r.shots?.some((s) => !s.hit));
    }
    case 'slowstart':
      return byTypical(
        pool.filter((r) => r.reactionMs > 300),
        (r) => r.reactionMs,
      );
    case 'slowfix':
      return byTypical(
        pool.filter((r) => r.hit && r.correctionMs > Math.max(200, r.ballisticMs * 1.2)),
        (r) => r.correctionMs,
      );
    case 'clean':
      return pool.filter((r) => r.cls === 'clean' && r.hit && !r.flickThrough).sort((a, b) => a.totalMs - b.totalMs);
  }
}

const DIRS = ['to your right', 'up and to the right', 'straight up', 'up and to the left', 'to your left', 'down and to the left', 'straight down', 'down and to the right'];
const dirWords = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Crosshair speed at time t, degrees per second. */
export function speedAt(take: Take, t: number): number {
  const a = posAt(take, t - 8);
  const b = posAt(take, t + 8);
  return (Math.hypot(b.along - a.along, b.perp - a.perp) * take.distance) / 0.016;
}

export interface LessonContext {
  sens: number;
  dpi: number;
  /** "From your Snap run" … */
  source: string;
  /** Override the default tip / drill with the finding's own. */
  tip?: string;
  drill?: DrillId;
}

const DEFAULT_TIP: Record<LessonKind, string> = {
  overshoot: 'Try to stop ON the target, as if your crosshair bumps into a wall. Ease off in the last third of the movement.',
  undershoot: 'Look at the target, then commit to the whole distance in one movement. Landing a hair past is fine.',
  curve: 'For big flicks, move from the elbow and shoulder and keep your wrist still. Picture a straight line, then draw it.',
  driveby: 'Stop, then click. It costs about 30 ms — much less than a missed shot.',
  slowstart: 'Move your eyes first and let your hand follow. Start the flick before you are sure.',
  slowfix: 'Make the first movement do the work — land within a few percent — then one nudge and click.',
  clean: 'Keep this rhythm in your head: throw, settle, click.',
};

export function buildLesson(kind: LessonKind, rec: FlickRecord, ctx: LessonContext): Lesson | null {
  const you = takeOf(rec);
  if (!you) return null;
  const fix = idealOf(you, kind === 'slowstart' ? { reactionMs: Math.min(you.reactionMs, 220) } : {});
  const cm = (deg: number) => (deg * cmPer360(ctx.sens, ctx.dpi)) / 360;
  const D = Math.round(you.distance);
  const dir = dirWords(you.dirDeg);
  const land = Math.round(you.endAlong * 100);
  const throwEnd = you.reactionMs + you.ballisticMs;
  const fixThrowEnd = fix.reactionMs + fix.ballisticMs;
  const cost = Math.max(0, Math.round(you.totalMs - throwEnd));
  const youT = Math.round(you.totalMs);
  const fixT = Math.round(fix.totalMs);
  const saved = youT - fixT;
  const youEnd = you.totalMs + 260;
  const fixEnd = fix.totalMs + 260;
  const bothEnd = Math.max(youEnd, fixEnd);
  const src = ctx.source;
  const tip = ctx.tip || DEFAULT_TIP[kind];
  const drill: DrillId = ctx.drill ?? (you.distance < 30 ? 'blink' : 'snap');
  const sideBySide: Beat = {
    title: 'Side by side',
    text:
      saved > 20
        ? `At full speed: you ${youT} ms, the right way ${fixT} ms. That's ${saved} ms faster on every flick like this.`
        : `At full speed they take about the same time (${youT} vs ${fixT} ms) — but the right way lands on it every time, and reliable beats lucky.`,
    show: 'both',
    from: 0,
    to: bothEnd,
    rate: 1,
    marks: ['totals'],
  };
  const tryThis: Beat = { title: 'Try this', text: tip, show: 'both', from: 0, to: bothEnd, rate: 1, marks: ['totals', 'ghost'] };
  const watch = (text: string): Beat => ({ title: 'Watch it', text, show: 'you', from: 0, to: youEnd, rate: 0.4, marks: [] });
  const theFix = (text: string): Beat => ({ title: 'The right way', text, show: 'fix', from: 0, to: fixEnd, rate: 0.4, marks: ['ghost', 'landing'] });
  const why = (text: string, marks: Mark[] = ['speed', 'ghost']): Beat => ({
    title: 'Why it happens',
    text,
    show: 'both',
    from: Math.max(0, Math.min(you.reactionMs, fix.reactionMs) - 40),
    to: Math.max(throwEnd, fixThrowEnd) + 30,
    rate: 0.3,
    marks,
  });
  const costBeat = (text: string): Beat => ({
    title: 'What it costs',
    text,
    show: 'you',
    from: Math.max(0, throwEnd - 30),
    to: you.totalMs + 120,
    rate: 0.35,
    marks: ['cost', 'clicks'],
  });

  let beats: Beat[];
  switch (kind) {
    case 'overshoot': {
      const past = ((you.endAlong - 1) * you.distance).toFixed(1);
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. Watch the target slide past your crosshair, then come back.`),
        {
          title: 'Here it goes past',
          text: `Your first movement stopped at ${land}% of the way — ${past}° past the target. Anything over 100% means you have to come back.`,
          show: 'you',
          from: Math.max(0, you.reactionMs - 40),
          to: throwEnd + 10,
          rate: 0.25,
          marks: ['landing', 'gap'],
        },
        why(
          you.peakAt < 0.42
            ? 'Look at your speed (orange line): it peaks early and is still high as you reach the target — like throwing a ball AT someone instead of TO them. The right way (white line) speeds up and slows down evenly, so it is already braking when it arrives.'
            : `Your speed has a good shape, but the movement was too big: at your settings this ${D}° flick is ${cm(you.distance).toFixed(1)} cm of mouse, and your hand moved about ${cm(you.distance * you.endAlong).toFixed(1)} cm. That's usually your arm misjudging the distance, not a wrong sensitivity — unless it happens every day.`,
        ),
        costBeat(`Coming back took ${cost} ms. That's ${Math.round((cost / Math.max(1, youT)) * 100)}% of the whole flick spent fixing one mistake.`),
        theFix("Same target, done right: aim to arrive at about 95%, easing off in the last third, then one small nudge — and click once you've stopped."),
        sideBySide,
        tryThis,
      ];
      break;
    }
    case 'undershoot': {
      const short = ((1 - you.endAlong) * you.distance).toFixed(1);
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. Watch your crosshair stop before the target, then creep the rest of the way.`),
        {
          title: 'Here it stops short',
          text: `Your first movement stopped at ${land}% of the way — ${short}° before the target. The rest was creeping.`,
          show: 'you',
          from: Math.max(0, you.reactionMs - 40),
          to: throwEnd + 10,
          rate: 0.25,
          marks: ['landing', 'gap'],
        },
        why(
          `Your hand braked before it arrived: watch the orange speed line die away early. Often it's fear of going past, or a sensitivity that makes the full distance feel far — this flick is ${cm(you.distance).toFixed(1)} cm of mouse at your settings.`,
        ),
        costBeat(`Creeping the last ${100 - land}% took ${cost} ms${cost > you.ballisticMs ? ' — longer than the flick itself' : ''}.`),
        theFix('Commit to the whole distance in one movement. Landing a hair past is fine: one small nudge back is quicker than a long creep.'),
        sideBySide,
        tryThis,
      ];
      break;
    }
    case 'curve':
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. Watch the path from above (right): it bends instead of going straight.`),
        {
          title: 'Here it bends',
          text: `At its widest, your path bowed ${Math.round(you.curve * 100)}% of the distance off the straight line — about ${(you.curve * you.distance).toFixed(1)}° sideways.`,
          show: 'you',
          from: Math.max(0, you.reactionMs - 40),
          to: throwEnd + 10,
          rate: 0.25,
          marks: ['curve', 'ghost'],
        },
        why('Big flicks from the wrist swing in an arc, because your hand pivots around the wrist joint. Moving from the elbow and shoulder keeps the line straight.', ['curve', 'ghost']),
        costBeat(`The detour lands you beside the target, so the fix-up has to go sideways: ${cost} ms.`),
        theFix('A straight line from where you are to the target. For big flicks, keep your wrist still and move from the elbow.'),
        sideBySide,
        tryThis,
      ];
      break;
    case 'driveby': {
      const shot = you.shots.find((s) => s.hit) ?? you.shots[0];
      const v = shot ? Math.round(speedAt(you, shot.t)) : Math.round(you.clickSpeed);
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. Watch when the click happens (the flash).`),
        {
          title: "Here's the click",
          text: `You clicked while your crosshair was still moving at about ${v}°/s — sliding across the target, not stopped on it.`,
          show: 'you',
          from: Math.max(0, you.reactionMs - 40),
          to: (shot?.t ?? you.totalMs) + 60,
          rate: 0.25,
          marks: ['clicks'],
        },
        why('Timing a click on the way through works on big, close targets. On a head, a few milliseconds early or late is a miss. It is a coin flip, not a skill.', ['clicks', 'speed']),
        costBeat(you.hit ? 'It landed this time. On a smaller target — a head at range — it would not have.' : 'This one missed, and a miss costs a whole extra shot.'),
        theFix('Stop, then click. Watch the right way: it settles on the target first, then fires.'),
        sideBySide,
        tryThis,
      ];
      break;
    }
    case 'slowstart': {
      const react = Math.round(you.reactionMs);
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. Watch how long nothing happens after the target appears.`),
        {
          title: 'The wait',
          text: `The target appeared at 0 ms. Your hand didn't move until ${react} ms.`,
          show: 'you',
          from: 0,
          to: you.reactionMs + 80,
          rate: 0.5,
          marks: ['reaction'],
        },
        why('Most of that time is finding the target and deciding. Let your eyes jump to it first — your hand follows by itself. You do not need to be sure before you move.', ['reaction', 'speed']),
        costBeat(`Everything after the wait was fine. The wait alone was ${Math.max(0, react - fix.reactionMs)} ms slower than a quick start.`),
        theFix(`Same flick, starting at about ${Math.round(fix.reactionMs)} ms.`),
        sideBySide,
        tryThis,
      ];
      break;
    }
    case 'slowfix':
      beats = [
        watch(`${src}: a ${D}° flick ${dir}. The flick gets close quickly — then watch the fixing.`),
        {
          title: 'Close, then a long fix-up',
          text: `Your first movement got you to ${land}%, then the fix-up took ${cost} ms — longer than the flick itself (${Math.round(you.ballisticMs)} ms).`,
          show: 'you',
          from: Math.max(0, throwEnd - 30),
          to: you.totalMs + 100,
          rate: 0.3,
          marks: ['landing', 'cost'],
        },
        why('Several small, careful corrections: the flick landed a little off to the side, and every check-and-nudge costs time. A better first movement turns the fix-up into one nudge.', ['speed', 'ghost']),
        theFix('Let the flick do the work: land within a few percent, one nudge, click.'),
        sideBySide,
        tryThis,
      ];
      break;
    case 'clean':
      beats = [
        watch(`${src}: one of your best — a ${D}° flick ${dir} in ${youT} ms.`),
        {
          title: "Why it's good",
          text: `Your first movement stopped at ${land}% — right on it. Your speed rose and fell evenly, and you clicked once, after stopping.`,
          show: 'you',
          from: Math.max(0, you.reactionMs - 40),
          to: you.totalMs + 60,
          rate: 0.3,
          marks: ['landing', 'speed', 'clicks'],
        },
        { title: 'Copy this', text: 'This is the one to copy. Watch it at full speed a few times and feel the rhythm: throw, settle, click.', show: 'you', from: 0, to: youEnd, rate: 1, marks: ['clicks'] },
      ];
      break;
  }
  return { kind, title: LESSON_TITLE[kind], source: src, you, fix, beats, tip, drill };
}

/** A lesson from a built-in example flick (for the Field Manual). */
export function demoLesson(kind: LessonKind, sens: number, dpi: number): Lesson {
  return buildLesson(kind, demoRecord(kind), { sens, dpi, source: 'An example flick' })!;
}
