# Overdrive: coding-agent handoff

Generated from plan `rhythm-drill` at seq 352 by `handoff/make_handoff.py`. Regenerate after any plan change; don't edit by hand.

Model pack (source of truth): `.plan/plans/rhythm-drill/out/model/`. Machine-readable copy of this list: `handoff/todos.json`.

## Orchestrator protocol

1. Work on a feature branch off `aim-trainer-experimental` (e.g. `overdrive`). Give each worker its own git worktree; the orchestrator merges.
2. Hand a worker exactly one task, using the brief template below. Launch every task in a wave together, but respect the file clashes listed.
3. Gate each hand-back: check every *Done when* item yourself, run `npm run typecheck && npm test`, and scan the diff against the pack's **Do not** rules (INDEX.md). Merge, then mark the task done on the planner board.
4. If a worker says the plan is wrong or unclear, don't let it improvise: change the plan on the board, recompile, regenerate this file, then re-brief.
5. Stop and ask the human at tasks marked 🧑.

**Routing:** **Opus** orchestrates and takes the hard, cross-cutting and timing-critical tasks. **Sonnet** takes well-specified app code. **GPT** takes pure functions with crisp tests, handed off through the Codex plugin. Run `/codex:setup` first to confirm the Codex CLI is ready and see which model it runs.

### Worker brief template

```text
You are implementing {ref} "{title}" for Overdrive, a rhythm drill in the Azimuth aim trainer
(repo: TypeScript + Vite + three.js). Do only this task.

Read first: .plan/plans/rhythm-drill/out/model/INDEX.md, then {readFirst} in decisions.md /
visuals.md / risks.md / glossary.md, and the task itself in tasks.md.
Files you are expected to touch: {touches}

Rules: decided items are binding; follow the glossary names; never edit .plan/; add no npm
dependencies; match the surrounding code style. If the plan and the code disagree, stop and
report the question instead of guessing.

Finish with `npm run typecheck && npm test` green, one commit "{ref}: {title}", and a report:
files changed, each Done-when item with evidence (test name or how you checked), and open questions.
```

## Waves at a glance

| Wave | Task | Model | Size | Depends on |
|---|---|---|---|---|
| 1 | **T1** Define Overdrive's song, analysis and chart types | Sonnet | S | - |
| 1 | **T10** Play music on the AudioContext clock | Opus | M | - |
| 1 | **T12** Build the synthwave scene 🧑 | Sonnet | M | - |
| 2 | **T2** Write a test-only song generator with known beats and sections | GPT (via Codex plugin) | S | T1 |
| 2 | **T5** Add the preset format, the Mixed preset and the level table | GPT (via Codex plugin) | M | T1 |
| 2 | **T8** Store songs in an IndexedDB library | Sonnet | M | T1 |
| 2 | **T11** Add the audio offset calibration and settings | Sonnet | M | T10 |
| 3 | **T3** Detect tempo, beats and onsets from PCM | Opus | L | T2 |
| 3 | **T7** Judge hits, track the combo and compute the 0–100 score | GPT (via Codex plugin) | M | T5 |
| 4 | **T4** Split songs into bars and sections by energy | Opus | M | T3 |
| 5 | **T6** Generate seeded charts from analysis, preset and level | Opus | L | T4, T5 |
| 5 | **T9** Decode and analyse songs off the main thread | Sonnet | M | T3, T4, T8 |
| 6 | **T13** Create the Overdrive drill core | Opus | L | T6, T7, T10 |
| 7 | **T14** Add tap targets: flick shapes, bursts and decoys | Sonnet | M | T13 |
| 7 | **T15** Add moving targets: strafers, holds and peekers | Opus | L | T13 |
| 7 | **T16** Show the beat cues, combo and judgements 🧑 | Sonnet | M | T13 |
| 7 | **T17** Build the song screen and the Training entry | Sonnet | M | T9, T13 |
| 7 | **T18** Register Overdrive with its debrief, coach and Logbook entries | Sonnet | M | T13 |
| 8 | **T19** Playtest and tune Mixed, the level table and the cues 🧑 | Opus | M | T14, T15, T16, T17, T18, T11, T12 |

**File clashes inside a wave** (serialise these, or merge with care):

- wave 1: src/core/game.ts (T10, T12)
- wave 7: src/drills/overdrive-targets.ts (T14, T15, T16)
- wave 7: src/styles/v2.css (T16, T17)
- wave 7: src/ui/session.ts (T17, T18)

