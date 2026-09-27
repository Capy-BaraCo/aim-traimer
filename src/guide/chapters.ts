/**
 * The Field Manual, written for someone who has never thought about aim before.
 * Short sentences. Every term explained the first time. Every idea ends in something to do.
 */

import type { DrillId } from '../core/coach';
import { cmPer360, degPerCm, edpi, mmForDegrees, STYLE_BANDS, styleFor } from '../core/sens';
import * as D from './diagrams';

export interface Ctx {
  sens: number;
  dpi: number;
}

export interface Chapter {
  slug: string;
  n: string;
  title: string;
  tag: 'BASICS' | 'SKILL' | 'PLAN' | 'WORDS';
  /** The whole chapter in one sentence. */
  short: string;
  /** Think of it like… */
  analogy?: string;
  sections: (c: Ctx) => { h: string; html: string }[];
  /** "If this happens → do this" */
  fixes?: [string, string][];
  diagram?: (c: Ctx) => { svg: string; caption: string };
  drills: (DrillId | 'protractor')[];
  exercises: { title: string; detail: string; dose: string }[];
  cta?: { label: string; route: 'calibrate' | 'training' | 'logbook' };
}

export const GLOSSARY: Record<string, string> = {
  DPI: 'How many "dots" your mouse reports for every inch you move it. You set it in your mouse software. Higher DPI = more dots per inch.',
  Sensitivity: 'The number in Overwatch’s settings. It multiplies your mouse movement. Together with DPI it decides how far you turn.',
  eDPI: 'DPI × sensitivity. One number to compare setups: 800 DPI × 5 sensitivity = 4000 eDPI.',
  'cm/360': 'How many centimetres you move your mouse to spin all the way around once. The most honest way to describe a sensitivity.',
  FOV: 'Field of view: how wide you can see. Overwatch’s maximum (and the usual choice) is 103.',
  Flick: 'A fast mouse movement from where you are aiming to a new target.',
  Tracking: 'Keeping your crosshair on a moving target.',
  'Micro-adjustment': 'A tiny correction after a flick to land exactly on the target.',
  Overshoot: 'Your movement carries you past the target, so you have to come back.',
  Undershoot: 'Your movement stops before the target, so you have to creep the rest of the way.',
  'Crosshair placement': 'Where your crosshair waits before an enemy appears.',
  ADAD: 'Tapping A and D (left and right) to dodge in an unpredictable rhythm.',
  Hitscan: 'Weapons that hit the instant you click, exactly where you aim — Soldier: 76, Cassidy, Widowmaker, Ashe.',
  Projectile: 'Weapons that fire something that travels, so you aim ahead of the target — Genji, Hanzo, Pharah.',
  PSA: 'Perfect Sensitivity Approximation: compare a lower and a higher sensitivity, keep the better one, and repeat until you land on your number.',
  'Raw input': 'Mouse movement exactly as the mouse measured it, without Windows speeding it up or slowing it down.',
  'Reaction time': 'The gap between something appearing and your hand starting to move.',
  'Range effect': 'Most people flick short distances too far and long distances too short. It is normal, and practice fixes it.',
  'Landing point': 'Where your first big movement stops, compared with the target. 100% means you stopped exactly on it.',
};

/** Inline glossary term with a hover/focus definition. */
export const term = (word: string, label = word): string =>
  `<dfn class="term" tabindex="0" data-def="${(GLOSSARY[word] ?? '').replace(/"/g, '&quot;')}">${label}</dfn>`;

const live = (s: string) => `<span class="live">${s}</span>`;

