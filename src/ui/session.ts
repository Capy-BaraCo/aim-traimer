/**
 * The practice loop: briefing → drill → debrief (stars, unlocks, coach, charts) → next step.
 * Also the Daily Warm-up, which chains a drill per skill at your current levels.
 */

import { summariseEcho, summariseFlicks, type DirSector, type FlickRecord } from '../core/analytics';
import {
  feedback,
  flickFindings,
  hearingFindings,
  OVERDRIVE_SKIPPED_FLICK_FINDINGS,
  placementFindings,
  rhythmFindings,
  switchingFindings,
  trackingFindings,
  type DrillId,
  type Finding,
} from '../core/coach';
import { MAX_LEVEL, rankFor, streak, unlockedLevel } from '../core/progress';
import * as songs from '../core/songs';
import { store, type CommitResult } from '../core/store';
import type { DrillReport } from '../drills/drill';
import type { OverdriveReportData } from '../drills/overdrive';
import { DRILL_DEFS, drillDef, type DrillContext, type DrillDef } from '../drills/registry';
import { compose } from '../rhythm/generator';
import { DIFFICULTY_BANDS, levelFor as bandLevel, levelParams, unlockedInBand } from '../rhythm/levels';
import { presetById } from '../rhythm/presets';
import { DIFFICULTIES, type Difficulty, type SongMeta } from '../rhythm/types';
import type { App } from './app';
import * as C from './charts';
import { canFilm, openFilm } from './film';
import { lessonKindFor } from '../film/lessons';
import { actions, esc, h } from './dom';

/** Everything the coach can say about one run. */
export function findingsFor(r: DrillReport): Finding[] {
  const a = r.analytics;
  const out: Finding[] = [];
  if (a?.hearing?.length) out.push(...hearingFindings(summariseEcho(a.hearing)));
  const od = overdriveData(r);
  if (a?.flicks?.length) {
    const flicks = flickFindings(summariseFlicks(a.flicks), a.flickContext ?? 'mixed');
    // Overdrive flicks are timed from landing, so players waiting for the beat look slow: drop the speed findings.
    out.push(...(od ? flicks.filter((f) => !OVERDRIVE_SKIPPED_FLICK_FINDINGS.has(f.id)) : flicks));
  }
  if (od) out.push(...rhythmFindings(od));
  if (a?.tracking) out.push(...trackingFindings(a.tracking));
  if (a?.placement) out.push(...placementFindings(a.placement));
  if (a?.switching) out.push(...switchingFindings(a.switching));
  if (a?.movement && a.movement.moving < 0.8)
    out.push({
      id: 'planted',
      kind: 'fix',
      weight: 0.8,
      title: 'You stood still too often',
      body: `You were moving only ${Math.round(a.movement.moving * 100)}% of the time. In Overwatch a player who stands still is the easiest target in the game.`,
      tip: 'Tap A and D in short, uneven bursts while you shoot. Your hand keeps the crosshair on target; your legs keep you alive.',
      drill: 'crossfire',
    });
  if (!out.length)
    r.notes.forEach((n, i) => out.push({ id: `note-${i}`, kind: 'fix', weight: 0.3 - i * 0.01, title: n, body: '', tip: '' }));
  return out;
}

/** An Overdrive run's data, or null for any other drill. */
const overdriveData = (r: DrillReport): OverdriveReportData | null => (r.id === 'overdrive' ? (r.data as OverdriveReportData) : null);

function extrasFrom(r: DrillReport) {
  const a = r.analytics;
  return {
    // Overdrive's flicks are timed from landing, not from the beat, so they stay out of the Logbook's flick history.
    flicks: r.id === 'overdrive' ? undefined : a?.flicks,
    track: a?.tracking
      ? {
          acc: a.tracking.acc,
          delayMs: a.tracking.summary.delayMs,
          trail: a.tracking.trail,
          vertical: a.tracking.vertical,
          jitter: a.tracking.summary.jitter,
        }
      : undefined,
    placement: a?.placement ? { error: a.placement.error, vertical: a.placement.vertical } : undefined,
    hearing: a?.hearing?.length
      ? (() => {
          const e = summariseEcho(a.hearing);
          return { rate: e.rate, front: e.front.rate, behind: e.behind.rate, turnMs: e.turnMs };
        })()
      : undefined,
  };
}