Also note: T10, T12 and T13 all edit `src/core/game.ts`; T13 and T18 both edit `src/drills/registry.ts`; T14, T15 and T16 share `src/drills/overdrive-targets.ts` (run them one after another, or have T13 split it into per-kind files first).

## Tasks

### [ ] T1 · Define Overdrive's song, analysis and chart types

- wave 1 · Sonnet · size S: Types only, fully specified. Orchestrator reviews it: everything builds on it.
- Depends on: nothing · Implements: G1, G3
- Read first: D2, D4, D7, D14, glossary
- Touches: `src/rhythm/types.ts`

src/rhythm/types.ts holds types only, plus `as const` lists DIFFICULTIES, SECTION_KINDS, TARGET_KINDS and FLICK_SHAPES. SongMeta {id: SHA-256 hex of the file bytes, name: file name without extension, mime, duration: seconds, addedAt: ISO string, preset: PresetId, difficulty}. Analysis (T3) {version, sampleRate, duration, bpm, beats: number[] seconds, beatEnergy: number[], onsetEnv: Float32Array, onsetHop: seconds per envelope frame, confidence: 0..1}. It has no downbeats. Structure (T4) {downbeats: number[], bars: number[] bar start times, sections: Section[]} with Section {startBar, endBar (exclusive), kind}. PresetRow {weights: Record<TargetKind, number>, perBar: {from, to}}, Preset {id, name, rows: Record<SectionKind, PresetRow>, flickShapes: Record<FlickShape, number>, params?: multipliers}. ChartTarget is a union on kind; every target has launchTime, landTime, targetTime, windowEnd (seconds of song time) and position {bearing, pitch, distance}. Bearing is in degrees clockwise, matching dirFrom() in src/drills/common.ts; pitch is in degrees up; distance is in metres. For figures (strafer, peeker, decoy), position is the ground point and pitch is ignored. FlickTarget adds shape; BurstTarget adds orbs: {time, position}[] and counts as one target in density; Strafer, Hold and Peeker add their params. Wall {bearing, distance, width, height}. Chart {songId, preset, difficulty, level, duration, targets, walls}.

Done when:
- [ ] src/rhythm/types.ts exports everything above and `npm run typecheck` passes.
- [ ] Comments on each type cite the glossary term it implements (Song, Chart, Style preset, Target, Target beat, Hit window).

### [ ] T10 · Play music on the AudioContext clock

- wave 1 · Opus · size M: Sync-critical audio clock; touches the game loop (R1).
- Depends on: nothing · Implements: G2 · Mitigates: R1
- Read first: R1, glossary: Song time, Audio offset
- Touches: `src/core/audio.ts`, `src/core/game.ts`

