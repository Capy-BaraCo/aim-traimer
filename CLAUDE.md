# Azimuth: Overwatch sensitivity lab

Browser aim trainer: PSA sensitivity calibration, levelled drills, a coach, a film room and a Field Manual. Static site (GitHub Pages), no server; everything saves to `localStorage`. See README.md for the feature tour.

## Commands

```bash
npm run dev        # http://localhost:5173
npm test           # vitest (node environment), tests/*.test.ts
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build into dist/ (relative paths)
```

## Code

- TypeScript (strict) + Vite + three.js. No UI framework: screens are template-string HTML in `src/ui`.
- `src/core`: sensitivity maths, PSA, analytics, coach, progression, store, audio, game loop. `src/world`: renderer, arena, movement, figures, bots. `src/drills`: `Drill` base class, every drill, `DRILL_DEFS` registry. `src/film`: film room. `src/guide`: Field Manual. `src/ui`: app shell, HUD, charts, screens.
- Every drill extends `Drill` (`src/drills/drill.ts`), returns a `DrillReport` and is registered in `DRILL_DEFS` with 10 levels and 1/2/3★ thresholds.
- Shots resolve at the click instant: `Game.button()` → `fire()` → `drill.onShot()` synchronously in the mousedown handler.
- Pure logic (maths, analytics, scoring) stays free of DOM and WebAudio so vitest can run it in node.
- User-facing copy is plain words for beginners, in the coach / Field Manual voice.

## Active plan: Overdrive (rhythm drill)

The next feature is planned in `.plan/plans/rhythm-drill/`. Before working on it, read:

- `.plan/plans/rhythm-drill/out/model/INDEX.md`: the model pack (goals, Do-not rules, decisions, tasks). It is the source of truth; `decided` items are binding.
- `.plan/plans/rhythm-drill/handoff/TODOS.md`: tasks in waves with model routing and the orchestrator protocol (`todos.json` is the same list as data).

Never hand-edit `out/` or `handoff/`. Change the plan on the live-planner board (`/live-planner:plan`), recompile, then run `python3 -I .plan/plans/rhythm-drill/handoff/make_handoff.py`.