const levelFor = (id: string) => unlockedLevel(store.get().progress[id]);

// ------------------------------------------------------------------------------------ briefing

export function openBriefing(app: App, id: DrillId, level?: number): void {
  const def = drillDef(id);
  if (!def) return;
  // Overdrive plays a song: it starts at the song screen, which opens its own briefing.
  if (id === 'overdrive') {
    app.closeOverlay();
    app.go('songs');
    return;
  }
  const prog = store.get().progress[id];
  const unlocked = unlockedLevel(prog);
  let sel = Math.min(level ?? unlocked, unlocked);

  const el = h(`<div class="overlay scroll"><div class="brief rise"></div></div>`);
  const box = el.querySelector('.brief') as HTMLElement;
  const render = () => {
    const res = prog?.levels[sel];
    const chips = Array.from({ length: MAX_LEVEL }, (_, i) => {
      const n = i + 1;
      const r = prog?.levels[n];
      const locked = n > unlocked;
      return `<button class="lvl ${n === sel ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="level" data-n="${n}" ${locked ? 'disabled' : ''} aria-label="Level ${n}${locked ? ' (locked)' : ''}">
        <b>${locked ? '🔒' : n}</b>${C.stars(r?.stars ?? 0, 3, 'tiny')}</button>`;
    }).join('');
    box.innerHTML = `
      <div class="brief-head">
        <div>
          <div class="kicker">${esc(def.skill)} · drill</div>
          <h3 class="display">${esc(def.name)}</h3>
          <p class="lede">${esc(def.oneLiner)}</p>
        </div>
        <div class="brief-goal">
          <div class="kicker plain">Level ${sel} goal</div>
          <div class="goal-row">${C.stars(1)}<b>${def.stars[0]}</b></div>
          <div class="goal-row">${C.stars(2)}<b>${def.stars[1]}</b></div>
          <div class="goal-row">${C.stars(3)}<b>${def.stars[2]}</b></div>
          <div class="mono muted" style="font-size:10px;margin-top:8px">${res ? `YOUR BEST · ${res.best} ${'★'.repeat(res.stars)}` : 'NOT PLAYED YET'}</div>
        </div>
      </div>
      <div class="lvl-row" role="group" aria-label="Choose a level">${chips}</div>
      <p class="lvl-desc"><span class="tag">Level ${sel}</span> ${esc(def.levels[sel - 1])}${sel < MAX_LEVEL && sel === unlocked ? ` — earn ★ to unlock level ${sel + 1}` : ''}</p>
      <div class="brief-cols">
        <section><h5>Your job</h5><ol>${def.job.map((j) => `<li>${esc(j)}</li>`).join('')}</ol></section>
        <section><h5>How you're scored</h5><p>${esc(def.scoring)}</p><h5>What we measure</h5><ul>${def.measures.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></section>
        <section><h5>Tips</h5><ul>${def.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${store.settings.coachCues ? '<p class="note">The coach will call out patterns while you play.</p>' : ''}</section>
      </div>
      <div class="actions">
        <button class="btn" data-act="start">Start level ${sel} <span class="arr">→</span></button>
        <button class="btn ghost" data-act="chapter">Read the chapter</button>
        <button class="btn ghost" data-act="close">Back</button>
        <span class="note"><span class="kbd">ENTER</span> start · <span class="kbd">ESC</span> pauses in game</span>
      </div>`;
  };
  render();
  actions(el, {
    level: (b) => {
      sel = Number(b.dataset.n);
      render();
    },
    start: () => startDrill(app, def, sel),
    chapter: () => {
      app.closeOverlay();
      app.go('manual', def.chapter);
    },
    close: () => app.closeOverlay(),
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startDrill(app, def, sel);
  });
  el.tabIndex = -1;
  app.showOverlay(el);
  el.focus();
}

// ------------------------------------------------------------------------------------ Overdrive

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'Slow and roomy. Targets wait for you and the window is wide.',
  normal: 'A steady groove with a few targets at once.',
  hard: 'Busy and tight. Keep your eyes moving.',
  expert: 'Fast, small and crowded. For when Hard feels easy.',
};

