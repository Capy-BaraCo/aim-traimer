/**
 * The coach: turns analytics into plain-English feedback.
 * Every finding answers three questions a beginner has: what happened, why it matters, what to try.
 */

import type { EchoSummary, FlickRecord, FlickSummary, TrackingSummary } from './analytics';

export type DrillId = 'duelist' | 'blink' | 'snap' | 'echo' | 'pin' | 'triad' | 'corner' | 'crossfire';

export interface Finding {
  id: string;
  kind: 'good' | 'fix';
  /** Higher = more important. */
  weight: number;
  title: string;
  body: string;
  tip: string;
  drill?: DrillId;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;
const ok = (x: number) => Number.isFinite(x);

export function flickFindings(s: FlickSummary, context: 'short' | 'wide' | 'mixed' = 'mixed'): Finding[] {
  const out: Finding[] = [];
  const drill: DrillId = context === 'short' ? 'blink' : 'snap';
  if (s.n >= 5) {
    const over = s.tally.overshoot / s.tally.total;
    const under = s.tally.undershoot / s.tally.total;
    if (s.bias > 0.25)
      out.push({
        id: 'overshoot',
        kind: 'fix',
        weight: 0.6 + s.bias,
        title: 'You fly past your targets',
        body: `${pct(over)} of your flicks went past the target before you stopped. Your first movement ends at ${pct(s.landing)} of the distance — anything over 100% means too far.`,
        tip: 'Try to stop ON the target, as if it were a wall your crosshair bumps into. Ease off near the end of the movement. If this is still true after a week, test a slightly lower sensitivity (about −5%).',
        drill,
      });
    else if (s.bias < -0.25)
      out.push({
        id: 'undershoot',
        kind: 'fix',
        weight: 0.6 - s.bias,
        title: 'You stop short of your targets',
        body: `${pct(under)} of your flicks stopped before reaching the target, then crept the rest of the way. Your first movement ends at ${pct(s.landing)} of the distance.`,
        tip: 'Look at the target first, then commit to the whole distance in one movement. Creeping is slow. If this is still true after a week, test a slightly higher sensitivity (about +5%).',
        drill,
      });
    else if (Math.abs(s.bias) <= 0.15)
      out.push({
        id: 'balanced',
        kind: 'good',
        weight: 0.6,
        title: 'Your flicks land on target',
        body: `Your first movement ends at ${pct(s.landing)} of the distance on average, with overshoots and undershoots evenly split. That's the sign of a sensitivity you control.`,
        tip: 'Keep it. Now work on speed: same landing, a little faster.',
      });
  }
  if (s.rangeEffect !== null && Math.abs(s.rangeEffect) > 0.12) {
    const shortFirst = s.rangeEffect > 0;
    const far = s.buckets.wide.n >= 3 ? s.buckets.wide : s.buckets.mid;
    out.push({
      id: 'range-effect',
      kind: 'fix',
      weight: 0.5 + Math.abs(s.rangeEffect),
      title: shortFirst ? 'Small flicks go too far, big flicks fall short' : 'Small flicks fall short, big flicks go too far',
      body: `Short flicks land at ${pct(s.buckets.short.landing)}, longer ones at ${pct(far.landing)}. This is normal — it's called the "range effect": your brain averages distances together.`,
      tip: "Don't change sensitivity for this; it's a skill, not a setting. Warm up each range separately: Blink for short flicks, Snap for wide ones.",
      drill: shortFirst ? 'blink' : 'snap',
    });
  }
  if (s.n >= 6 && ok(s.spread)) {
    if (s.spread > 0.14)
      out.push({
        id: 'inconsistent',
        kind: 'fix',
        weight: 0.4 + s.spread,
        title: 'Your flicks land somewhere different every time',
        body: `The same kind of flick lands anywhere from about ${pct(s.landing - s.spread)} to ${pct(s.landing + s.spread)} of the distance.`,
        tip: 'Slow down by about 10%. Your hands learn from repeatable movements — consistency first, speed later.',
        drill,
      });
    else if (s.spread < 0.07)
      out.push({
        id: 'consistent',
        kind: 'good',
        weight: 0.45,
        title: 'Very consistent flicks',
        body: `Your landing point barely moves between flicks (${Math.round(s.spread * 100) < 1 ? 'under ±1%' : `±${pct(s.spread)}`}). That's muscle memory forming.`,
        tip: 'Push the speed: consistent players can afford to go faster.',
      });
  }
  const side = (a: 'left' | 'right' | 'up' | 'down', b: 'left' | 'right' | 'up' | 'down') => {
    const A = s.dirs[a];
    const B = s.dirs[b];
    if (A.n < 3 || B.n < 3 || Math.abs(A.landing - B.landing) < 0.12) return;
    const weak = A.landing < B.landing ? a : b;
    const strong = weak === a ? b : a;
    out.push({
      id: `dir-${weak}`,
      kind: 'fix',
      weight: 0.35 + Math.abs(A.landing - B.landing),
      title: `Your ${weak}ward flicks come up short`,
      body: `Flicking ${weak} you reach ${pct(s.dirs[weak].landing)} of the distance; flicking ${strong} you reach ${pct(s.dirs[strong].landing)}.`,
      tip:
        a === 'left' || a === 'right'
          ? `Your wrist bends further one way than the other. For ${weak}ward flicks, move from the elbow and forearm instead of just the wrist.`
          : 'Vertical flicks are often cramped by the desk or a tight grip. Keep your grip light and give the mouse room.',
      drill,
    });
  };
  side('left', 'right');
  side('up', 'down');
  if (ok(s.curve) && s.curve > 0.12 && s.n >= 5)
    out.push({
      id: 'curve',
      kind: 'fix',
      weight: 0.3 + s.curve,
      title: 'Your flicks curve instead of going straight',
      body: `On the way to the target your crosshair drifts up to ${pct(s.curve)} of the distance away from a straight line.`,
      tip: 'Eyes first, then hand: curved paths usually come from starting to move before you have looked at the target. A straight line is the shortest route.',
      drill,
    });
  if (ok(s.reactionMs)) {
    if (s.reactionMs > 320)
      out.push({
        id: 'slow-start',
        kind: 'fix',
        weight: 0.3 + (s.reactionMs - 320) / 400,
        title: "You're slow to start moving",
        body: `After a target appears, your hand waits about ${ms(s.reactionMs)} before moving.`,
        tip: 'Rest your eyes loosely on the middle of the screen and keep your hand relaxed and ready. Tense hands start later.',
        drill: 'blink',
      });
    else if (s.reactionMs < 230)
      out.push({
        id: 'quick-start',
        kind: 'good',
        weight: 0.35,
        title: 'Quick off the mark',
        body: `You start moving about ${ms(s.reactionMs)} after a target appears.`,
        tip: 'Nice. Make sure speed never costs you the landing.',
      });
  }
  if (ok(s.correctionMs) && ok(s.ballisticMs) && s.correctionMs > 250 && s.correctionMs > s.ballisticMs * 1.2)
    out.push({
      id: 'slow-fix',
      kind: 'fix',
      weight: 0.35 + s.correctionMs / 1500,
      title: 'You spend longer fixing than flicking',
      body: `Your main movement takes about ${ms(s.ballisticMs)}, then you spend another ${ms(s.correctionMs)} adjusting (${s.corrections.toFixed(1)} small moves per target).`,
      tip: 'Trust your first movement more. In the Practice Range, flick to a head and freeze without clicking — check where you landed.',
      drill,
    });
  if (s.hits >= 5 && s.flickThrough > 0.4)
    out.push({
      id: 'drive-by',
      kind: 'fix',
      weight: 0.3 + s.flickThrough / 2,
      title: 'You click while still moving',
      body: `${pct(s.flickThrough)} of your hits were "drive-bys": the crosshair was still sliding when you clicked. Great when it works, but it's a coin flip under pressure.`,
      tip: 'Stop, then click. Get your speed from a faster first movement, not an earlier click.',
      drill: 'pin',
    });
  if (s.miss.total >= 3) {
    const { early, late, side } = s.miss;
    if (early >= Math.max(3, late * 2) && early >= side)
      out.push({
        id: 'early-click',
        kind: 'fix',
        weight: 0.4,
        title: 'You shoot before you arrive',
        body: `${early} of your ${s.miss.total} misses were fired while the crosshair was still short of the target.`,
        tip: 'Wait until the crosshair is actually on the target. A tiny pause beats a miss.',
        drill,
      });
    else if (late >= Math.max(3, early * 2) && late >= side)
      out.push({
        id: 'late-click',
        kind: 'fix',
        weight: 0.4,
        title: 'You shoot after sliding past',
        body: `${late} of your ${s.miss.total} misses happened after the crosshair had already gone past the target.`,
        tip: 'Your click is late or your movement is too fast to stop. Brake earlier so you arrive slowly.',
        drill,
      });
    else if (side >= Math.max(3, (early + late) * 1.5))
      out.push({
        id: 'side-miss',
        kind: 'fix',
        weight: 0.35,
        title: 'Your misses go to the side',
        body: `${side} of your ${s.miss.total} misses were beside the target, not short or long.`,
        tip: 'Your movement is off-line. Look at the exact centre of the target before moving, and keep the path straight.',
        drill,
      });
  }
  if (s.n >= 6 && ok(s.peakAt)) {
    if (s.peakAt > 0.63)
      out.push({
        id: 'late-accel',
        kind: 'fix',
        weight: 0.25,
        title: 'You speed up at the end',
        body: 'Your flicks are fastest near the finish instead of in the middle, so you arrive at full speed.',
        tip: 'A good flick is like throwing a ball to a friend: fast in the middle, soft on arrival.',
        drill,
      });
  }
  return out;
}

export interface TrackingFacts {
  acc: number;
  meanError: number;
  trail: number;
  vertical: number;
  summary: TrackingSummary;
}

export function trackingFindings(t: TrackingFacts): Finding[] {
  const out: Finding[] = [];
  const d = t.summary.delayMs;
  if (d !== null) {
    if (d > 230)
      out.push({
        id: 'track-delay',
        kind: 'fix',
        weight: 0.4 + (d - 230) / 300,
        title: `You follow about ${Math.round(d)} ms behind the target`,
        body: 'When the target changes direction, your crosshair reacts about that much later. Good trackers sit around 150–200 ms.',
        tip: "Watch the target's body and feet, not your crosshair — direction changes show up there first. A relaxed hand reacts faster than a tense one.",
        drill: 'duelist',
      });
    else if (d < 170)
      out.push({
        id: 'track-fast',
        kind: 'good',
        weight: 0.45,
        title: 'Fast reactions to strafes',
        body: `You respond to direction changes in about ${Math.round(d)} ms.`,
        tip: 'Great base. Add your own movement next (Crossfire).',
        drill: 'crossfire',
      });
  }
  if (t.trail > 0.3)
    out.push({
      id: 'trail',
      kind: 'fix',
      weight: 0.35 + t.trail / 2,
      title: 'Your crosshair trails behind',
      body: `On average you sit ${t.trail.toFixed(2)}° behind the target in the direction it's moving.`,
      tip: "Stay glued to the centre of their body. If it happens mostly after they change direction, that's reaction time, not aim — watch their feet to see the turn earlier.",
      drill: 'duelist',
    });
  else if (t.trail < -0.3)
    out.push({
      id: 'lead',
      kind: 'fix',
      weight: 0.35 + -t.trail / 2,
      title: 'You run ahead of the target',
      body: `You sit ${Math.abs(t.trail).toFixed(2)}° ahead of the target on average — you're guessing where it will go.`,
      tip: 'Follow, don’t predict. Hitscan weapons hit instantly, so there is nothing to lead.',
      drill: 'duelist',
    });
  if (t.vertical > 0.45)
    out.push({
      id: 'low',
      kind: 'fix',
      weight: 0.3 + t.vertical / 3,
      title: 'Your crosshair sags low',
      body: `You aim about ${t.vertical.toFixed(2)}° below the centre of the body. Jumps and crouches pull you down.`,
      tip: 'Keep your crosshair at chest-to-neck height. Low misses hit nothing; high misses can still hit the head.',
      drill: 'corner',
    });
  else if (t.vertical < -0.45)
    out.push({
      id: 'high',
      kind: 'fix',
      weight: 0.25,
      title: 'You aim high',
      body: `You sit ${Math.abs(t.vertical).toFixed(2)}° above centre mass.`,
      tip: 'Fine if you are landing headshots. If your accuracy is low, drop to the neck.',
    });
  if (t.summary.jitter > 1.5)
    out.push({
      id: 'jitter',
      kind: 'fix',
      weight: 0.3 + t.summary.jitter / 10,
      title: 'Your aim is shaky',
      body: `You change direction ${t.summary.jitter.toFixed(1)} more times per second than the target does. Those are tiny panicked corrections.`,
      tip: 'Loosen your grip and let your forearm glide. Shakes usually come from squeezing the mouse.',
      drill: 'duelist',
    });
  if (t.acc > 0.55)
    out.push({
      id: 'track-good',
      kind: 'good',
      weight: 0.5,
      title: 'Strong tracking',
      body: `You stayed on target ${pct(t.acc)} of the time.`,
      tip: 'Try the next level — closer targets move across your screen faster.',
    });
  else if (t.acc < 0.3)
    out.push({
      id: 'track-low',
      kind: 'fix',
      weight: 0.45,
      title: 'Hard to stay on target',
      body: `You were on target ${pct(t.acc)} of the time.`,
      tip: 'Replay an easier level: slower, smoother strafes let you learn the motion before the speed.',
      drill: 'duelist',
    });
  return out;
}

export function placementFindings(p: { error: number; vertical: number; escapes: number; count: number }): Finding[] {
  const out: Finding[] = [];
  if (p.error > 8)
    out.push({
      id: 'placement-far',
      kind: 'fix',
      weight: 0.6,
      title: 'Your crosshair waits in the wrong place',
      body: `When a head appeared, your crosshair was ${p.error.toFixed(1)}° away from it on average.`,
      tip: 'Park your crosshair on the edge of the wall where a head will pop out — not in open space and not on the floor.',
      drill: 'corner',
    });
  else if (p.error > 0 && p.error < 4)
    out.push({
      id: 'placement-good',
      kind: 'good',
      weight: 0.5,
      title: 'Great crosshair placement',
      body: `Heads appeared only ${p.error.toFixed(1)}° from your crosshair. A small nudge was all each one needed.`,
      tip: 'Take this habit into every corner you walk past in Overwatch.',
    });
  if (p.vertical > 0.8)
    out.push({
      id: 'placement-low',
      kind: 'fix',
      weight: 0.45,
      title: 'Your crosshair rests too low',
      body: `You wait about ${p.vertical.toFixed(1)}° below head height.`,
      tip: 'Raise your resting line to head height. Heads in Overwatch sit at a similar height for most heroes.',
      drill: 'corner',
    });
  else if (p.vertical < -0.8)
    out.push({
      id: 'placement-high',
      kind: 'fix',
      weight: 0.35,
      title: 'Your crosshair rests too high',
      body: `You wait about ${Math.abs(p.vertical).toFixed(1)}° above head height.`,
      tip: 'Lower your resting line to where heads actually are.',
      drill: 'corner',
    });
  if (p.count >= 6 && p.escapes / p.count > 0.25)
    out.push({
      id: 'escapes',
      kind: 'fix',
      weight: 0.4,
      title: 'Too many got away',
      body: `${p.escapes} of ${p.count} figures ducked back into cover.`,
      tip: 'Better placement means a shorter flick, which means you shoot sooner.',
      drill: 'corner',
    });
  return out;
}

export function switchingFindings(w: { switchMs: number; acc: number; kills: number }): Finding[] {
  const out: Finding[] = [];
  if (ok(w.switchMs) && w.switchMs > 650)
    out.push({
      id: 'slow-switch',
      kind: 'fix',
      weight: 0.5 + (w.switchMs - 650) / 1500,
      title: 'Slow to find the next target',
      body: `After each kill it took you about ${ms(w.switchMs)} to land a hit on someone else.`,
      tip: 'While the current target is dying, glance at the next one. Choose the one closest to your crosshair.',
      drill: 'triad',
    });
  else if (ok(w.switchMs) && w.switchMs > 0 && w.switchMs < 450)
    out.push({
      id: 'fast-switch',
      kind: 'good',
      weight: 0.45,
      title: 'Snappy target switches',
      body: `You were on the next target about ${ms(w.switchMs)} after each kill.`,
      tip: 'Keep each switch one smooth movement, not a flick plus corrections.',
    });
  if (w.acc < 0.35)
    out.push({
      id: 'switch-spray',
      kind: 'fix',
      weight: 0.4,
      title: 'Shooting before you arrive',
      body: `Only ${pct(w.acc)} of your shots hit while switching.`,
      tip: 'Arrive, then fire. Holding the trigger during the swing wastes ammo and hides nothing.',
      drill: 'triad',
    });
  return out;
}

/** Pick the most useful things to say: one strength, up to two fixes, and a next drill. */
/** Hearing: did the sound send you the right way, and quickly? */
export function hearingFindings(e: EchoSummary): Finding[] {
  const out: Finding[] = [];
  if (e.judged >= 5) {
    const wrong = e.judged - e.correct;
    if (e.rate < 0.8)
      out.push({
        id: 'wrong-way',
        kind: 'fix',
        weight: 0.7 + (0.8 - e.rate),
        title: 'You turn the wrong way',
        body: `On ${wrong} of ${e.judged} sounds your first turn went away from the target — the long way round. That can double the time it takes to face them.`,
        tip: 'Do the Audio check in Settings with your headphones: "Left" must sound left. Then turn toward the ear that hears the sound first and loudest.',
        drill: 'echo',
      });
    else if (e.rate >= 0.9)
      out.push({
        id: 'good-ears',
        kind: 'good',
        weight: 0.65,
        title: 'Your ears point you the right way',
        body: `${e.correct} of ${e.judged} first turns went the short way round. You trust the sound — that's the skill.`,
        tip: 'Next: start turning even sooner, the moment you hear it.',
      });
    if (e.behind.n >= 3 && e.front.n >= 3 && e.behind.rate < 0.7 && e.front.rate - e.behind.rate > 0.2)
      out.push({
        id: 'behind-confusion',
        kind: 'fix',
        weight: 0.75,
        title: 'Sounds behind you fool you',
        body: `In front of you, your first turn is right ${pct(e.front.rate)} of the time; behind you only ${pct(e.behind.rate)}. Front and back are the hardest directions for everyone's ears.`,
        tip: "A sound behind you is duller and more centred. When you hear that, turn a big half-circle toward whichever ear it leans to — don't search.",
        drill: 'echo',
      });
  }
  if (ok(e.turnMs) && e.n >= 5 && e.turnMs > 420)
    out.push({
      id: 'wait-to-see',
      kind: 'fix',
      weight: 0.55 + Math.min(0.4, (e.turnMs - 420) / 800),
      title: 'You wait to see before you turn',
      body: `You start turning about ${ms(e.turnMs)} after the sound. Your ears already know the way before your eyes do.`,
      tip: 'Start turning the instant you hear it, even before you are sure. Your eyes will catch the target on the way round.',
      drill: 'echo',
    });
  return out;
}

/** The headshot trade-off: heads pay double, misses pay nothing. */
export function shootingFindings(s: { shots: number; accuracy: number; headRate: number; efficiency: number }): Finding[] {
  const out: Finding[] = [];
  if (s.shots < 20) return out;
  if (s.headRate >= 0.3 && s.accuracy < 0.35)
    out.push({
      id: 'head-greed',
      kind: 'fix',
      weight: 0.75 + (0.35 - s.accuracy),
      title: 'Going for heads is costing you',
      body: `${pct(s.headRate)} of your hits were headshots, but only ${pct(s.accuracy)} of your bullets hit at all. A miss deals nothing, so right now you'd do more damage aiming at the chest.`,
      tip: 'Aim at the upper chest until you hit most of your shots. Then nudge your aim up to the head.',
    });
  else if (s.accuracy >= 0.55 && s.headRate < 0.15)
    out.push({
      id: 'aim-higher',
      kind: 'fix',
      weight: 0.55,
      title: 'You can afford to aim higher',
      body: `You hit ${pct(s.accuracy)} of your bullets, but only ${pct(s.headRate)} of hits were heads. A headshot does double damage, so even if your accuracy drops a little, you'll deal more.`,
      tip: "Track the neck rather than the chest: the misses go into the body, and the hits go into the head.",
    });
  if (s.efficiency >= 1 && s.headRate >= 0.25)
    out.push({
      id: 'heads-pay',
      kind: 'good',
      weight: 0.7,
      title: 'Your headshots are paying off',
      body: `You dealt ${pct(s.efficiency)} of all-body-shot damage: the headshots more than covered your misses.`,
      tip: 'Keep the same height, try a harder level.',
    });
  return out;
}

export function feedback(findings: readonly Finding[]): { good: Finding | null; fixes: Finding[]; next: DrillId | null } {
  const sorted = [...findings].sort((a, b) => b.weight - a.weight);
  const fixes = sorted.filter((f) => f.kind === 'fix').slice(0, 2);
  const good = sorted.find((f) => f.kind === 'good') ?? null;
  const next = fixes.find((f) => f.drill)?.drill ?? good?.drill ?? null;
  return { good, fixes, next };
}

/**
 * Real-time cues during a drill. Speaks rarely (every few seconds at most) and only about patterns,
 * never about a single flick.
 */
export class LiveCoach {
  private readonly recent: FlickRecord[] = [];
  private cool = 4;

