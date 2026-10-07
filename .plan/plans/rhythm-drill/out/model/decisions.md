# Decisions

## Decided (binding)

### D1 · How do notes reach you? — DECIDED
**Outcome:** Targets spawn in the 3D range on chosen beats, as a mix of target types that appear at different times. Each type behaves differently but in time with the music (e.g. a player figure that strafes to the beat, shaped flick icons that pop up rhythmically), and disappears if it isn't hit in time. The feel is a mix of Beat Saber and Guitar Hero, but as an aim trainer.
**Why:** The human's own description, given in the terminal instead of picking one of the three single-mechanic concepts.
**Affects:** Overdrive
**Do not propose:** Highway only: every note flies down one corridor; Pop-in rings only: one kind of target with shrinking rings; Surround only: everything arrives from all sides

### D2 · Which target types are in the first version? — DECIDED
**Outcome:** Flick shapes, Peekers, Holds, Decoys, Bursts, Strafers
**Why:** Chosen by the human in "Which target types should be in the first version? Each one trains a different aim skill, and all of them spawn on the beat and vanish if missed."
**Affects:** V2 The human's concept laid out like a Guitar Hero chart: two…

### D3 · How does an uploaded song become a chart? — DECIDED
**Outcome:** Fully automatic: the drill detects tempo and beats and places targets on the beat grid, with busier patterns in louder parts. Drop a song in and play. There is no preview or fix-up screen.
**Why:** Chosen by the human in the Song → chart comparison: fastest path from upload to playing.
**Consequences:**
- Beat analysis must be robust on its own: there is no human correction step.
- Analysis must be fast enough that upload → play feels immediate.
- Adding a song may ask for a style preset and difficulty (D7, D9), but never for tempo or beat corrections.
**Affects:** V1 Song to run: the player's audio file is stored in IndexedDB…
**Do not propose:** Automatic + quick fix (preview and nudge screen); Tap it yourself

### D4 · Do you have to hit on the beat, or just before the target is gone? — DECIDED
**Outcome:** Window + beat bonus. A target appears on a beat and stays for a hit window. Any hit inside the window counts, but a hit close to the target's own beat scores Perfect and builds the combo faster. Higher levels shrink the window towards the beat.
**Why:** Chosen by the human: rhythm feel without punishing the stop-then-click habit the coach teaches.
**Consequences:**
- Judgement words are Perfect (within the Perfect width of the target beat), Early (in the window, before that), Late (in the window, after it) and Miss (window ended).
- Timing per target: launchTime = landTime − 1 beat (fly-in); landTime = targetTime − leadBeats; windowEnd = targetTime + afterBeats. leadBeats, afterBeats and the Perfect width come from the level table (T5).
- Timing stats (mean signed offset in ms) come from hits, for the debrief and coach.
**Affects:** G2 Targets land on the beat of the music., G3 Six target types each spawn on the beat, behave in time wit…, G5 Fun first: it feels like a rhythm game and a warm-up you wa…
**Do not propose:** On the beat only (strict ±60 ms); Before it's gone with no beat bonus

### D5 · How do you see when a target's beat is coming? — DECIDED
**Outcome:** Combine all four cues: targets fly in from the distance, a ring closes onto each target on its beat, the target pulses with the music and flashes on its beat, and a Guitar Hero-style beat strip at the bottom of the screen shows upcoming targets.
**Why:** The human's answer: "combine them".
**Consequences:**
- Each cue needs its own timing on the shared chart clock; see V3 for the proposed choreography.
- Four cues at once risk clutter on dense charts; see R3.
**Affects:** G5 Fun first: it feels like a rhythm game and a warm-up you wa…, D4 Do you have to hit on the beat, or just before the target i…

### D6 · What should the drill look like? — DECIDED
**Outcome:** Synthwave grid: a retro sunset sky with a striped sun, mountains on the horizon and a neon grid floor that scrolls at the song's tempo. Neon targets read against the dark floor and sky.
**Why:** Chosen by the human from three sketched looks.
**Consequences:**
- A new scene for this drill (sky, sun, mountains, grid floor) instead of the protractor arena. It reuses the existing Engine, renderer and post FX, and the existing camera, FOV and sensitivity maths stay unchanged.
- The grid's scroll speed and the sun's glow follow the beat clock.
**Affects:** G5 Fun first: it feels like a rhythm game and a warm-up you wa…
**Do not propose:** Neon night arena; Existing Azimuth arena at dusk