/** The one decoded song kept in memory (a few minutes of audio is tens of megabytes), so a briefing, a run and a retry share it. */
let prepared: songs.PreparedSong | null = null;

/** Decode and analyse a song from the library (cached for the song last used). Errors are plain words. */
export async function prepareSong(app: App, id: string, onProgress?: (p: songs.PrepareProgress) => void): Promise<songs.PreparedSong> {
  if (prepared?.meta.id === id) {
    onProgress?.({ stage: 'ready', fraction: 1 });
    return prepared;
  }
  prepared = null;
  prepared = await songs.prepare(id, app.game.audio, onProgress);
  return prepared;
}

/** Build the chart for a level and wrap it with the song, ready for `startDrill`. */
export function overdriveContext(song: songs.PreparedSong, level: number): DrillContext {
  const { chart, roles } = compose(song.analysis, song.structure, presetById(song.meta.preset), level, song.meta.id);
  return { chart, roles, buffer: song.buffer, beats: song.analysis.beats, songName: song.meta.name };
}

/** The briefing for Overdrive: the song, a difficulty to pick, and the level that difficulty plays (D10, D17). */
export function openOverdriveBriefing(app: App, meta: SongMeta): void {
  const def = drillDef('overdrive')!;
  const prog = store.get().progress.overdrive;
  let difficulty: Difficulty = meta.difficulty;
  let song: songs.PreparedSong | null = null;
  let problem = '';
  let progress = 0;

  const el = h(`<div class="overlay scroll"><div class="brief rise"></div></div>`);
  const box = el.querySelector('.brief') as HTMLElement;
  const render = () => {
    const level = bandLevel(difficulty, prog);
    const band = DIFFICULTY_BANDS[difficulty];
    const res = prog?.levels[level];
    const chips = DIFFICULTIES.map((d) => {
      const lv = bandLevel(d, prog);
      return `<button class="lvl od-diff ${d === difficulty ? 'on' : ''}" data-act="diff" data-d="${d}" aria-label="${DIFFICULTY_LABEL[d]}, level ${lv}">
        <span class="od-diff-name">${DIFFICULTY_LABEL[d]}</span><b>${lv}</b>${C.stars(prog?.levels[lv]?.stars ?? 0, 3, 'tiny')}</button>`;
    }).join('');
    const status = problem
      ? `<span class="od-status bad">${esc(problem)}</span>`
      : song
        ? '<span class="od-status ok">Your song is ready.</span>'
        : `<span class="od-status">Getting your song ready… <b>${Math.round(progress * 100)}%</b></span>`;
    box.innerHTML = `
      <div class="brief-head">
        <div>
          <div class="kicker">${esc(def.skill)} · drill</div>
          <h3 class="display">${esc(def.name)}</h3>
          <p class="od-song"><span class="mono muted">SONG</span> <b>${esc(meta.name)}</b></p>
          <p class="lede">${esc(def.oneLiner)}</p>
        </div>
        <div class="brief-goal">
          <div class="kicker plain">Level ${level} goal</div>
          <div class="goal-row">${C.stars(1)}<b>${def.stars[0]}</b></div>
          <div class="goal-row">${C.stars(2)}<b>${def.stars[1]}</b></div>
          <div class="goal-row">${C.stars(3)}<b>${def.stars[2]}</b></div>
          <div class="mono muted" style="font-size:10px;margin-top:8px">${res ? `YOUR BEST · ${res.best} ${'★'.repeat(res.stars)}` : 'NOT PLAYED YET'}</div>
        </div>
      </div>
      <div class="lvl-row od-diff-row" role="group" aria-label="Choose a difficulty">${chips}</div>
      <p class="lvl-desc"><span class="tag">${DIFFICULTY_LABEL[difficulty]} · level ${level}</span> ${esc(DIFFICULTY_BLURB[difficulty])}${level < band.to ? ` Earn a ★ to unlock level ${level + 1}.` : ' This is the top level of this difficulty.'}</p>
      <div class="brief-cols">
        <section><h5>Your job</h5><ol>${def.job.map((j) => `<li>${esc(j)}</li>`).join('')}</ol></section>
        <section><h5>How you're scored</h5><p>${esc(def.scoring)}</p><h5>What we measure</h5><ul>${def.measures.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></section>
        <section><h5>Tips</h5><ul>${def.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
      </div>
      <div class="actions">
        <button class="btn" data-act="start" ${song ? '' : 'disabled'}>Start level ${level} <span class="arr">→</span></button>
        <button class="btn ghost" data-act="songs">Change song</button>
        <button class="btn ghost" data-act="close">Back</button>
        ${status}
      </div>`;
  };
  const start = () => {
    if (!song) return;
    const level = bandLevel(difficulty, prog);
    startDrill(app, def, level, overdriveContext(song, level));
  };
  render();
  actions(el, {
    diff: (b) => {
      difficulty = b.dataset.d as Difficulty;
      void songs.setPresets(meta.id, meta.preset, difficulty).catch(() => {});
      render();
    },
    start,
    songs: () => {
      app.closeOverlay();
      app.go('songs');
    },
    close: () => app.closeOverlay(),
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });
  el.tabIndex = -1;
  app.showOverlay(el);
  el.focus();
  prepareSong(app, meta.id, (p) => {
    // Decoding is the first part; analysing (or reading the saved analysis) the rest.
    progress = p.stage === 'decoding' ? p.fraction * 0.4 : 0.4 + p.fraction * 0.6;
    const pc = box.querySelector('.od-status b');
    if (pc) pc.textContent = `${Math.round(progress * 100)}%`;
  }).then(
    (s) => {
      song = s;
      if (box.isConnected) render();
    },
    (e) => {
      problem = songs.describeSongError(e);
      if (box.isConnected) render();
    },
  );
}