  constructor(
    private readonly say: (text: string, tone: 'fix' | 'good') => void,
    public enabled = true,
  ) {}

  tick(dt: number): void {
    this.cool -= dt;
  }

  /** A one-off cue from a drill's own logic (still rate-limited). */
  nudge(text: string, tone: 'fix' | 'good'): void {
    this.emit(text, tone);
  }

  private emit(text: string, tone: 'fix' | 'good'): void {
    if (!this.enabled || this.cool > 0) return;
    this.say(text, tone);
    this.cool = 7;
    this.recent.length = 0;
  }

  flick(r: FlickRecord): void {
    this.recent.push(r);
    if (this.recent.length > 5) this.recent.shift();
    const judged = this.recent.slice(-4).filter((x) => x.cls !== 'micro');
    if (judged.length < 3) return;
    const over = judged.filter((x) => x.cls === 'overshoot').length;
    const under = judged.filter((x) => x.cls === 'undershoot').length;
    const avgReact = judged.reduce((s, x) => s + x.reactionMs, 0) / judged.length;
    const avgCurve = judged.reduce((s, x) => s + x.curve, 0) / judged.length;
    const driveBys = judged.filter((x) => x.flickThrough).length;
    if (over >= 3) this.emit('Flying past — ease off a little earlier.', 'fix');
    else if (under >= 3) this.emit('Stopping short — throw the whole distance.', 'fix');
    else if (avgCurve > 0.16) this.emit('Go straight: eyes first, then move.', 'fix');
    else if (avgReact > 400) this.emit('Stay loose — start moving sooner.', 'fix');
    else if (driveBys >= 3) this.emit('Stop, then click.', 'fix');
    else if (judged.length >= 4 && judged.every((x) => x.cls === 'clean')) this.emit('Clean landings — keep that rhythm.', 'good');
  }

  tracking(window: { trail: number; vertical: number; acc: number }): void {
    if (window.trail > 0.45) this.emit("You're behind — watch their body, react sooner.", 'fix');
    else if (window.vertical > 0.6) this.emit('Crosshair drifting low — lift to the chest.', 'fix');
    else if (window.trail < -0.45) this.emit('Running ahead — follow, don’t guess.', 'fix');
    else if (window.acc > 0.6) this.emit('Glued on. Nice.', 'good');
  }
}