export const CHAPTERS: Chapter[] = [
  {
    slug: 'the-360',
    n: '01',
    title: 'What sensitivity really is',
    tag: 'BASICS',
    short: 'Your sensitivity is really a distance: how far your hand moves to turn your character around.',
    analogy: 'Like the gears on a bike. Low gear: lots of pedalling, very precise. High gear: a little pedalling, you fly — but it’s harder to control.',
    sections: ({ sens, dpi }) => {
      const cm = cmPer360(sens, dpi);
      return [
        {
          h: 'The two numbers',
          html: `<p>Two settings decide how fast you turn: your mouse's ${term('DPI')} and Overwatch's ${term('Sensitivity', 'sensitivity')}. Change either one and your aim changes.</p>
          <p>That is why "I play on 5" means nothing on its own. Five on one mouse can be twice as fast as five on another.</p>`,
        },
        {
          h: 'The one number that matters',
          html: `<p>Instead, measure ${term('cm/360')}: how many centimetres your hand moves to spin all the way around once. That number means the same thing on any mouse, any settings, any game.</p>
          <p>Right now you are on ${live(`${sens.toFixed(2)} at ${dpi} DPI`)}. That means:</p>
          <ul><li>A full spin takes ${live(`${cm.toFixed(1)} cm`)} of mouse movement.</li><li>Turning around (180°) takes ${live(`${(cm / 2).toFixed(1)} cm`)}.</li><li>Every centimetre turns you ${live(`${degPerCm(sens, dpi).toFixed(1)}°`)}.</li><li>Your ${term('eDPI')} is ${live(String(Math.round(edpi(sens, dpi))))}.</li></ul>`,
        },
        {
          h: 'Three ways people aim',
          html: `<ul>${(Object.keys(STYLE_BANDS) as (keyof typeof STYLE_BANDS)[])
            .map((k) => {
              const b = STYLE_BANDS[k];
              return `<li><b>${b.label} aimers (${b.range[0]}–${b.range[1]} cm per spin).</b> ${b.blurb}${k === styleFor(cm) ? ` ${live('← you')}` : ''}</li>`;
            })
            .join('')}</ul><p>None of these is "correct". Faster is easier for turning, slower is easier for precision. That trade-off is exactly what the calibration finds for <em>you</em>.</p>`,
        },
      ];
    },
    fixes: [
      ['You changed DPI and everything feels wrong', 'Keep the same feel: new sensitivity = old sensitivity × old DPI ÷ new DPI. Instruments does the maths.'],
      ['You copied a pro’s sensitivity and hate it', 'Their DPI, arm and desk are different. Run Calibrate to find yours.'],
      ['The same hand movement turns you different amounts', 'Turn off "Enhance pointer precision" in Windows mouse settings, and use Chrome or Edge here for raw input.'],
    ],
    diagram: ({ sens, dpi }) => ({
      svg: D.ruler360(cmPer360(sens, dpi)),
      caption: 'Your current setting on a ruler, and where it sits among the three aiming styles.',
    }),
    drills: ['protractor'],
    exercises: [
      {
        title: 'Measure your space',
        detail: 'Sit how you play. Measure how far you can slide the mouse without lifting it. If that full slide turns you less than 180°, your sensitivity is probably too low for your desk.',
        dose: '2 min',
      },
      {
        title: 'Check with a ruler',
        detail: 'Run the Protractor below: slide the mouse along a ruler until you have spun 360°. Did your hand move the distance above? More than 5% off means your mouse’s real DPI differs from the box.',
        dose: '5 min',
      },
    ],
  },
  {
    slug: 'finding-your-number',
    n: '02',
    title: 'Finding your number',
    tag: 'BASICS',
    short: 'You find your sensitivity by comparing two options at a time and always keeping the better one.',
    analogy: 'Like an eye test at the optician: "Better with lens one… or lens two?" Repeat until it’s sharp.',
    sections: () => [
      {
        h: 'How it works',
        html: `<p>This method is called ${term('PSA')}. It goes like this:</p>
        <ol><li>Start from the sensitivity you use now.</li><li>Play a short test at <b>half</b> of it and another at <b>one and a half times</b> it.</li><li>Keep the one that felt better. The other one moves halfway towards it.</li><li>Repeat. Each round the two options get closer together.</li></ol>
        <p>After seven rounds you're within half a percent of your ideal number.</p>`,
      },
      {
        h: 'Why the numbers are hidden',
        html: `<p>If you could see "5.00" and "3.75", you'd pick the one you're used to. So the two options are called <b>α</b> and <b>β</b> and shuffled every round. You choose by feel alone.</p>`,
      },
      {
        h: 'What each test contains',
        html: `<p>Each option is a short test with up to three parts (you can switch any off):</p>
        <ul><li><b>Tracking</b> — follow a dodging enemy while holding fire.</li><li><b>Short flicks</b> — targets pop up on your screen, close to your crosshair. This is most of Overwatch.</li><li><b>Wide flicks</b> — targets appear anywhere around you, even behind.</li></ul>
        <p>Short flicks usually like a lower sensitivity (precision). Wide flicks like a higher one (speed). Your number is the best balance for you.</p>`,
      },
      {
        h: 'Choosing',
        html: `<p>Pick the one where you felt <em>in control</em>: fewer surprise overshoots, smoother tracking, a looser grip. Scores are shown to break ties — they're not the boss. If you really can't tell, pick the one you'd rather play a whole match with.</p>`,
      },
      {
        h: 'Afterwards',
        html: `<p>Type the number into Overwatch (<b>Options → Controls → Mouse sensitivity</b>) and don't touch it for a week. It will feel strange at first even when it's right — your hands need a few days to adjust.</p>`,
      },
    ],
    fixes: [
      ['Every option feels the same', 'You are near your number already. Choose either and finish; the last rounds are tiny differences.'],
      ['Your picks keep disagreeing with the scores', 'You might be tired. Stop, come back fresh, and redo it.'],
    ],
    diagram: () => ({ svg: D.funnel(), caption: 'Each round keeps the side you picked and halves the gap.' }),
    drills: [],
    cta: { label: 'Start calibration', route: 'calibrate' },
    exercises: [
      { title: 'Warm up first', detail: 'Play the Daily warm-up (Training) before calibrating. Cold hands pick slow sensitivities.', dose: '5 min' },
      { title: 'Test it in the game', detail: 'Take your result into the Practice Range on your two most-played heroes. If one hates it, re-run with that focus selected.', dose: '15 min' },
    ],
  },
  {
    slug: 'placement',
    n: '03',
    title: 'Crosshair placement',
    tag: 'SKILL',
    short: 'Keep your crosshair where an enemy’s head is about to appear, so you barely have to move when they do.',
    analogy: 'Like a goalkeeper standing in the right spot before the shot. Good positioning makes hard saves look easy.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>You can't make your reactions much faster. But you <em>can</em> make the movement shorter. If your crosshair is already at head height on the edge of a wall, killing someone who walks out is a tiny nudge. If it's on the floor, it's a big ${term('Flick', 'flick')} — and big flicks miss more.</p>`,
      },
      {
        h: 'How to do it',
        html: `<ol><li><b>Head height, always.</b> Most heroes' heads are at about the same height. Keep your crosshair there.</li><li><b>Hug the edge.</b> Aim at the corner of a wall where a head will pop out — not the middle of a doorway.</li><li><b>Move your aim before your body.</b> When you walk round a corner, your crosshair should get there first.</li></ol>`,
      },
    ],
    fixes: [
      ['You keep looking at the floor while walking', 'Pick a spot on the walls at head height and "slide" your crosshair along it as you move.'],
      ['Enemies appear and you have to flick far', 'You’re aiming at open space. Aim at the edges of cover instead.'],
      ['The coach says you rest low', 'Lift your resting line to head height. Low misses hit nothing.'],
    ],
    diagram: () => ({ svg: D.placement(), caption: 'Same enemy, same reaction time: one crosshair needs a big flick, the other almost nothing.' }),
    drills: ['corner'],
    exercises: [
      { title: 'Walk the map', detail: 'In a custom game with no enemies, walk a whole map keeping your crosshair on the edge of every corner at head height.', dose: '1 map' },
      { title: 'One game, one job', detail: 'Play a Deathmatch thinking only about crosshair height. Ignore the scoreboard.', dose: '1 game' },
    ],
  },
  {
    slug: 'tracking',
    n: '04',
    title: 'Tracking',
    tag: 'SKILL',
    short: 'Tracking means keeping your crosshair glued to someone who is moving.',
    analogy: 'Like following a bird with a camera. Smooth and relaxed wins; jerky and tense loses the shot.',
    sections: ({ sens, dpi }) => {
      const v10 = ((5.5 / 10) * 180) / Math.PI;
      return [
        {
          h: 'Why it matters',
          html: `<p>Soldier: 76, Tracer, Sombra, Bastion, Zarya and others deal damage for every moment you're on target. Enemies dodge left and right at 5.5 metres per second and can change direction <em>instantly</em>.</p>
          <p>At 10 metres, that dodge crosses your screen at ${live(`${v10.toFixed(0)}° per second`)}. At your settings, your hand has to move ${live(`${((v10 * cmPer360(sens, dpi)) / 360).toFixed(1)} cm per second`)} — and reverse several times a second.</p>`,
        },
        {
          h: 'How to do it',
          html: `<ol><li><b>Aim at the chest or neck.</b> A small miss upwards still hits the head; a small miss downwards still hits the body.</li><li><b>Relax your grip.</b> Squeezing the mouse makes your aim shaky.</li><li><b>Follow, don't guess.</b> React to their dodge instead of predicting it.</li><li><b>Move with them.</b> If you strafe the same way they do, your mouse has less to do.</li></ol>`,
        },
        {
          h: 'What the coach measures',
          html: `<p><b>Reaction to dodges:</b> how many milliseconds after they change direction you follow. Good trackers are around 150–200 ms. <b>Behind/ahead:</b> whether your crosshair trails them or runs ahead. <b>Height:</b> whether you sag low. <b>Shakes:</b> extra direction changes you make that they didn't — a sign of a tense grip.</p>
          <p>The live graph in the bottom-right corner shows this while you play: the white line is how far your crosshair is from the target; the shaded band is the target's width. Stay inside the band.</p>`,
        },
      ];
    },
    fixes: [
      ['You fall behind every time they change direction', 'Watch their body and feet, not your crosshair — changes show up there first.'],
      ['Your aim looks shaky on the graph', 'Loosen your grip. Let your forearm glide on the desk.'],
      ['You drift low when they jump', 'Keep your eyes on their chest; your hand follows your eyes.'],
    ],
    diagram: ({ sens, dpi }) => ({ svg: D.trackingCurve(cmPer360(sens, dpi)), caption: 'The closer the enemy, the faster you have to move. Numbers are for your settings.' }),
    drills: ['duelist'],
    exercises: [
      { title: 'Practice Range moving bots', detail: 'Soldier: 76 on the moving bots. Only hold fire while you are on target. Three rounds of a minute.', dose: '3 × 60 s' },
      { title: 'Strafe with them', detail: 'Same bots, but move left and right in the same direction as the bot. Feel how much less your mouse moves.', dose: '3 × 60 s' },
    ],
  },
  {
    slug: 'flicking',
    n: '05',
    title: 'Flicking — short and wide',
    tag: 'SKILL',
    short: 'A flick is one quick movement to a new target, then a tiny fix, then a click.',
    analogy: 'Like throwing a dart. One smooth throw gets you close; you don’t steer the dart on the way.',
    sections: () => [
      {
        h: 'Two kinds of flick',
        html: `<p><b>Short flicks</b> go to targets already on your screen — a few degrees to about 30°. This is most kills in Overwatch: someone pops out near your crosshair. These are mostly wrist and fingers.</p>
        <p><b>Wide flicks</b> are big turns — to a flanker on your side, or someone behind you. These use your elbow and arm.</p>
        <p>They feel completely different, so you practise them separately: <b>Blink</b> for short, <b>Snap</b> for wide.</p>`,
      },
      {
        h: 'How to do it',
        html: `<ol><li><b>Eyes first.</b> Look at the target, then move. Your hand goes where your eyes are.</li><li><b>One movement.</b> Throw the crosshair there in one go. Don't drive it there slowly.</li><li><b>Stop, then click.</b> Clicking while you're still sliding is a coin flip.</li></ol>`,
      },
    ],
    fixes: [
      ['You keep going past targets (overshoot)', 'Ease off near the end of the movement. Aim to stop ON the target.'],
      ['You keep stopping before targets (undershoot)', 'Commit to the whole distance in one movement. Creeping is slow.'],
      ['You click and miss even though you were close', 'You clicked too early or while moving. Wait until you’re on it.'],
    ],
    diagram: () => ({ svg: D.flickProfile(), caption: 'The big movement either stops short, goes past, or lands clean. The small movement after it fixes the rest.' }),
    drills: ['blink', 'snap'],
    exercises: [
      { title: 'Flick & freeze', detail: 'In the Practice Range, flick to a bot’s head and freeze without clicking. Did you land on it? No click = no panic.', dose: '20 reps' },
      { title: 'Short then wide', detail: 'Do Blink, then Snap, in that order. Short first trains precision; wide second trains confidence.', dose: 'daily' },
    ],
  },
  {
    slug: 'reading-flicks',
    n: '06',
    title: 'Reading your flicks',
    tag: 'SKILL',
    short: 'Where your first movement stops tells you almost everything about your aim — and your sensitivity.',
    analogy: 'Like a golf coach watching where your ball lands. Always short? Always long? Always to the left? Each tells a different story.',
    sections: () => [
      {
        h: 'The landing point',
        html: `<p>Every flick is two movements: a big one, then a small fix. We measure where the big one stops — your ${term('Landing point', 'landing point')}. 100% means you stopped exactly on the target. 90% means 10% short. 110% means 10% past.</p>
        <p>Nobody lands on 100% every time. What matters is the <em>pattern</em>.</p>`,
      },
      {
        h: 'What the patterns mean',
        html: `<ul>
          <li><b>Mostly past (over 100%)</b> — ${term('Overshoot', 'overshooting')}. You're throwing too hard, or your sensitivity is a bit high for you.</li>
          <li><b>Mostly short (under 100%)</b> — ${term('Undershoot', 'undershooting')}. You're holding back, or your sensitivity is a bit low.</li>
          <li><b>Short flicks past, wide flicks short</b> — the ${term('Range effect', 'range effect')}. Everyone has some. It's a practice problem, not a settings problem.</li>
          <li><b>One direction weaker</b> — e.g. flicks to the right fall short. Your wrist bends further one way than the other. Use more arm for the weak side.</li>
          <li><b>Curved paths</b> — you started moving before you really looked at the target.</li>
        </ul>`,
      },
      {
        h: 'Where the time goes',
        html: `<p>We split each hit into three parts: <b>react</b> (waiting before your hand moves), <b>flick</b> (the big movement) and <b>fix</b> (corrections and the click). Most people's biggest easy win is a shorter fix — which comes from a better landing point.</p>`,
      },
      {
        h: 'When should I change sensitivity?',
        html: `<p>Only when one pattern stays the same for about a week, across short and wide flicks. Then move about 5%: lower if you overshoot, higher if you undershoot. Never change it because of one bad day.</p>`,
      },
    ],
    fixes: [
      ['Your landing map is spread everywhere', 'You are inconsistent. Slow down by about 10% — consistency first, speed later.'],
      ['Your fix time is longer than your flick time', 'Trust the first movement more. Practise "flick & freeze".'],
      ['Many hits are "drive-bys" (clicked while moving)', 'Stop, then click. Get speed from a faster throw, not an earlier click.'],
    ],
    diagram: () => ({ svg: D.flickProfile(), caption: 'Past the band = overshoot, before it = undershoot. The Logbook shows your own version of this.' }),
    drills: ['blink', 'snap'],
    cta: { label: 'Open your Logbook', route: 'logbook' },
    exercises: [
      { title: 'Read your map', detail: 'After a Blink run, open the debrief’s landing map. Are your dots left of the line (short), right of it (past), or spread out?', dose: '1 min' },
      { title: 'A week of data', detail: 'Do the Daily warm-up for seven days, then read the Logbook. If the same pattern is there all week, it’s real.', dose: '7 days' },
    ],
  },
  {
    slug: 'switching',
    n: '07',
    title: 'Target switching',
    tag: 'SKILL',
    short: 'When one enemy goes down, move straight to the next — and pick the closest one.',
    analogy: 'Like a waiter clearing tables: the fastest route is the next table over, not the one across the room.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>Team fights have several enemies. Every moment between one kill and your first shot on the next is wasted.</p>`,
      },
      {
        h: 'How to do it',
        html: `<ol><li><b>Look ahead.</b> While your target is dying, find the next one with your eyes.</li><li><b>Closest first,</b> unless someone else is nearly dead or very dangerous.</li><li><b>One clean movement</b> to the next target — not a flick plus three fixes.</li></ol>`,
      },
    ],
    fixes: [
      ['You watch the kill instead of moving on', 'The moment their health bar empties, your eyes should already be on the next enemy.'],
      ['You shoot while swinging between targets', 'Arrive, then shoot. Spraying during the swing wastes ammo.'],
    ],
    diagram: () => ({ svg: D.switching(), caption: 'After a kill, go to the nearest angle from where your crosshair already is.' }),
    drills: ['triad'],
    exercises: [{ title: 'Call it out', detail: 'In Deathmatch, when you see two enemies, say out loud who you’ll shoot and why — before you shoot.', dose: '1 game' }],
  },
  {
    slug: 'precision',
    n: '08',
    title: 'Precision',
    tag: 'SKILL',
    short: 'Tiny, faraway targets need small, slow movements from your fingers, not your arm.',
    analogy: 'Like threading a needle: you don’t swing your arm, you steady your hand and use your fingertips.',
    sections: ({ sens, dpi }) => {
      const deg = 2 * ((Math.atan(0.2 / 30) * 180) / Math.PI);
      return [
        {
          h: 'How small is small?',
          html: `<p>A head 30 metres away covers less than one degree of your screen. At your settings, the whole head is ${live(`${mmForDegrees(deg, sens, dpi).toFixed(1)} mm`)} of mouse movement wide. That's smaller than a grain of rice.</p>`,
        },
        {
          h: 'How to do it',
          html: `<ol><li><b>Get close fast</b> with your arm or wrist.</li><li><b>Finish slowly</b> with your fingers.</li><li><b>Rest your wrist</b> on the desk so your fingers have something steady to work from.</li><li><b>Pause for a moment</b> before clicking. One sure hit beats two fast misses.</li></ol>`,
        },
      ];
    },
    fixes: [
      ['You click while sliding past', 'Stop first. The coach tracks how still your crosshair is when you click.'],
      ['You grip harder to be precise', 'It does the opposite. Hold the mouse like a bird: firm enough not to drop it.'],
    ],
    diagram: ({ sens, dpi }) => {
      const deg = 2 * ((Math.atan(0.2 / 30) * 180) / Math.PI);
      return { svg: D.precision(mmForDegrees(deg, sens, dpi), deg), caption: 'The whole target is only a few millimetres of mouse movement.' };
    },
    drills: ['pin'],
    exercises: [{ title: 'Far bots', detail: 'Practice Range far bots with Cassidy or Ashe: 10 headshots, restart if you miss twice in a row.', dose: '3 × 10' }],
  },
  {
    slug: 'movement',
    n: '09',
    title: 'Move while you shoot',
    tag: 'SKILL',
    short: 'In Overwatch you can shoot accurately while moving — so never stand still in a fight.',
    analogy: 'Like a boxer who keeps moving their feet. Standing still is how you get hit.',
    sections: () => [
      {
        h: 'Why it matters',
        html: `<p>In some shooters (Counter-Strike, VALORANT) you must stop to shoot accurately. <b>Overwatch is different:</b> ${term('Hitscan', 'hitscan')} weapons are just as accurate while you move. So standing still gives the enemy a free, easy target.</p>
        <p>Heroes move at 5.5 m/s, a bit slower backwards, and change direction instantly. That's what makes side-to-side dodging (${term('ADAD')}) so effective.</p>`,
      },
      {
        h: 'How to do it',
        html: `<ol><li><b>Tap A and D</b> in short, uneven bursts while you shoot.</li><li><b>Crouch sometimes</b> at close range to drop your head out of their aim.</li><li><b>Don't jump too much</b> — in the air you can't change direction as easily.</li><li><b>Keep your crosshair still on them</b> while your body moves. Your hand does the work.</li></ol>`,
      },
    ],
    fixes: [
      ['You stop moving to aim', 'Crossfire only lets you deal damage while moving. Play it until moving feels normal.'],
      ['Your dodging has a rhythm', 'Break it: long, short, short, long. Rhythms are easy to read.'],
    ],
    diagram: () => ({ svg: D.movement(), caption: 'Moving costs you nothing in Overwatch; standing still costs you everything.' }),
    drills: ['crossfire'],
    exercises: [{ title: 'Never plant', detail: 'Play one Deathmatch with one rule: if you are shooting, you are moving.', dose: '1 game' }],
  },
  {
    slug: 'routine',
    n: '10',
    title: 'The routine & levels',
    tag: 'PLAN',
    short: 'A few minutes every day beats a long session once a week.',
    analogy: 'Like learning an instrument: ten minutes of daily practice beats a two-hour weekend cram.',
    sections: () => [
      {
        h: 'Levels and stars',
        html: `<p>Every drill has 10 levels. Each level has a goal score for ★, ★★ and ★★★. One star unlocks the next level. Stars add up to your rank, from Recruit to Azimuth.</p>
        <p>Don't rush the levels. Three stars on level 4 teaches your hands more than one lucky star on level 7.</p>`,
      },
      {
        h: 'The Daily warm-up',
        html: `<p>One button in Training plays six drills in a row, each at your current level: Duelist → Blink → Snap → Triad → Pin → Crossfire. About five minutes. Do it before you play Overwatch, and it keeps your streak alive.</p>`,
      },
      {
        h: 'The week',
        html: `<p>Monday to Friday: Daily warm-up, then one Deathmatch, then play. At the weekend, read your Logbook. Only change your sensitivity after a full week of the same pattern.</p>`,
      },
    ],
    diagram: () => ({ svg: D.routine(), caption: 'A daily plan that goes from smooth to demanding.' }),
    drills: ['duelist', 'blink', 'snap', 'triad', 'pin', 'crossfire'],
    cta: { label: 'Go to Training', route: 'training' },
    exercises: [
      { title: 'Five days in a row', detail: 'Do the Daily warm-up five days running. On day five, compare your Logbook with day one.', dose: '5 days' },
      { title: 'Never play cold', detail: 'Warm-up → one Deathmatch → ranked. Every time.', dose: 'always' },
    ],
  },
  {
    slug: 'words',
    n: '11',
    title: 'Words, explained',
    tag: 'WORDS',
    short: 'Every word in this manual, in plain English.',
    sections: () => [
      {
        h: 'Glossary',
        html: `<dl class="glossary">${Object.entries(GLOSSARY)
          .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
          .join('')}</dl>`,
      },
    ],
    drills: [],
    exercises: [],
  },
];