/** Play a drill at a level. `ctx` is the extra launch data some drills need (Overdrive's chart and song). */
export function startDrill(app: App, def: DrillDef, level: number, ctx?: DrillContext): void {
  app.play(
    () => def.make(app.game, level, ctx),
    (r) => {
      app.endPlay();
      // Overdrive unlocks inside its difficulty band (D17), not along Azimuth's global chain.
      const od = overdriveData(r);
      const before = od ? unlockedInBand(store.get().progress[def.id], od.difficulty) : 0;
      const commit = store.commitRun(def.id, level, r.score, def.stars, MAX_LEVEL, extrasFrom(r));
      if (od) {
        const after = unlockedInBand(store.get().progress[def.id], od.difficulty);
        commit.unlocked = after > before ? after : null;
      }
      showDebrief(app, def, level, r, commit, ctx);
    },
  );
}

// ------------------------------------------------------------------------------------ debrief

function verdict(stars: number): string {
  return [
    'Not this time. The coach has found what to fix.',
    'Level passed. Two more stars are waiting.',
    'Strong run. One star left on this level.',
    'Perfect: three stars.',
  ][stars];
}

const dirOf = (f: Finding): DirSector | undefined => (f.id.startsWith('dir-') ? (f.id.slice(4) as DirSector) : undefined);

/** A coach card; with `flicks`, findings about flicks get a "Watch it" replay button. */
export function findingCard(f: Finding, flicks?: readonly FlickRecord[]): string {
  const watch = flicks && canFilm(lessonKindFor(f.id), flicks, dirOf(f));
  return `<article class="finding ${f.kind}">
    <div class="f-kind">${f.kind === 'good' ? '✔ What went well' : '✖ Work on this'}</div>
    <h4>${esc(f.title)}</h4>
    ${f.body ? `<p>${esc(f.body)}</p>` : ''}
    ${f.tip ? `<p class="f-tip"><b>Try this:</b> ${esc(f.tip)}</p>` : ''}
    ${watch ? `<button class="watch" data-act="film" data-fid="${esc(f.id)}">${f.kind === 'good' ? 'Watch your best' : 'Watch it'}</button>` : ''}
  </article>`;
}

