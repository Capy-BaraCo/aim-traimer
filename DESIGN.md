# DESIGN.md: Azimuth design constraints

Binding rules for any agent adding or changing UI, copy, motion or sound. Derived from the code as of the `overdrive` branch (`src/styles/main.css` tokens, `src/ui/*`, `src/ui/screens/*`). If the code and this file disagree, fix the one that is wrong in the same change. Overdrive-specific product decisions live in `.plan/plans/rhythm-drill/out/model/INDEX.md` and win on scope; this file wins on look, structure and voice.

## 1. Identity

Azimuth is **a precision instrument left out in the desert at dusk**: ink, bone and one vermilion signal colour, with a calm, technical, slightly editorial feel (a field manual, a survey tool). It is not a game launcher, a neon arcade or a dashboard.

Two visual layers exist and must not bleed into each other:

| Layer | Where | Look |
|---|---|---|
| **Instrument** (default) | every menu, screen, overlay, report, Field Manual, Logbook | ink / bone / signal, below |
| **Synthwave** | Overdrive's 3D world, its in-run HUD and cues, and the small Overdrive accents on menus (section 8) | pink / cyan / sunset gradient |

Rule: a menu is always Instrument. Synthwave appears on a menu only as a contained accent (the Overdrive card art, the song screen's `--od-*` colours, the sun), never as a page-wide restyle.

## 2. Tokens (use these, never raw hex in screens)

Defined in `:root` in `src/styles/main.css`.

- Surfaces: `--ink` `#14120f` (page), `--ink-2/3/4` (raised), `--glass` / `--glass-2` (translucent panels over the 3D backdrop).
- Text: `--bone` (primary), `--bone-2` (body copy, ledes), `--bone-3`, `--dust` (labels, muted).
- Accent: `--signal` `#ff4b1f` is **the** accent: primary buttons, kicker rule, selection, focus ring, key numbers. `--signal-2` for links. `--signal-soft` for fills.
- Support: `--cobalt` / `--cobalt-2` (secondary data series), `--acid` (success / good), `--warn` `#ffb020` (caution).
- Lines: `--hair` (default 1px border), `--hair-2` (stronger).
- Type: `--f-display` Big Shoulders Display, `--f-serif` Instrument Serif, `--f-mono` Martian Mono, `--f-body` Geist. Motion: `--ease` `cubic-bezier(.16,1,.3,1)`.
- Overdrive-only colours (`#ff4fd8` pink, `#4de8ff` cyan, `#ffb020`→`#ff4b1f`→`#ff4fd8` sun gradient) are scoped to Overdrive classes (`.songs`, `.od-*`, `.hud.od-on`). Do not promote them to `:root` or use them on other drills' screens.

Never add a new accent colour, a light theme (`color-scheme: dark` is fixed) or gradients on ordinary UI.

## 3. Typography

- **Page title**: `h2.display` (Big Shoulders 900, uppercase, line-height .84) with **one italic serif word** in a `<span class="serif">`: "Earn your *stars.*", "Your *songs.*". Keep that pattern.
- **Kicker** above every title: `.kicker` (mono, 10.5px, .22em tracking, uppercase, short signal rule). `.kicker.plain` drops the rule inside cards.
- **Lede** under it: `.lede` (15.5px, `--bone-2`, max 54ch).
- **Labels, buttons, stats, counts**: mono, uppercase, wide tracking. **Numbers** that matter: `.num` (display, tabular).
- Body copy 13–14px Geist. Don't introduce other fonts or sizes below 10px.

## 4. Shape and components

- **Square, hairline, no rounding.** Borders are `1px solid var(--hair)`; `border-radius` is 0–2px (only dots/rungs are round). No soft cards, no shadows except the button hover glow.
- **Primary button** `.btn`: signal fill, ink text, mono caps, clipped top-right corner, trailing `<span class="arr">→</span>`. One primary per view. Secondary `.btn.ghost`. Compact `.btn.small`. Disabled is `[disabled]`, not hidden.
- **Panels**: `.glass` (blurred translucent) over the backdrop; `.paper` for the bone-coloured report/certificate surfaces.
- **Cards** follow `.tcard`: kicker row, `h3`, one-line description, level ladder (`.rung` states `locked | next | done` + `s0..s3`), foot with sparkline and a small button. A new drill card must reuse this anatomy. Overdrive's wide `.od-card` is the single sanctioned variant (it plays your own songs and unlocks per difficulty).
- **Segmented choices** (difficulty, options): pill/segment buttons with `aria-pressed`, one on at a time (`.od-pill`, `.seg`).
- **Destructive actions** confirm inline ("Delete this song? Delete / Keep"), never with `window.confirm`.
- **Toasts** via `app.toast()`; **errors** as inline `role="alert"` text next to the thing that failed, with a plain-words reason.
- Icons: none. Use text, the `→ ↻ ← ✕ +` glyphs and the `★`.

## 5. Structure and navigation

- No framework. A screen is a function registered with `App.register(route, factory)` returning `{ el, destroy?, onKey? }`; HTML is a template string through `h()`; clicks go through `actions(root, { name: fn })` using `data-act`. Escape every dynamic string with `esc()`.
- Routes live in the `Route` union in `src/ui/app.ts`. The left **spine** shows the seven numbered sections (`01 CALIBRATE … 07 SETTINGS`). **Do not add spine entries for single drills or sub-screens.** Sub-screens (e.g. `songs`) map to their parent spine item (`route === 'songs' ? 'training'`) and offer a `← Training` link.
- Reading screens (long text, lists) go in `HEAVY` so the scrim is near-opaque and the backdrop renders at 20 fps. Screens over the live 3D scene stay light.
- Drills are launched only through the **briefing → play → report** flow in `src/ui/session.ts` (`openBriefing`, `startDrill`, `showReport`). A new drill adds a `DRILL_DEFS` entry; it does not get a bespoke launcher. Overdrive is the one exception that inserts a song picker first, then reuses the same briefing and report overlays.
- `play()` must be called synchronously from a click or key handler (pointer lock needs a gesture). Never start a drill from a timer, promise or load event.
- Entry points for a mode: **Training page card → (picker) → briefing → run → report → back/next level**. A mode is reachable from Training; Home's four `.inst` tiles stay the four front doors and are not added to.
- Every screen leaves the player one obvious next click.

## 6. Layout

- Desktop first (mouse is required; the `nomouse` screen covers touch). Left padding clears the 64px spine (`--spine`); screen padding is about 64px top, 44–56px sides, content max ~1100px.
- Breakpoints already used: 1100px and 900px. Collapse grids to one column there; do not invent new breakpoints.
- Stagger entrance with `.rise` (60ms steps via `--i`). Don't stagger more than about 12 items.

## 7. Motion, sound, accessibility

- Motion is eased (`--ease`), short and purposeful: rise-in, button lift, bar fills. Nothing loops on a menu except the song screen's equaliser and the card art.
- All new animation must be covered by the existing `prefers-reduced-motion` rule (it zeroes durations globally) and must not carry meaning alone.
- Keep `:focus-visible` (2px signal outline). Interactive elements are `<button>` with `aria-label` where the glyph is not text; groups get `role="group"` and a label; status text uses `role="status"` / `role="alert"`.
- Contrast: bone/bone-2 on ink only; `--dust` is for non-essential labels.
- Sound: everything through the single `Audio` class (`src/core/audio.ts`), unlocked from the first user gesture. Menus are silent apart from existing UI sounds. No autoplaying music anywhere outside a run.

## 8. Voice

- Plain words for a beginner, in the coach / Field Manual voice: second person, short sentences, say what to do and why. "Drop an MP3 here, or pick one from your computer." not "Import audio asset".
- Jargon (eDPI, BPM, onset) is explained once, in place, or hidden behind a `title` hint. Never blame the player in feedback; name the fix.
- Display titles are uppercased by CSS; write them in sentence case in the source.
- Numbers are always paired with a unit or label (`92 BPM`, `3/30 ★`).
- No exclamation marks, emoji, or hype ("awesome", "smash").

## 9. Overdrive: how it sits in the menus

Already in place (T17/T18): Training shows a wide Overdrive card (art, per-difficulty ladders, sparkline, **Pick a song →**); that opens `songs` (drop zone, song rows with difficulty pills, Play); Play opens the Overdrive briefing; the run uses the common report overlay with a rhythm results block.

Binding rules for anything that extends this:

1. **Reachable from Training only** (plus the Songs screen's own links). Not in the spine, not as a Home tile.
2. **Not in the daily warm-up or the streak** (D15); keep it out of `DAILY`.
3. **No built-in song**; the empty state asks for one (D11). Songs and audio never go into `localStorage` or the settings backup export.
4. **No setup screens**: no preview, tap-tempo or tempo nudge, no chart editor (D3). Add song → analysed automatically → briefing → Start.
5. Difficulty is a per-song pill (Easy/Normal/Hard/Expert) mapped to a level band (D9, D10, D17); styles stay `MIXED` only (D8).
6. Overdrive's Synthwave look is confined to its card, the song screen and the in-run world/HUD.
7. Copy keeps saying "your own music", "stay in this browser, never uploaded".

## 10. Before you merge UI work

- `npm run typecheck && npm test && npm run build` pass. Pure logic stays DOM-free so vitest (node) can run it.
- You used tokens and existing classes; any new class is namespaced (`od-` for Overdrive) and lives in `v2.css` (or `film.css` for the Film Room), not inline `style=` beyond one-off spacing.
- Run `npm run dev` and look at the screen at 1280×720 and 1920×1080, in the menu and after a drill report.
- Copy read aloud sounds like the coach.
- Counts quoted in Home/README/Field Manual ("7 drills × 10 levels", "Eight drills") match `DRILL_DEFS`; update them when you add a drill.