In src/core/audio.ts: playMusic(buffer, fromSec) starts an AudioBufferSourceNode through a music gain under master. pauseMusic() stops the source and remembers the position; resumeMusic() starts a new source from there. Do not suspend the shared AudioContext, because menu and hit sounds must keep working. stopMusic(). songTime() = (ctx.currentTime − startedAt) + startOffset − output latency − audioOffsetMs/1000, where output latency = baseLatency + outputLatency (the Web Audio spec's full output delay; baseLatency alone if outputLatency is missing); it is frozen while paused. Game's pause and resume call pauseMusic and resumeMusic when a song is playing.

Done when:
- [ ] songTime() follows the audio, not frame time; over a 4-minute song its drift from the source position stays under 10 ms (dev log).
- [ ] Pause then resume keeps music and targets aligned, and menu sounds still play while paused.
- [ ] Works in browsers without outputLatency (falls back to baseLatency alone).

### [ ] T12 · Build the synthwave scene

- wave 1 · Sonnet · size M: three.js scene; human eyeballs the look.
- Depends on: nothing · Implements: G5
- Read first: D6
- Touches: `src/world/synthwave.ts`, `src/world/arena.ts`, `src/core/game.ts`
- 🧑 Human gate: the human checks the synthwave look in the browser

src/world/synthwave.ts: a sky gradient, a striped sun, mountain silhouettes and a neon grid floor that scrolls one cell per beat and glows on the beat (D6), driven by a songTime getter and the beat list. While Overdrive runs, the Arena's meshes are hidden and its colliders switched off (Game.castRay and movement read arena.colliders), and the chart's walls become colliders. Everything is restored on exit. Respects the FX level.

Done when:
- [ ] Overdrive runs in the synthwave scene; every other drill still shows the normal arena with its colliders, including after quitting Overdrive mid-run.
- [ ] Arena pillars don't block shots during Overdrive; chart walls do.
- [ ] The grid scrolls one cell per beat.
- [ ] Frame rate at FX 'full' is no worse than Duelist on the same machine.

### [ ] T2 · Write a test-only song generator with known beats and sections

- wave 2 · GPT (via Codex plugin) · size S: Pure, seeded signal generator with a clear contract.
- Depends on: T1 · Implements: G2
- Read first: D11
- Touches: `tests/helpers/songgen.ts`

tests/helpers/songgen.ts: a pure, seeded function (bpm, sampleRate, bars, section energies, swing, noise level, quiet intro, optional tempo ramp) → { pcm: Float32Array, beats: number[], sections }. Kick, snare and hat from sine and noise envelopes. Test fixture only (D11).

Done when:
- [ ] Generates deterministic loops from 70 to 190 BPM, with swing, noise and a quiet intro, plus the true beat times and section boundaries.
- [ ] Nothing under src/ imports it, and it is not bundled by `npm run build`.

### [ ] T5 · Add the preset format, the Mixed preset and the level table

- wave 2 · GPT (via Codex plugin) · size M: Data tables + small pure helpers, numbers given.
- Depends on: T1 · Implements: G1, G4
- Read first: D7, D8, D9, D10, D17, V5
- Touches: `src/rhythm/types.ts`, `src/rhythm/presets.ts`, `src/rhythm/levels.ts`, `tests/rhythm-presets.test.ts`

src/rhythm/presets.ts: MIXED, with the matrix, targets per bar and flick shape split exactly as in V5's caption, plus the rhythmic feel per section kind (D18): each PresetRow has landGrid (beats that landTime snaps to: 1 in intro, calm and outro; 0.5 in build and peak) and slotGrid (the grid target beats sit on: 1, except 0.5 in peak), and the preset has fills: true (a fill in the bar before every peak). These fields are added to PresetRow and Preset in src/rhythm/types.ts. src/rhythm/levels.ts: LEVELS[1..10] with starting values to be tuned in T19, interpolating linearly between L1 and L10: leadBeats (land → target beat) 2.0→1.0; afterBeats (target beat → window end) 1.5→0.5; perfectMs (± around the target beat) 90→45; density multiplier 0.5→1.25; maxConcurrent 2→5; target radius 0.40→0.24 m (diamonds ×0.6); strafer speed (StyleTuning.speed) 0.6→1.0; strafer health 60→160; strafer life 8 beats; hold length 4→2 beats; peeker shows for 1 beat. Fly-in is always 1 beat. Effective target params = level value × preset multiplier (default 1). Difficulty bands: Easy 1–3, Normal 4–6, Hard 7–8, Expert 9–10. unlockedInBand(progress, difficulty) implements D17 (the band's first level, plus one per consecutive starred level from there, capped at the band's top); levelFor(difficulty, progress) returns that level (D10 + D17).

Done when:
- [ ] Each Mixed row's weights, and the flick shape split, sum to 1 (test).
- [ ] levelFor gives 7 for Hard with no stars, 8 after a star on 7, and never leaves the band (test).
- [ ] Across levels leadBeats, afterBeats and perfectMs never grow and density never drops (test).
- [ ] Only Mixed is listed as a selectable preset (D8).
- [ ] Mixed's landGrid and slotGrid per section kind and fills match D18 (test).

### [ ] T8 · Store songs in an IndexedDB library

- wave 2 · Sonnet · size M: IndexedDB wrapper, plain-words errors.
- Depends on: T1 · Implements: G1
- Read first: D11, scope
- Touches: `src/core/songs.ts`

src/core/songs.ts: an IndexedDB store holding audio Blobs, SongMeta and cached analysis. add(file) hashes the bytes (crypto.subtle SHA-256) so duplicates collapse; list(), get(id), remove(id), saveAnalysis(id, …), setPresets(id, preset, difficulty). Errors become plain words. Kept out of the localStorage profile and the backup export.

Done when:
- [ ] Adding the same file twice keeps one entry.
- [ ] Songs, their presets and cached analysis survive a reload.
- [ ] Deleting a song removes its blob and its analysis.
- [ ] The Settings backup export contains no audio.
- [ ] A quota error shows: "Your browser is out of space for songs. Delete one and try again."

### [ ] T11 · Add the audio offset calibration and settings

- wave 2 · Sonnet · size M: Settings UI + one pure helper; follow existing settings screen idioms.
- Depends on: T10 · Implements: G2 · Mitigates: R1
- Read first: R1, glossary: Audio offset
- Touches: `src/core/store.ts`, `src/core/game.ts`, `src/ui/screens/settings.ts`, `src/rhythm/calibrate.ts`, `tests/rhythm-calibrate.test.ts`

New settings audioOffsetMs (default 0) and beatStrip (default on). Game.applySettings passes audioOffsetMs to the Audio class (audio.audioOffsetMs, from T10). Settings → audio gets "Calibrate rhythm timing": a metronome at 100 BPM played on the music clock (T10's playMusic with a generated click buffer), with clicks judged by songTime() while the offset is held at 0, so the calibration measures exactly what song time misses; the player clicks along 16 times. Take each click minus its nearest beat, drop the first 4 and any outside ±250 ms, and the median becomes audioOffsetMs (positive = the player hears audio late, so targets arrive later; see the glossary). Plus a manual slider from −200 to +200 ms. The pure helper lives in src/rhythm/calibrate.ts.

Done when:
- [ ] Both settings persist and are included in the backup export.
- [ ] The helper recovers a simulated fixed latency of +80 ms within ±10 ms, with jittered clicks (test).
- [ ] Changing the slider takes effect on the next run.

### [ ] T3 · Detect tempo, beats and onsets from PCM

- wave 3 · Opus · size L: DSP: tempo prior, octave errors, DP beat tracking. Hardest correctness bar (R2).
- Depends on: T2 · Implements: G2 · Mitigates: R2
- Read first: D3, R2
- Touches: `src/rhythm/analysis.ts`, `src/rhythm/fft.ts`, `tests/rhythm-analysis.test.ts`

src/rhythm/analysis.ts: analyse(pcm: mono Float32Array, sampleRate) → Analysis (T1; no downbeats, which belong to T4). Spectral-flux onset envelope (~10 ms hop) using a small radix-2 FFT written in src/rhythm/fft.ts, with no new npm packages. Tempo by autocorrelation with a prior preferring 80–180 BPM and resolving half/double tempo; dynamic-programming beat tracking so local drift is followed; per-beat RMS energy; a 0..1 confidence. Export ANALYSIS_VERSION = 1 and stamp it on every Analysis. No DOM or WebAudio.

Done when:
- [ ] vitest: on songgen loops at 70–190 BPM, including swing, noise and an 8 s quiet intro, tempo is within 1% and at least 95% of beats fall within 20 ms of the truth.
- [ ] A 4-minute 44.1 kHz mono song is analysed in under 3 s in node.
- [ ] Beatless noise returns confidence below 0.4; every songgen loop returns at least 0.6.
- [ ] package.json dependencies are unchanged.

### [ ] T7 · Judge hits, track the combo and compute the 0–100 score

- wave 3 · GPT (via Codex plugin) · size M: Pure judging/combo maths, boundary tests spelled out.
- Depends on: T5 · Implements: G4, G5
- Read first: D4, D13
- Touches: `src/rhythm/scoring.ts`, `tests/rhythm-scoring.test.ts`

src/rhythm/scoring.ts: judge(songTimeOfClick, target, level) → perfect | early | late | miss, plus a signed offset in ms (D4 consequences). Combo and multiplier ×1→×4, stepping up every 8 combo points; Perfect adds 2, Early or Late adds 1, Miss resets. Decoys: a hit resets the combo and costs points; leaving one alone is neutral; decoys are left out of hit rate and vanish with no Miss. Burst hit rate counts each orb. Strafers and holds score the fraction of their life spent on target while firing; under 30% counts as a miss for the combo. Final 0–100 score plus stats: mean signed offset, hit rate per target type and max combo.

Done when:
- [ ] Unit tests cover perfect, early, late and miss at the window and Perfect boundaries.
- [ ] Perfect hits raise the multiplier faster than early or late hits (test).
- [ ] A decoy hit resets the combo; an ignored decoy changes nothing (test).
- [ ] The score stays within 0–100 and never drops when a miss becomes a hit (test).

### [ ] T4 · Split songs into bars and sections by energy

- wave 4 · Opus · size M: Heuristic segmentation with fallbacks (R4).
- Depends on: T3 · Implements: G3 · Mitigates: R4
- Read first: D7, R4
- Touches: `src/rhythm/sections.ts`, `tests/rhythm-sections.test.ts`

src/rhythm/sections.ts: structure(analysis) → Structure (T1). Estimate downbeats from the accent pattern across the four beat phases, build bars, smooth bar energy and find change points. The first section is always intro and the last always outro; middle sections are classified by energy tier as calm, build (rising) or peak. Sections are at least 4 bars, bar-aligned, with endBar exclusive. Fall back to energy-only tiers when change points are weak (R4). The worker (T9) caches Analysis and Structure together.

Done when:
- [ ] On songgen songs with known quiet/loud structure, section boundaries are within 1 bar of the truth and middle kinds match.
- [ ] Intro appears only as the first section and outro only as the last.
- [ ] A flat loop yields valid sections (no crash, at least one middle section).
- [ ] Every section is at least 4 bars and starts on a bar boundary.

### [ ] T6 · Generate seeded charts from analysis, preset and level

- wave 5 · Opus · size L: Many interacting constraints (density, spacing, caps, low-confidence fallback).
- Depends on: T4, T5 · Implements: G1, G3
- Read first: D4, D7, D12, D14, R2, V4, V5
- Touches: `src/rhythm/generator.ts`, `tests/rhythm-generator.test.ts`

src/rhythm/generator.ts: generate(analysis, structure, preset, level, songId) → Chart. PRNG (e.g. mulberry32) seeded by hash(songId, preset id, level). Fun first (D19): the plan below is the starting point, and the generator should make charts that feel musical and varied, with creative licence to go further (repeated motifs within a section, call-and-response between left and right, rests in quiet moments, accents on the strongest onsets, syncopation in peaks, fills and flourishes at climactic moments, surprises at drops), so no two bars feel mechanical. Starting point: for each bar, take the section row, draw a count from perBar (ramped across build sections) × level density, choose slots on the row's slotGrid feel (beats, plus off-beat eighths in peaks, D18) weighted by onset strength (burst orbs on eighths), and sample each type from the row weights and each flick's shape from the shape split. Times: targetTime = the slot; landTime = targetTime − leadBeats, snapped to the row's landGrid feel (never below 1 beat) and measured along the beat grid; launchTime = landTime − 1 beat; windowEnd = targetTime + afterBeats. Fills (D18, when preset.fills): at least a run into every peak (e.g. 3–5 burst orbs on eighths into the peak's first downbeat, where a target lands), with more flourishes where the music builds. Positions: on-screen spread within about ±35° bearing and −10..+15° pitch at 10–18 m for most types; triangles 60–150° left or right; peekers get a Wall in chart.walls; movement patterns across the screen are part of the fun. Keep it readable: cap concurrent targets at maxConcurrent and never overlap strafers or holds with each other. When analysis.confidence < 0.4 (R2), slots come from detected onset peaks instead of the beat grid. The chart ends at the song's end (D12). Report every creative choice you made beyond this starting point.

Done when:
- [ ] The same inputs give a deep-equal chart; a different songId gives a different one.
- [ ] Over a 200-bar synthetic song, each section kind's type mix follows the preset matrix in spirit (within ±10%, fills and flourishes excluded).
- [ ] Every target lands on something audible: for confident analyses every targetTime and burst orb is on the beat grid or its eighths within 1 ms; for low-confidence analyses on an onset peak.
- [ ] Every peak that follows another section gets a fill or flourish leading into it.
- [ ] Readable: concurrent targets never exceed maxConcurrent, and no two strafer/hold targets overlap in time.

### [ ] T9 · Decode and analyse songs off the main thread

- wave 5 · Sonnet · size M: Vite module worker + cache wiring.
- Depends on: T3, T4, T8 · Implements: G1
- Read first: D3, V1
- Touches: `src/rhythm/worker.ts`, `src/core/songs.ts`

Decode with AudioContext.decodeAudioData on the main thread, downmix to mono and transfer the samples to src/rhythm/worker.ts (a Vite module worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })). The worker runs analyse() then structure() and posts progress. Cache {analysis, structure} in the song library under the song id, but on load always recompute the Structure from the cached Analysis with structure() (about 20 ms), so sections retuned later (T19) apply to songs already in the library. If the cached analysis.version differs from ANALYSIS_VERSION, re-analyse.

