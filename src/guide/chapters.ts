import type { Game } from '../core/game';
import { cmPer360, degPerCm, edpi, mmForDegrees, STYLE_BANDS, styleFor } from '../core/sens';
import type { Drill } from '../drills/drill';
import { SnapDrill, PinDrill } from '../drills/flick';
import { CornerWatchDrill } from '../drills/placement';
import { ProtractorDrill } from '../drills/range';
import { TriadDrill } from '../drills/switching';
import { CrossfireDrill, DuelistDrill } from '../drills/tracking';
import * as D from './diagrams';

export interface Ctx {
  sens: number;
  dpi: number;
}

export interface DrillLink {
  id: string;
  name: string;
  blurb: string;
  make: (g: Game) => Drill;
}

export interface Chapter {
  slug: string;
  n: string;
  title: string;
  tag: 'CONCEPT' | 'DRILL' | 'PLAN';
  thesis: string;
  sections: (c: Ctx) => { h: string; html: string }[];
  diagram?: (c: Ctx) => { svg: string; caption: string };
  drills: DrillLink[];
  exercises: { title: string; detail: string; dose: string }[];
  cta?: { label: string; route: 'calibrate' | 'range' | 'tools' };
}

const live = (s: string) => `<span class="live">${s}</span>`;

export const DRILLS = {
  protractor: {
    id: 'protractor',
    name: 'Protractor',
    blurb: 'No targets. Sweep 360° along a ruler and check your real hand travel against the maths.',
    make: (g: Game) => new ProtractorDrill(g),
  },
  corner: {
    id: 'corner',
    name: 'Corner Watch',
    blurb: 'Hold three angles. Figures peek from 20 m fins; we record where your crosshair sat when each head appeared.',
    make: (g: Game) => new CornerWatchDrill(g),
  },
  smooth: {
    id: 'duelist-smooth',
    name: 'Duelist · Smooth',
    blurb: 'Long readable strafes at 80% speed. Learn to stay glued before the ADAD starts.',
    make: (g: Game) => new DuelistDrill(g, 'smooth'),
  },
  duelist: {
    id: 'duelist',
    name: 'Duelist',
    blurb: 'Ranked-style ADAD: 5.5 m/s, instant direction changes, jumps and crouch-spam. Hold fire.',
    make: (g: Game) => new DuelistDrill(g, 'duel'),
  },
  snap: {
    id: 'snap',
    name: 'Snap',
    blurb: '18 targets, 25–130° away. Every flick is classified: overshoot, undershoot or clean.',
    make: (g: Game) => new SnapDrill(g),
  },
  triad: {
    id: 'triad',
    name: 'Triad',
    blurb: 'Three strafers. Kill, switch, kill. Measures the gap between a kill and your next hit.',
    make: (g: Game) => new TriadDrill(g),
  },
  pin: {
    id: 'pin',
    name: 'Pin',
    blurb: 'Tiny targets 24–33 m out, a few degrees apart. Pure micro-adjustment.',
    make: (g: Game) => new PinDrill(g),
  },
  crossfire: {
    id: 'crossfire',
    name: 'Crossfire',
    blurb: 'A duel where your shots only deal damage while you are moving.',
    make: (g: Game) => new CrossfireDrill(g),
  },
} satisfies Record<string, DrillLink>;