### D7 · How are charts generated so that any song gets a good chart? — DECIDED
**Outcome:** Each song is analysed for its structure (beats, bars, sections, energy, onsets). When you add a song you choose presets that shape how its chart is built: a style preset (a probabilistic matrix weighting target types and density per section kind) and a difficulty (D9). The generator samples spawns bar by bar from the style matrix, scaled by the level the difficulty resolves to, seeded by song + preset + level so the same inputs always give the same chart. No song needs a hand-made chart. The MVP ships one style preset, Mixed (D8); the others are on the roadmap.
**Why:** The human's comments on V3 and D7: many songs in the long run, so charts must be generated from each song's own structure via a probabilistic decision matrix, with a few basic presets picked when adding a song to alter how it's structured. Start with one preset for the MVP so it can be tested, and keep the rest on the roadmap.
**Consequences:**
- Song analysis must find sections, not only beats.
- Presets are data: one matrix per preset, plus optional multipliers on the level table's target parameters (e.g. strafer health × 1.5 for a future Tracker preset).
- The seed uses the level, not the difficulty, because the level inside a band changes as you unlock (D17).
- Adding a song shows a preset picker; with only Mixed in the MVP it defaults to Mixed so adding stays one step.
- Roadmap presets: Quick taps, Tracker, Incoming (see scope, later).
**Affects:** D3 How does an uploaded song become a chart?, G1 Drop in a song and be playing it within seconds, with no se…, G3 Six target types each spawn on the beat, behave in time wit…

### D8 · Which themed presets ship first? — DECIDED
**Outcome:** Only Mixed for the MVP: all six target types, balanced (V5). Other presets come after testing.
**Why:** The human picked Mixed and said to start with one preset for the MVP so it can be tested, keeping the rest on the roadmap.
**Consequences:**
- The preset format must be general enough for the roadmap presets without code changes to the generator.
**Affects:** D7 How are charts generated so that any song gets a good chart?

### D9 · How does a song's difficulty relate to Azimuth's 1–10 drill levels? — DECIDED
**Outcome:** A difficulty preset per song, Beat Saber style: Easy, Normal, Hard or Expert, picked when adding a song (and changeable before playing). Each maps to a band of drill levels (Easy 1–3, Normal 4–6, Hard 7–8, Expert 9–10), and within the band the chart follows the player's drill level.
**Why:** Chosen by the human: it matches the Beat Saber/Guitar Hero feel and lets each song be a calm or intense run.
**Consequences:**
- Each song remembers its difficulty preset.
- A rule is needed for picking a band above your unlocked level (D10).
- The debrief and Logbook show the difficulty and the actual level played.
**Affects:** D7 How are charts generated so that any song gets a good chart?, G4 It is a first-class Azimuth drill: levels, stars, debrief,…
**Do not propose:** Levels alone as the difficulty, with no per-song setting; Free pick of any level with no unlocks

### D10 · What happens if you pick a difficulty above your unlocked level? — DECIDED
**Outcome:** All four difficulties are open from the start. The chart uses the band's lowest level, or your highest unlocked level if that falls inside the band. Stars count for the level actually played, and 1★ unlocks the next level as in every drill.
**Why:** It keeps the Beat Saber freedom to pick Expert while staying on Azimuth's star progression, without a confusing lock screen.
**Affects:** D9 How does a song's difficulty relate to Azimuth's 1–10 drill…, G4 It is a first-class Azimuth drill: levels, stars, debrief,…

### D11 · Is there a built-in song so the drill works before anything is uploaded? — DECIDED
**Outcome:** No built-in song. Players use their own songs; the drill asks you to add one before the first run. Generated audio exists only as test fixtures under tests/ and is never shipped or listed in the app.
**Why:** The human rejected the built-in song: "i have my own songs to use".
**Consequences:**
- The song screen needs a clear empty state: "Add a song to start".
- Analysis tests use a test-only PCM generator (tests/helpers/songgen.ts) with known beats and sections.
**Affects:** G1 Drop in a song and be playing it within seconds, with no se…, G2 Targets land on the beat of the music.
**Do not propose:** A built-in generated synthwave song shipped as the default song

### D12 · How long is a run? — DECIDED
**Outcome:** A run is the whole song, played to the end, with no length cap.
**Why:** The human's comment: "just play till the end of the song".
**Affects:** G5 Fun first: it feels like a rhythm game and a warm-up you wa…
**Do not propose:** Cap long songs at about 6 minutes; Fixed length of about 2 minutes cut from the busiest part

### D13 · How does firing work across the target types? — DECIDED
**Outcome:** You stand still (no WASD), like Blink and Pin. A click is one shot (flick shapes, bursts, peekers, decoys); holding the mouse button fires a continuous stream that damages holds and strafers while the crosshair is on them, as in Duelist. Shots resolve at the click instant, as everywhere in Azimuth.
**Why:** Reuses the existing weapons and Duelist's hold-to-track model; moving would add a second skill to a warm-up.
**Affects:** G3 Six target types each spawn on the beat, behave in time wit…

### D14 · What do the different flick shapes mean? — DECIDED
**Outcome:** The shape tells you the flick: circle = a normal flick on screen; diamond = a small precision target that gives a bigger Perfect bonus; triangle = a wide flick, spawned off screen beside or behind you and pointing the way to turn (with a positional ping, as in Snap).
**Why:** Three shapes, three flick skills from the existing drills (Blink, Pin, Snap), readable at a glance on a busy screen.
**Affects:** G3 Six target types each spawn on the beat, behave in time wit…