Done when:
- [ ] A 4-minute MP3 is ready to play within 5 s of being added on a mid-range laptop.
- [ ] No main-thread task longer than 100 ms while analysis runs (DevTools Performance).
- [ ] A corrupt or unsupported file shows a plain-words error.
- [ ] Replaying a song uses the cache without starting the worker; bumping ANALYSIS_VERSION forces a re-analysis.

### [ ] T13 · Create the Overdrive drill core

- wave 6 · Opus · size L: Integration core: DrillDef.make ctx, ShotResult.press, song-time judging.
- Depends on: T6, T7, T10 · Implements: G3, G4
- Read first: D4, D12, D13, V6
- Touches: `src/drills/overdrive.ts`, `src/drills/drill.ts`, `src/drills/registry.ts`, `src/core/game.ts`, `src/ui/session.ts`

src/drills/overdrive.ts: OverdriveDrill extends Drill (id 'overdrive', movable = false, D13). Launch path: DrillDef.make gains an optional third argument, make(g, level, ctx?), and startDrill forwards it; Overdrive's make requires ctx = {chart, buffer}. duration = chart.duration + 2, and done is set once songTime() passes chart.duration (Game ends runs on the frame clock). begin() starts the music. update() reads audio.songTime() to launch targets, advance them through fly-in → landed → window → expired, and remove expired ones as misses. Judging reads audio.songTime() inside onShot, which runs synchronously in the mousedown handler, so it is the click instant. Firing (D13): the weapon streams while held. Add `press: boolean` to ShotResult (true from Game.button, false from the auto-fire tick). Tap targets (flick, burst, peeker, decoy) only accept press shots; stream shots only damage strafers and holds. Use one FlickRecorder per flick target to fill analytics.flicks.

