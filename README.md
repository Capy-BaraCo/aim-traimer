# Azimuth — Overwatch sensitivity lab

**Play it:** https://capy-baraco.github.io/aim-traimer/

Find your Overwatch sensitivity with blind **PSA** trials — tracking, short flicks and wide flicks — in a three.js range that moves like Overwatch. Then train with levelled drills, a coach that reads your flicks, and a Field Manual written in plain words.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sensitivity maths, PSA, flick + hearing analytics, film lessons, progression, movement
npm run build      # static site in dist/ (relative paths — host anywhere)
```

Use a desktop Chromium browser for raw (unaccelerated) mouse input. Firefox works, but reads the OS-processed pointer stream.

## What's inside

| | |
|---|---|
| **Calibrate** | PSA binary search: base ×0.5 vs ×1.5, keep the better, replace the other with the midpoint, 5/7/9 rounds. Each blind sample (α/β, shuffled) can contain three sections you toggle: **tracking**, **short flicks** (5–26°, wrist range) and **wide flicks** (35–130°), weighted by focus. The certificate shows eDPI, cm/360, the convergence chart, how your flicks land near the chosen sensitivity, feel-vs-data agreement and conversions to other games. |
| **Training** | Eight drills × ten levels. Score 1★ to unlock the next level; 3★ means mastered. Stars add up to ranks (Recruit → Azimuth). A **Daily warm-up** runs seven drills at your current levels in about six minutes and tracks your streak. |
| **Film room** | Guided, animated replays of your own flicks. For each problem the coach finds (going past, stopping short, curved path, clicking while moving, slow start, long fix-up) it picks your most typical example and plays it on a first-person "your screen" view and a telestrator view of your crosshair's path. The same flick is shown done the right way (smooth, bell-shaped speed, lands at ~97%, one nudge, click once stopped). Beats walk through what happened, why, what it cost and the fix, with slow-motion, a speed/phase timeline and optional read-aloud. Demo reels in the Field Manual. |
| **3D audio** | Target sounds play from where the target is, through an HRTF panner that follows your view every frame (headphones), with a stereo fallback for speakers. Sounds behind you are low-passed, because generic HRTFs render front/back weakly. Settings has an audio check (left / ahead / right / behind). |
| **Coach** | Every flick is split into reaction → main movement → correction, and judged on where the first movement stopped: short of the target, on it, or past it. It also finds curved paths, clicking while still moving ("drive-bys"), short vs long and per-direction bias, tracking delay (cross-correlation) and jitter. Each debrief picks one thing you did well and two things to fix, in plain words, plus the drill that fixes them. Optional live cues during drills. |
| **Logbook** | Your aim fingerprint (radar), crosshair profile in plain words, landing map, short-vs-long and direction charts, tracking delay, and recent sessions — built from every run. |
| **Field Manual** | 12 short chapters written for a beginner: what sensitivity is, finding your number, crosshair placement, tracking, flicking, reading your flicks, hearing where they are, switching, precision, movement, the routine, and a glossary. Each has an analogy, "if this happens → do this" fixes, a diagram built from *your* settings, a drill and Overwatch exercises. |
| **Drills** | Blink (short flicks), Snap (wide flicks, with a positional ping), **Echo** (sound-led 360° flicks: listen, turn the short way, flick; levels remove the beacon and direction arc), Duelist (tracking), Pin (precision), Triad (switching), Corner Watch (placement), Crossfire (moving + tracking), plus the Protractor instrument. |
| **Free Range** | Sandbox with live sensitivity nudging (`[` `]`) and weapon swap (`1` `2`). |
| **Instruments** | Converter, DPI-change helper, mousepad fit, DPI check with a ruler, calibration log. |

Everything saves to `localStorage` in your browser — no account, no server. Settings → **Your data** exports a backup file you can import on another PC or browser.

## Fidelity notes

- Mouse: 0.0066° per count × sensitivity (both axes); FOV is Overwatch's horizontal FOV at 16:9, held as vertical FOV (Hor+).
- Movement (community-measured): 5.5 m/s run/strafe, 90% backpedal, 3 m/s crouch-walk, instant ground acceleration, jump impulse 5.72 m/s, gravity 17.5 m/s² easing to a 30 m/s fall cap, hold-to-rejump. Air steering is an approximation.
- Shots resolve at the instant of the click (like Overwatch's high-precision input), not on the next frame.
- Targets are literal capsules and spheres: the hitbox is exactly what you see.

## Layout

```
src/core    sensitivity maths, PSA, metrics, flick/tracking analytics, coach, progression, store, game loop
src/world   renderer + post FX, arena (protractor dial, monoliths, halo), movement, figures, bots, FX, viewmodel
src/drills  drill base class, every drill, the level registry and the PSA calibration trial
src/film    film room: replayable takes, the right-way flick, demo flicks, lesson scripts, canvas renderers
src/guide   Field Manual chapters and SVG diagrams
src/ui      app shell, HUD, SVG charts, briefing/debrief session flow, screens
tests       vitest unit tests
```