export const CHAPTERS: Chapter[] = [
  {
    slug: 'the-360',
    n: '01',
    title: 'The 360',
    tag: 'CONCEPT',
    thesis: 'Sensitivity is a distance, not a number.',
    sections: ({ sens, dpi }) => {
      const cm = cmPer360(sens, dpi);
      const style = styleFor(cm);
      return [
        {
          h: 'Why it matters',
          html: `<p>Overwatch turns your camera <b>0.0066° for every count</b> your mouse reports, multiplied by your sensitivity. Your DPI decides how many counts one inch of hand movement produces. So "5 sensitivity" means nothing on its own: 5 at 800 DPI and 5 at 1600 DPI are twice as fast as each other.</p>
          <p>The number that survives a new mouse, a DPI change or a different game is <b>cm/360</b>: how far your hand travels for one full turn.</p>`,
        },
        {
          h: 'Your numbers',
          html: `<p>At ${live(`${sens.toFixed(2)} @ ${dpi} DPI`)} you turn ${live(`${degPerCm(sens, dpi).toFixed(1)}° per cm`)}. A full turn takes ${live(`${cm.toFixed(1)} cm`)}, a 180 takes ${live(`${(cm / 2).toFixed(1)} cm`)}. Your eDPI (sensitivity × DPI) is ${live(String(Math.round(edpi(sens, dpi))))} — the quick way to compare setups with other players.</p>`,
        },
        {
          h: 'Wrist, hybrid, arm',
          html: `<ul>${(Object.keys(STYLE_BANDS) as (keyof typeof STYLE_BANDS)[])
            .map((k) => {
              const b = STYLE_BANDS[k];
              return `<li><b>${b.label} · ${b.range[0]}–${b.range[1]} cm/360.</b> ${b.blurb}${k === style ? ` ${live('you are here')}` : ''}</li>`;
            })
            .join('')}</ul><p>None of these is correct. They're trade-offs between speed and stability — which is exactly why you calibrate instead of copying someone.</p>`,
        },
        {
          h: 'Common mistakes',
          html: `<ul><li>Changing DPI without scaling sensitivity to match (new sens = old sens × old DPI ÷ new DPI).</li><li>Copying a pro's sensitivity without their DPI — or their arm.</li><li>Leaving Windows "Enhance pointer precision" on for the desktop and wondering why aim trainers feel different. Overwatch reads raw input; Azimuth asks your browser for raw input too (Chromium supports it).</li></ul>`,
        },
      ];
    },
    diagram: ({ sens, dpi }) => ({
      svg: D.ruler360(cmPer360(sens, dpi)),
      caption: 'Live: your current setting drawn to scale on a ruler, and where it sits among common aiming styles.',
    }),
    drills: [DRILLS.protractor],
    exercises: [
      {
        title: 'Measure your real space',
        detail: 'Sit how you play and measure the width you can sweep without lifting the mouse. If that sweep turns you less than 180°, you will lift mid-fight — that’s a sign your sensitivity is too low for your space.',
        dose: '2 min',
      },
      {
        title: 'Verify with a ruler',
        detail: 'Run Protractor: put the mouse against a ruler, sweep until the rotation reads 360°, check the distance. More than ±5% off means your mouse’s real DPI differs from its label — Instruments → DPI check corrects the maths.',
        dose: '5 min',
      },
      {
        title: 'The 180 test in Overwatch',
        detail: 'In the Practice Range, stand facing a wall edge and flick 180° to a marker behind you ten times. Consistent landings mean your arm already knows the distance.',
        dose: '10 reps',
      },
    ],
  },
  {
    slug: 'finding-your-number',
    n: '02',
    title: 'Finding your number',
    tag: 'CONCEPT',
    thesis: 'Let your hands vote. Blind.',
    sections: () => [
      {
        h: 'The method (PSA)',
        html: `<p>The community standard is the <b>Perfect Sensitivity Approximation</b>: start from your current sensitivity, test half of it and one-and-a-half times it, keep the better one. The one you rejected is replaced by the midpoint of the pair, so every round halves the window.</p><p>Seven rounds take you from ±50% down to about ±0.4% — a binary search where the comparison is your own motor control.</p>`,
      },
      {
        h: 'Why blind',
        html: `<p>If you see "5.00" against "3.75" you will pick the one that matches what you already believe. Azimuth hides the numbers and shuffles which sample comes first, so the only thing you're judging is <em>control</em>.</p>`,
      },
      {
        h: 'What "better" means',
        html: `<p>Pick the sample where you felt in charge: fewer surprise overshoots, smoother tracking, a looser grip. Scores are shown as a tie-breaker, not a verdict. If your hands and the numbers disagree round after round, you're probably tired — stop and finish tomorrow.</p>`,
      },
      {
        h: 'After the result',
        html: `<p>Set it in Overwatch (<b>Options → Controls → Mouse sensitivity</b>) and leave it alone for a week. Muscle memory needs days to adapt, and the first sessions will feel odd even when the number is right. Then, if something still bugs you, run <b>Fine-tune</b> (±10%).</p>`,
      },
    ],
    diagram: () => ({ svg: D.funnel(), caption: 'Each round keeps one side and halves the window around your preference.' }),
    drills: [],
    cta: { label: 'Start calibration', route: 'calibrate' },
    exercises: [
      { title: 'Warm up first', detail: 'Ten minutes of your normal warm-up before calibrating. Cold hands pick slow sensitivities.', dose: '10 min' },
      {
        title: 'Same chair, same time',
        detail: 'Calibrate in your real setup when fresh. Re-run a week later at the same time of day; a result that repeats is a result you can trust.',
        dose: 'weekly',
      },
      {
        title: 'Hero check',
        detail: 'Take the result to the Practice Range on your two most-played heroes — one tracking, one flicking. If one hates it, re-run with that focus selected.',
        dose: '15 min',
      },
    ],
  },
  {
    slug: 'placement',
    n: '03',
    title: 'Crosshair placement',
    tag: 'DRILL',
    thesis: 'The best flick is the one you never have to make.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>Your reaction time is roughly fixed; your movement isn't. If your crosshair already sits at head height on the edge where an enemy will appear, the kill is a tiny adjustment. If it's on the floor or in open space, you've stacked a big flick on top of your reaction — and big flicks miss more often.</p>`,
      },
      {
        h: 'How',
        html: `<ul><li><b>Head height, always.</b> Most of the roster's heads sit in a similar band; keep your resting line there.</li><li><b>Hug the edge.</b> Aim at the sliver of space where a head will first appear, not at the middle of a doorway.</li><li><b>Slice the pie.</b> Rounding a corner, let your crosshair lead your body so each new angle is pre-aimed.</li><li><b>Adjust for height.</b> High ground and stairs shift where heads appear — shift your line with them.</li></ul>`,
      },
      {
        h: 'Common mistakes',
        html: `<ul><li>Looking at the floor while walking.</li><li>Aiming at the centre of doors instead of their edges.</li><li>Snapping back to where an enemy <em>was</em> instead of where they'll return.</li></ul>`,
      },
    ],
    diagram: () => ({ svg: D.placement(), caption: 'Same enemy, same reaction time. One crosshair needs an 18° flick, the other needs almost nothing.' }),
    drills: [DRILLS.corner],
    exercises: [
      {
        title: 'Walk the map',
        detail: 'Custom game, no enemies. Walk a whole map with your crosshair on the edge of every corner at head height. Say "edge" each time you re-place it. It feels silly; it works.',
        dose: '1 map',
      },
      { title: 'Placement-only Deathmatch', detail: 'Play one Deathmatch thinking only about crosshair height. Ignore the scoreboard.', dose: '1 game' },
      { title: 'Replay review', detail: 'Watch five of your deaths from your own POV. Where was your crosshair when the enemy appeared?', dose: '5 deaths' },
    ],
  },
  {
    slug: 'tracking',
    n: '04',
    title: 'Tracking',
    tag: 'DRILL',
    thesis: 'Stay glued. Follow, don’t chase.',
    sections: ({ sens, dpi }) => {
      const cm = cmPer360(sens, dpi);
      const v10 = ((5.5 / 10) * 180) / Math.PI;
      return [
        {
          h: 'Why it matters',
          html: `<p>Soldier: 76, Tracer, Sombra, Bastion, Zarya, Symmetra and Moira deal damage every moment you're on target. Overwatch strafes are brutal: heroes run 5.5 m/s with <b>no acceleration</b>, so they reverse direction instantly. At 10 m that strafe crosses your view at ${live(`${v10.toFixed(0)}°/s`)} — at your settings that's ${live(`${((v10 * cm) / 360).toFixed(1)} cm/s`)} of mouse movement, reversing several times a second.</p>`,
        },
        {
          h: 'How',
          html: `<ul><li><b>Upper chest / neck.</b> Small upward misses become crits, small downward misses still hit.</li><li><b>Relax your grip.</b> Tension turns smooth corrections into jerks.</li><li><b>React, don't predict.</b> Follow each strafe; guessing the next one makes you lead into empty space.</li><li><b>Mirror strafe.</b> Move the same way as your target — your own movement cancels part of theirs and your mouse has less to do.</li></ul>`,
        },
        {
          h: 'Reading the scope',
          html: `<p>The oscilloscope bottom-right plots your error in real time: <b>white</b> is horizontal error, <b>blue</b> vertical, the <b>vermilion band</b> is the target's width, the ribbon underneath is time on target. A white line sitting on one side of zero while the target moves means you're lagging; spikes right after reversals mean late reactions.</p>`,
        },
        {
          h: 'Common mistakes',
          html: `<ul><li>Holding your breath and tensing up.</li><li>Over-correcting after a reversal (the trace punches through the band).</li><li>Chasing the head with a weapon you can't control there yet.</li></ul>`,
        },
      ];
    },
    diagram: ({ sens, dpi }) => ({
      svg: D.trackingCurve(cmPer360(sens, dpi)),
      caption: 'Close targets are much harder to track: angular speed rises as 1 / distance. Mouse speeds are for your current setting.',
    }),
    drills: [DRILLS.smooth, DRILLS.duelist],
    exercises: [
      {
        title: 'Practice Range moving bots',
        detail: 'Soldier: 76 or Tracer on the moving bots. Only hold fire while you’re on target. Three 60-second sets; fewer reloads for the same eliminations = better tracking.',
        dose: '3 × 60 s',
      },
      { title: 'Mirror strafing', detail: 'Same bots, but strafe the same direction they do. Feel how much less your mouse has to travel.', dose: '3 × 60 s' },
      { title: 'First to 10', detail: 'A hitscan 1v1 with a friend in a custom game. Review the duel you lost worst.', dose: '15 min' },
    ],
  },
  {
    slug: 'flicking',
    n: '05',
    title: 'Flicking',
    tag: 'DRILL',
    thesis: 'Commit, then correct — once.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>Cassidy, Widowmaker, Ashe, Hanzo, Ana and Kiriko deal their damage in single decisive shots. A flick is two movements: one big ballistic move that gets you close, then a small correction. Whether that first move tends to stop short or fly past says a lot about your sensitivity — and your technique.</p>`,
      },
      {
        h: 'Overshoot vs undershoot',
        html: `<p><b>Overshoot:</b> the first move carries past the target and you come back. <b>Undershoot:</b> you stop short and creep on. Some of both is normal. If one dominates across several sessions it's a hint: steady overshoot suggests a slightly high sensitivity (or flicking too hard), steady undershoot suggests slightly low (or hesitation). Snap classifies every flick for you.</p>`,
      },
      {
        h: 'How',
        html: `<ul><li><b>Eyes first.</b> Look at the target, then move — your hand follows your eyes.</li><li><b>One confident motion.</b> Don't steer the crosshair there; throw it.</li><li><b>Click on arrival,</b> not on hope.</li><li><b>Reset.</b> Settle the crosshair before the next flick instead of chaining panicked movements.</li></ul>`,
      },
      {
        h: 'Common mistakes',
        html: `<ul><li>Clicking mid-movement and calling it a flick.</li><li>Crawling onto targets with three or four tiny corrections.</li><li>Tensing the forearm before you move.</li></ul>`,
      },
    ],
    diagram: () => ({ svg: D.flickProfile(), caption: 'Where the ballistic phase ends tells you everything: past the band = overshoot, short of it = undershoot.' }),
    drills: [DRILLS.snap],
    exercises: [
      {
        title: 'Flick & freeze',
        detail: 'Practice Range static bots: flick to a head and freeze without clicking. Did you land on it? Taking the click away takes the panic away.',
        dose: '20 reps',
      },
      { title: 'Three-bot rotation', detail: 'Cassidy or unscoped Widowmaker: one shot per bot across three distances, as fast as accuracy allows.', dose: '5 rounds' },
      { title: 'Log your bias', detail: 'Run Snap three days in a row and write down over/undershoot. A stable bias is real data for your next fine-tune.', dose: '3 days' },
    ],
  },
  {
    slug: 'switching',
    n: '06',
    title: 'Target switching',
    tag: 'DRILL',
    thesis: 'Kill, then find the closest angle.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>Team fights have more than one enemy. Every millisecond between a kill and your first shot on the next target is lost damage. Good switching is a decision made early plus one clean movement.</p>`,
      },
      {
        h: 'How',
        html: `<ul><li><b>Pick next before this one dies.</b> A glance, not a search.</li><li><b>Closest angle first</b> — unless someone is far lower or far more dangerous (the Ana about to sleep you).</li><li><b>One motion.</b> Not a flick plus three corrections.</li></ul>`,
      },
      {
        h: 'Common mistakes',
        html: `<ul><li>Watching the death animation.</li><li>Swinging to the farthest target first.</li><li>Firing before you've arrived on the new target.</li></ul>`,
      },
    ],
    diagram: () => ({ svg: D.switching(), caption: 'Order by angular distance from where your crosshair already is.' }),
    drills: [DRILLS.triad],
    exercises: [
      { title: 'Bot ladder', detail: 'Practice Range: 100 damage to a bot, then switch — always to the closest angle.', dose: '5 min' },
      { title: 'Call it out', detail: 'In Deathmatch, whenever two enemies are visible, say who you’ll shoot and why before you shoot.', dose: '1 game' },
    ],
  },
  {
    slug: 'precision',
    n: '07',
    title: 'Precision',
    tag: 'DRILL',
    thesis: 'Small targets need small muscles.',
    sections: ({ sens, dpi }) => {
      const deg = 2 * ((Math.atan(0.2 / 30) * 180) / Math.PI);
      return [
        {
          h: 'Why it matters',
          html: `<p>Long-range heads are tiny. A head roughly 0.4 m wide at 30 m covers ${live(`${deg.toFixed(2)}°`)} of your view — at your sensitivity that's ${live(`${mmForDegrees(deg, sens, dpi).toFixed(2)} mm`)} of mouse travel. Shoulder and forearm are fast but coarse; wrist and fingers are slow but fine. Precision is the hand-over between them.</p>`,
        },
        {
          h: 'How',
          html: `<ul><li><b>Approach fast, finish slow.</b> Arm for distance, fingertips for the last few millimetres.</li><li><b>Anchor.</b> Keep your forearm or wrist planted so fingers have a stable base.</li><li><b>Accept a pause.</b> One confirmed hit beats two quick misses.</li></ul>`,
        },
        {
          h: 'Common mistakes',
          html: `<ul><li>Clicking while still sliding past the target.</li><li>Gripping harder to be precise — it does the opposite.</li></ul>`,
        },
      ];
    },
    diagram: ({ sens, dpi }) => {
      const deg = 2 * ((Math.atan(0.2 / 30) * 180) / Math.PI);
      return { svg: D.precision(mmForDegrees(deg, sens, dpi), deg), caption: 'The whole target is smaller than a grain of rice on your mousepad.' };
    },
    drills: [DRILLS.pin],
    exercises: [
      { title: 'Far bots', detail: 'Practice Range far bots with Cassidy or Ashe: 3 sets of 10 headshots; restart a set after two misses in a row.', dose: '3 × 10' },
      { title: 'Fingertip isolation', detail: 'Rest your wrist completely and run Pin moving only your fingers. Learn how far fingers alone can take you.', dose: '2 min' },
    ],
  },
  {
    slug: 'movement',
    n: '08',
    title: 'Move while you shoot',
    tag: 'DRILL',
    thesis: 'In Overwatch, your legs are part of your aim.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>Unlike Counter-Strike or VALORANT, Overwatch's hitscan weapons don't lose accuracy while you move. There's no reason to stand still while shooting — and every reason not to, because a planted target is the easiest headshot in the game.</p><p>Heroes move at <b>5.5 m/s</b>, backpedal at <b>90%</b> of that, crouch-walk at <b>3 m/s</b>, and there's no acceleration: direction changes are instant. That's what makes a good ADAD so hard to hit — and why Azimuth's range reproduces it exactly.</p>`,
      },
      {
        h: 'How',
        html: `<ul><li><b>Irregular ADAD.</b> Short, uneven strafes. Rhythm is predictable; randomness isn't.</li><li><b>Crouch at close range</b> to drop your head out of their line (crouch-spam).</li><li><b>Jump sparingly.</b> In the air you're committed to one arc.</li><li><b>Hand compensates for body.</b> Your crosshair should stay on target while your legs do whatever they want.</li></ul>`,
      },
      {
        h: 'Common mistakes',
        html: `<ul><li>Standing still to "focus" on aim.</li><li>Metronome ADAD.</li><li>Backpedalling in a straight line — slower and fully predictable.</li></ul>`,
      },
    ],
    diagram: () => ({ svg: D.movement(), caption: 'Your movement costs you nothing — their tracking has to pay for it.' }),
    drills: [DRILLS.crossfire],
    exercises: [
      { title: 'Never plant', detail: 'One Deathmatch with one rule: if you are shooting, you are moving. Have a friend spectate and call every time you stop.', dose: '1 game' },
      { title: 'Crouch timing', detail: 'In close-range 1v1s, crouch once per duel right as your opponent starts firing.', dose: '10 duels' },
    ],
  },
  {
    slug: 'routine',
    n: '09',
    title: 'The routine',
    tag: 'PLAN',
    thesis: 'Ten minutes every day beats two hours on Sunday.',
    sections: () => [
      {
        h: 'Why',
        html: `<p>Aim is motor learning. Short, frequent, focused sessions consolidate better than rare marathons, and a warm-up primes your hands before ranked instead of wasting your first two fights.</p>`,
      },
      {
        h: 'The daily ten',
        html: `<ol><li><b>Duelist · Smooth</b> — 2 min: get glued.</li><li><b>Duelist</b> — 2 min: ADAD reads.</li><li><b>Snap</b> — 2 min: check your over/undershoot.</li><li><b>Triad</b> — 2 min: decisions under pressure.</li><li><b>Pin</b> — 1 min: slow hands.</li><li><b>Crossfire</b> — 1 min: move while you shoot.</li></ol>`,
      },
      {
        h: 'The week',
        html: `<p>Monday to Friday: the daily ten, then one Deathmatch, then queue. Saturday: one calibration check (Snap bias). Sunday: rest. Change sensitivity only after a full week of data — never mid-session.</p>`,
      },
      {
        h: 'Track it',
        html: `<p>Personal bests save automatically. Read trends across days, not single runs.</p>`,
      },
    ],
    diagram: () => ({ svg: D.routine(), caption: 'Ten minutes, ordered from smooth to demanding.' }),
    drills: [DRILLS.smooth, DRILLS.duelist, DRILLS.snap, DRILLS.triad, DRILLS.pin, DRILLS.crossfire],
    exercises: [
      { title: 'The five-day block', detail: 'Do the daily ten five days in a row. On day five compare your bests with day one.', dose: '5 days' },
      { title: 'Never queue cold', detail: 'Routine → one Deathmatch → ranked. Every session.', dose: 'always' },
    ],
  },
];