Done when:
- [ ] A hand-written chart with one target of each kind plays to the end with music.
- [ ] Each target launches within one frame of its chart time and vanishes at windowEnd if not hit.
- [ ] Holding fire across a tap target does not hit it; clicking does.
- [ ] The report includes score, difficulty, level, mean timing offset and hit rate per type.
- [ ] Existing drills still work through make(g, level); `npm run build` and `npm test` pass.

### [ ] T14 · Add tap targets: flick shapes, bursts and decoys

- wave 7 · Sonnet · size M: Well-specified target shapes on top of T13.
- Depends on: T13 · Implements: G3
- Read first: D13, D14
- Touches: `src/drills/overdrive-targets.ts`, `src/world/figure.ts`

src/drills/overdrive-targets.ts. Per D14: circle = normal on-screen flick, diamond = small precision target with a bigger Perfect bonus, triangle = off-screen wide flick that points the way to turn, with a positional ping (TargetSound). Bursts: 3–5 small orbs on consecutive eighth notes along a line or arc. Decoys: a friendly-coloured figure; hitting one breaks the combo. Hitboxes match the visible shapes.

Done when:
- [ ] Circle, diamond and triangle are visually distinct, and each is hit exactly where it is drawn.
- [ ] Triangles spawn off screen and their ping comes from their position.
- [ ] Burst orbs appear in order on eighth notes.
- [ ] Hitting a decoy shows a FRIENDLY toast and breaks the combo.