/** Open the film room for a finding, picking examples from `flicks`. */
export function filmFinding(app: App, f: Finding, flicks: readonly FlickRecord[], source: string): void {
  const kind = lessonKindFor(f.id);
  if (!kind) return;
  openFilm(app, { kind, records: flicks, dir: dirOf(f), source, tip: f.tip || undefined, drill: f.drill, onPractise: (d) => openBriefing(app, d) });
}

const SHAPE_ROWS = [
  ['circle', 'Circles'],
  ['diamond', 'Diamonds'],
  ['triangle', 'Triangles'],
] as const;
const KIND_ROWS = [
  ['burst', 'Bursts'],
  ['peeker', 'Peekers'],
  ['strafer', 'Strafers'],
  ['hold', 'Holds'],
] as const;

/** The rhythm-game results strip, the timing histogram and the hit rate per target type. */
function rhythmResults(d: OverdriveReportData): string {
  const rows = [
    ...SHAPE_ROWS.flatMap(([k, label]) => (d.hitRateByShape[k] === undefined ? [] : [{ label, rate: d.hitRateByShape[k]! }])),
    ...KIND_ROWS.flatMap(([k, label]) => (d.hitRate[k] === undefined ? [] : [{ label, rate: d.hitRate[k]! }])),
  ];
  const big = (label: string, value: string | number, cls = '') => `<div class="${cls}"><span>${label}</span><b>${value}</b></div>`;
  return `<div class="od-results">
      ${big('Best combo', `×${d.maxCombo}`, 'hot')}
      ${big('Perfect', d.counts.perfect, 'perfect')}
      ${big('Early', d.counts.early)}
      ${big('Late', d.counts.late)}
      ${big('Missed', d.counts.miss)}
    </div>
    <div class="db-charts od-charts">
      ${C.timingHistogram(d.offsets, levelParams(d.level).perfectMs)}
      ${C.hitRateBars(rows)}
    </div>`;
}

function chartsFor(r: DrillReport): string {
  const a = r.analytics;
  const od = overdriveData(r);
  const rhythm = od ? rhythmResults(od) : '';
  if (a?.flicks?.length) {
    const s = summariseFlicks(a.flicks);
    return `${rhythm}<div class="db-charts">
      ${a.hearing?.length ? C.compassChart(a.hearing) : ''}
      ${C.landingMap(a.flicks)}
      <div class="chart-pair">${C.directionChart(s)}${C.speedShape(s)}</div>
      ${C.rangeBars(s)}
      ${od ? '' : C.timeSplit(s)}
    </div>`;
  }
  if (rhythm) return rhythm;
  if (a?.tracking) return `<div class="db-charts">${C.trackingChart(a.tracking.summary.series)}</div>`;
  if (a?.placement) return `<div class="db-charts">${C.placementChart(a.placement.points)}</div>`;
  return '';
}

function meter(score: number, t: readonly [number, number, number]): string {
  const marks = t.map((v, i) => `<i style="left:${v}%" title="${i + 1}★ at ${v}"><span>${'★'.repeat(i + 1)}</span></i>`).join('');
  return `<div class="db-meter"><div class="fill" style="width:${Math.min(100, score)}%"></div>${marks}</div>`;
}