### D15 · How does the rhythm drill fit with the daily warm-up? — DECIDED
**Outcome:** Just a drill: it appears in the Training list like the other drills, with its own levels and stars. It is not part of the daily warm-up and does not count towards the streak.
**Why:** Chosen by the human.
**Consequences:**
- DAILY in src/ui/session.ts and the streak logic stay unchanged.
- The Training screen needs an entry point that leads to the song library before the briefing.
**Affects:** Overdrive, G4 It is a first-class Azimuth drill: levels, stars, debrief,…
**Do not propose:** Alternative rhythm warm-up that keeps the streak; An eighth step in the daily warm-up

### D16 · What is the drill called? — DECIDED
**Outcome:** Overdrive (drill id 'overdrive').
**Why:** Picked by the human from Cadence, Afterglow, Tempo and Overdrive.
**Affects:** Overdrive

### D17 · How do levels unlock inside a difficulty? — DECIDED
**Outcome:** Each difficulty band unlocks on its own. You start a band at its lowest level, and a star on a level unlocks the next level in that band (Easy 1→2→3, Hard 7→8, and so on). The level played is the highest unlocked level in the chosen band. Other drills' progression is unchanged.
**Why:** Chosen by the human. Azimuth's unlockedLevel() only counts consecutive stars from level 1, which would make stars on Hard or Expert unlock nothing.
**Consequences:**
- Overdrive needs its own helper (unlockedInBand) in src/rhythm/levels.ts; src/core/progress.ts stays as it is.
**Affects:** D10 What happens if you pick a difficulty above your unlocked l…, G4 It is a first-class Azimuth drill: levels, stars, debrief,…
**Do not propose:** Keep Azimuth's global unlock chain for Overdrive

### D18 · How does the rhythm change across a song? — DECIDED
**Outcome:** A starting feel, not a rule (D19). Each section kind has its own rhythmic feel, set in the style preset, so a song moves from steady to driving. Intro, calm and outro are steady: targets mostly sit on the beat and land a whole number of beats before it. Build lands targets on half beats, so they arrive on the off-beat and the pace tightens. Peak is the busiest: targets also use the off-beat eighths between beats, and land on half beats. Fills and flourishes at climactic moments: at least a run into every peak (e.g. a burst of orbs on eighths into the peak's first downbeat, where a target lands), and the generator may add more at drops and section changes. The level table's leadBeats stays smooth; the generator snaps it to the section's landing feel, never below 1 beat.
**Why:** The human asked for a mix, half beats in one part and whole beats in the other, whichever is most dramatic, plus fills at climactic moments. Steady calm sections against syncopated, busier peaks gives the biggest contrast, and a drum-fill run into each peak builds tension into the drop.
**Affects:** T5 Add the preset format, the Mixed preset and the level table, T6 Generate seeded charts from analysis, preset and level, D7 How are charts generated so that any song gets a good chart?, T19 Playtest and tune Mixed, the level table and the cues

### D19 · How strictly should Overdrive follow the plan's rules? — DECIDED
**Outcome:** Fun first. Overdrive is the playful step away from the rest of Azimuth's rigid, sweaty drills: a pre-game warm-up that gets you practising every aim skill through the music. The plan's rules on patterns, grids, target mix, choreography and look are starting points, not limits. Workers may go beyond them creatively (syncopation, repeated motifs, call-and-response, rests, fills and flourishes, accents on audible hits, surprises at drops, playful cues and juice) whenever it makes a run more fun and musical, and they say what they changed. What stays firm: targets are timed to something you can hear in the music (a beat, an off-beat or an onset), the screen stays readable, every target type still trains its aim skill, and the Do-not list holds.
**Why:** The human: "no need for restrictions on beat timings that are anal, i'm looking for a creative output with soul. The rest of the app is essentially a sweaty aim trainer and it's awesome; this is a step away from rigid controls and instead a good fun way to warm up pre-game that forces you to practise the different aim skills in the process. Fun is our aim on this one. Don't strictly follow any rule that restricts creativity."
**Affects:** G5 Fun first: it feels like a rhythm game and a warm-up you wa…, D18 How does the rhythm change across a song?, T6 Generate seeded charts from analysis, preset and level, T14 Add tap targets: flick shapes, bursts and decoys, T15 Add moving targets: strafers, holds and peekers, T16 Show the beat cues, combo and judgements, T19 Playtest and tune Mixed, the level table and the cues

Which target types should be in the first version? Each one trains a different aim skill, and all of them spawn on the beat and vanish if missed. → Flick shapes, Peekers, Holds, Decoys, Bursts, Strafers

How should an uploaded song become a chart? → Fully automatic

How strict is the timing? In each sketch the target appears on beat 1, and the coloured band shows when a hit counts. → Window + beat bonus (recommended)

How do you see when a target's beat is coming? Pick one or more; they combine. → Other: combine them

What should the drill look like? (Rough sketches of the first-person view.) → Synthwave grid

How should a song's difficulty relate to Azimuth's 1–10 drill levels? → Difficulty preset per song

How should the rhythm drill fit with the daily warm-up (today: 7 drills in a row, about 6 minutes, with a streak)? → Just a drill

What should the drill be called? Azimuth drills have one-word names (Blink, Snap, Echo, Pin, Triad, Duelist…). → Overdrive

_Generated by live-planner from plan "rhythm-drill" at seq 364. Change the plan and recompile; do not edit by hand._