### [ ] T15 · Add moving targets: strafers, holds and peekers

- wave 7 · Opus · size L: Beat-locked brains and walls; subtle timing.
- Depends on: T13 · Implements: G3
- Read first: D1, D13
- Touches: `src/drills/overdrive-targets.ts`, `src/world/brain.ts`

BeatStrafeBrain (implements Brain in src/world/brain.ts) takes a songTime getter and the chart's beat times when built, and flips direction on beats; Brain.update(dt, player) keeps its signature. Holds are orbs following a spline whose progress is a function of songTime only. Peekers use a PeekBrain variant that shows on the target beat and hides on the next beat behind their chart wall (a collider from T12).

Done when:
- [ ] Strafer direction changes land within one frame of a beat.
- [ ] A hold's position depends only on songTime, so pausing freezes it.
- [ ] A peeker is visible only between its two beats, and shots at it while hidden hit the wall.
- [ ] All three take stream damage (D13) and vanish when their window ends.

### [ ] T16 · Show the beat cues, combo and judgements

- wave 7 · Sonnet · size M: HUD + cues following V3; human checks readability.
- Depends on: T13 · Implements: G5 · Mitigates: R3
- Read first: D5, V3, R3
- Touches: `src/drills/overdrive-targets.ts`, `src/ui/hud.ts`, `src/styles/v2.css`
- 🧑 Human gate: the human checks readability at Expert on a fast song