export function showDebrief(app: App, def: DrillDef, level: number, r: DrillReport, c: CommitResult, ctx?: DrillContext): void {
  const fb = feedback(findingsFor(r));
  const next = fb.next && fb.next !== def.id ? drillDef(fb.next) : null;
  const od = overdriveData(r);
  // Overdrive's levels unlock inside the difficulty band, so "next level" stops at the band's top (D17).
  const canNext = od
    ? level < DIFFICULTY_BANDS[od.difficulty].to && unlockedInBand(store.get().progress[def.id], od.difficulty) > level
    : level < MAX_LEVEL && levelFor(def.id) > level;
  const lastInBand = !!od && level >= DIFFICULTY_BANDS[od.difficulty].to;
  const rank = rankFor(c.totalStars);
  const rankUp = c.rankBefore !== c.rankAfter;
  const statHtml = r.stats
    .map((s) => `<div title="${esc(s.hint ?? '')}"><span>${esc(s.label)}</span><b>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</b></div>`)
    .join('');
  const el = h(`
    <div class="overlay scroll">
      <div class="debrief rise">
        <aside class="db-side"><div class="db-side-in">
          <div class="kicker plain">${esc(def.skill)} · ${od ? `${esc(od.difficulty)} · ` : ''}level ${level}</div>
          <div class="db-stars">${C.stars(c.stars, 3, 'big')}</div>
          <div class="db-score">${r.score}<small>/100</small></div>
          ${meter(r.score, def.stars)}
          <div class="db-badges">
            ${c.unlocked ? `<span class="badge hot">LEVEL ${c.unlocked} UNLOCKED</span>` : ''}
            ${c.newBest && c.previousBest !== null ? '<span class="badge">NEW BEST</span>' : ''}
            ${c.starsGained ? `<span class="badge">+${c.starsGained} ★</span>` : ''}
            ${rankUp ? `<span class="badge hot">RANK UP · ${esc(c.rankAfter.toUpperCase())}</span>` : ''}
          </div>
          <p class="db-note">${
            c.stars === 0
              ? `Score ${def.stars[0]} to earn your first star${od ? (lastInBand ? '' : ` and unlock level ${level + 1}`) : level < MAX_LEVEL ? ` and unlock level ${level + 1}` : ''}.`
              : c.previousBest !== null && !c.newBest
                ? `Your best on this level is still ${c.previousBest}.`
                : 'Saved to your Logbook.'
          }</p>
          <div class="db-rank">
            <div class="mono" style="font-size:10px;letter-spacing:.14em">${esc(rank.name.toUpperCase())} · ${c.totalStars} ★</div>
            <div class="bar"><i style="width:${Math.round(rank.progress * 100)}%"></i></div>
            <div class="mono muted" style="font-size:9.5px">${rank.next ? `${rank.next.stars - c.totalStars} ★ to ${esc(rank.next.name)}` : 'Top rank reached'}</div>
          </div>
          <div class="db-actions">
            ${canNext ? `<button class="btn" data-act="nextlvl">Play level ${level + 1} <span class="arr">→</span></button>` : ''}
            <button class="btn ${canNext ? 'ghost' : ''}" data-act="retry">Retry level ${level} <span class="arr">↻</span></button>
            <button class="btn ghost" data-act="back">Back</button>
          </div>
        </div></aside>
        <section class="db-main">
          <div class="kicker">Debrief</div>
          <h3 class="display">${esc(def.name)}</h3>
          ${od?.songName ? `<p class="od-song"><span class="mono muted">SONG</span> <b>${esc(od.songName)}</b></p>` : ''}
          <p class="lede">${verdict(c.stars)}</p>
          <div class="findings">${[fb.good, ...fb.fixes].filter((f): f is Finding => !!f).map((f) => findingCard(f, r.analytics?.flicks)).join('') || '<p class="note">Not enough data this run for the coach — play a full level.</p>'}</div>
          ${
            next
              ? `<div class="db-next"><div><div class="kicker plain">Recommended next</div><b>${esc(next.name)}</b> <span class="muted">level ${levelFor(next.id)} · ${esc(next.skill)}</span></div><button class="btn small" data-act="next" data-id="${next.id}">Open <span class="arr">→</span></button></div>`
              : ''
          }
          ${chartsFor(r)}
          <h5 class="db-h">All the numbers</h5>
          <div class="stats">${statHtml}</div>
        </section>
      </div>
    </div>`);
  actions(el, {
    // A context belongs to one level (Overdrive's chart is built for it), so only a retry reuses it.
    nextlvl: () => {
      if (!od) return startDrill(app, def, level + 1);
      // A new level is a new chart, built from the same song (the decoded song is kept from the run).
      void prepareSong(app, od.songId).then(
        (song) => startDrill(app, def, level + 1, overdriveContext(song, level + 1)),
        (e) => app.toast(songs.describeSongError(e)),
      );
    },
    retry: () => startDrill(app, def, level, ctx),
    back: () => {
      app.closeOverlay();
      app.refresh();
    },
    next: (b) => openBriefing(app, b.dataset.id as DrillId),
    film: (b) => {
      const f = [fb.good, ...fb.fixes].find((x) => x?.id === b.dataset.fid);
      if (f && r.analytics?.flicks) filmFinding(app, f, r.analytics.flicks, `From this ${def.name} run`);
    },
  });
  app.showOverlay(el);
}

