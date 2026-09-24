# Azimuth — Overwatch sensitivity lab

**Play it:** https://capy-baraco.github.io/aim-traimer/

Find your Overwatch sensitivity with blind **PSA** trials, in a three.js range that moves like Overwatch, then train with an aim **Field Manual** (9 chapters, 7 measured drills).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sensitivity maths, PSA search, flick analysis, movement physics
npm run build      # static site in dist/ (relative paths — host anywhere)
```

Use a desktop Chromium browser for raw (unaccelerated) mouse input. Firefox works, but reads the OS-processed pointer stream.

## What's inside

| | |
|---|---|
| **Calibrate** | PSA binary search: base ×0.5 vs ×1.5, keep the better, replace the other with the midpoint, 5/7/9 rounds. Samples are blind (α/β, shuffled) and weighted by focus (balanced / tracking / flick). Ends in a certificate with eDPI, cm/360, the convergence chart, flick over/undershoot balance, feel-vs-data agreement and conversions to other games. |
| **Field Manual** | The 360 · Finding your number · Crosshair placement · Tracking · Flicking · Target switching · Precision · Move while you shoot · The routine. Each chapter explains why, how and common mistakes, has a live diagram built from *your* settings, a drill, and exercises to take into Overwatch. |
| **Drills** | Duelist (smooth / ADAD), Snap, Triad, Corner Watch, Pin, Crossfire, Protractor. Coach notes are generated from the numbers (lag/lead, vertical drift, overshoot bias, switch time, placement error). |
| **Free Range** | Sandbox with live sensitivity nudging (`[` `]`) and weapon swap (`1` `2`). |
| **Instruments** | Converter, DPI-change helper, mousepad fit, DPI check with a ruler, calibration log. |

## Fidelity notes

- Mouse: 0.0066° per count × sensitivity (both axes); FOV is Overwatch's horizontal FOV at 16:9, held as vertical FOV (Hor+).
- Movement (community-measured): 5.5 m/s run/strafe, 90% backpedal, 3 m/s crouch-walk, instant ground acceleration, jump impulse 5.72 m/s, gravity 17.5 m/s² easing to a 30 m/s fall cap, hold-to-rejump. Air steering is an approximation.
- Shots resolve at the instant of the click (like Overwatch's high-precision input), not on the next frame.
- Targets are literal capsules and spheres: the hitbox is exactly what you see.

## Layout

```
src/core    sensitivity maths, PSA, metrics, input, audio, settings store, game loop
src/world   renderer + post FX, arena (protractor dial, monoliths, halo), movement, figures, bots, FX, viewmodel
src/drills  drill base class + every drill and the PSA calibration trial
src/guide   Field Manual chapters and SVG diagrams
src/ui      app shell, HUD, screens
tests       vitest unit tests
```