Per V3: fly-in from the distance during the beat before landing, a closing ring that touches the target on its target beat, a pulse with the music and a flash on the beat, and the beat strip HUD with an icon per target type scrolling to a hit line (hideable via the beatStrip setting). Also a combo counter with multiplier, and the judgement word (Perfect / Early / Late / Miss) by the crosshair.

Done when:
- [ ] Each ring touches its target at targetTime ± one frame.
- [ ] Turning beatStrip off hides the strip.
- [ ] The judgement word appears on the frame after the click.
- [ ] At Expert on a fast (170+ BPM) song the targets stay readable (note it in the PR).

### [ ] T17 · Build the song screen and the Training entry

- wave 7 · Sonnet · size M: Screen + routing in existing UI idioms.
- Depends on: T9, T13 · Implements: G1
- Read first: D9, D10, D11, D17
- Touches: `src/ui/screens/songs.ts`, `src/ui/screens/training.ts`, `src/ui/app.ts`, `src/ui/session.ts`, `src/styles/v2.css`

The Overdrive card in Training opens src/ui/screens/songs.ts: drag-and-drop or an Add song button; a list with name, length, BPM and difficulty; and an empty state "Add a song to start" (D11). On add: the preset picker (Mixed only, preselected) and difficulty (Normal by default), then analysis progress. Play goes to the briefing (openBriefing extended to show difficulty and the D10 level), then the run.

Done when:
- [ ] From Training, a new player can add an MP3 and start playing with at most one click after analysis finishes.
- [ ] Songs can be deleted (with confirmation) and their difficulty changed before playing.
- [ ] The list survives a reload.

### [ ] T18 · Register Overdrive with its debrief, coach and Logbook entries

- wave 7 · Sonnet · size M: Registration, debrief charts, coach findings in existing idioms.
- Depends on: T13 · Implements: G4
- Read first: D15, D17
- Touches: `src/core/coach.ts`, `src/drills/registry.ts`, `src/ui/session.ts`, `src/ui/charts.ts`, `src/ui/screens/logbook.ts`, `README.md`

Add 'overdrive' to DrillId (src/core/coach.ts) and a DRILL_DEFS entry (name Overdrive, skill Rhythm, chapter 'routine', star thresholds 40/55/70 as a start, 10 level labels from the level table, and make(g, level, ctx) per T13). Overdrive's briefing replaces the level chips with the song, its difficulty and the D17 level. Progress uses applyRun as usual, but the playable level comes from unlockedInBand (T5), not unlockedLevel. Debrief: an early-to-late timing histogram, hit rate per target type and max combo. Coach findings: consistently early or late (|mean offset| > 25 ms) and the weakest target type, with the drill that trains it (strafers → Duelist, flicks → Blink, triangles → Snap, peekers → Corner Watch). Logbook recent sessions. README drills row updated. Not added to DAILY (D15).

Done when:
- [ ] Overdrive appears in Training and its briefing shows song, difficulty and level.
- [ ] A run with a +40 ms mean offset produces a "you're shooting late" finding.
- [ ] Runs appear in the Logbook.
- [ ] DAILY in src/ui/session.ts is unchanged.

### [ ] T19 · Playtest and tune Mixed, the level table and the cues

- wave 8 · Opus · size M: Playtest with the human, then tune numbers.
- Depends on: T14, T15, T16, T17, T18, T11, T12 · Implements: G5, G2 · Mitigates: R3, R4
- Read first: G5, R3, R4
- Touches: `src/rhythm/presets.ts`, `src/rhythm/levels.ts`
- 🧑 Human gate: the human playtests on their own songs

Play at least three of the human's own songs (different tempos and genres) on Easy and Expert. Tune matrix weights, densities, window and Perfect widths, the per-section rhythmic feel and fills (D18), and cue contrast, and note the findings in the PR.

Done when:
- [ ] The human plays it on their own songs and says it feels on-beat and fun (G5).
- [ ] No target is unreadable at Expert on a fast song.
- [ ] The tuned values are committed in presets.ts and levels.ts, and `npm test` is green.