// ------------------------------------------------------------------------------------ daily

export const DAILY: DrillId[] = ['duelist', 'blink', 'snap', 'echo', 'triad', 'pin', 'crossfire'];

interface DailyResult {
  def: DrillDef;
  level: number;
  report: DrillReport;
  commit: CommitResult;
}

export function runDaily(app: App): void {
  const plan = DAILY.map((id) => ({ def: drillDef(id)!, level: levelFor(id) }));
  const results: DailyResult[] = [];
  const make = (i: number) => () => {
    const d = plan[i].def.make(app.game, plan[i].level);
    d.kicker = `DAILY ${i + 1}/${plan.length} · ${d.kicker}`;
    return d;
  };
  const onDone = (i: number) => (r: DrillReport) => {
    const p = plan[i];
    results.push({ ...p, report: r, commit: store.commitRun(p.def.id, p.level, r.score, p.def.stars, MAX_LEVEL, extrasFrom(r)) });
    if (i + 1 < plan.length) app.chain(make(i + 1), onDone(i + 1), { countdown: 4, label: `Next · ${plan[i + 1].def.name}` });
    else {
      app.endPlay();
      showDailySummary(app, results);
    }
  };
  app.play(make(0), onDone(0), { countdown: 3, label: `Daily warm-up · ${plan[0].def.name}` }, () => {
    if (results.length) showDailySummary(app, results);
  });
}

function showDailySummary(app: App, results: DailyResult[]): void {
  const all = results.flatMap((x) => findingsFor(x.report));
  const fb = feedback(all);
  const flicks = results.flatMap((x) => x.report.analytics?.flicks ?? []);
  const gained = results.reduce((s, x) => s + x.commit.starsGained, 0);
  const st = streak(store.get().days);
  const el = h(`
    <div class="overlay scroll">
      <div class="debrief daily rise">
        <aside class="db-side"><div class="db-side-in">
          <div class="kicker plain">Daily warm-up</div>
          <div class="db-score">${results.length}<small>/${DAILY.length} done</small></div>
          <div class="db-badges">
            <span class="badge hot">${st}-DAY STREAK</span>
            ${gained ? `<span class="badge">+${gained} ★</span>` : ''}
          </div>
          <p class="db-note">Come back tomorrow to keep the streak. Short daily practice beats long weekly sessions.</p>
          <div class="db-actions"><button class="btn" data-act="book">Open Logbook <span class="arr">→</span></button><button class="btn ghost" data-act="back">Back</button></div>
        </div></aside>
        <section class="db-main">
          <div class="kicker">Today</div>
          <h3 class="display">Warm-up done</h3>
          <table class="daily-table"><thead><tr><th>Drill</th><th>Level</th><th>Score</th><th>Stars</th><th></th></tr></thead><tbody>
            ${results
              .map(
                (x) =>
                  `<tr><td><b>${esc(x.def.name)}</b><br><span class="muted">${esc(x.def.skill)}</span></td><td>${x.level}</td><td>${x.report.score}</td><td>${C.stars(x.commit.stars)}</td><td>${x.commit.unlocked ? `<span class="badge hot">LV ${x.commit.unlocked} UNLOCKED</span>` : ''}</td></tr>`,
              )
              .join('')}
          </tbody></table>
          <h5 class="db-h">Tomorrow, focus on</h5>
          <div class="findings">${fb.fixes.map((f) => findingCard(f, flicks)).join('') || '<p class="note">Nothing stood out. Push a level higher tomorrow.</p>'}</div>
        </section>
      </div>
    </div>`);
  actions(el, {
    book: () => {
      app.closeOverlay();
      app.go('logbook');
    },
    back: () => {
      app.closeOverlay();
      app.refresh();
    },
    film: (b) => {
      const f = fb.fixes.find((x) => x.id === b.dataset.fid);
      if (f) filmFinding(app, f, flicks, "From today's warm-up");
    },
  });
  app.showOverlay(el);
}

export { DRILL_DEFS };
