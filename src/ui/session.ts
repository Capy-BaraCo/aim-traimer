/**
 * The practice loop: briefing → drill → debrief (stars, unlocks, coach, charts) → next step.
 * Also the Daily Warm-up, which chains a drill per skill at your current levels.
 */

import { summariseEcho, summariseFlicks, type DirSector, type FlickRecord } from '../core/analytics';
import {
  feedback,
  flickFindings,
  hearingFindings,
  placementFindings,
  switchingFindings,
  trackingFindings,
  type DrillId,
  type Finding,
} from '../core/coach';
import { MAX_LEVEL, rankFor, streak, unlockedLevel } from '../core/progress';
import { store, type CommitResult } from '../core/store';
import type { DrillReport } from '../drills/drill';
import { DRILL_DEFS, drillDef, type DrillDef } from '../drills/registry';
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
  if (a?.flicks?.length) out.push(...flickFindings(summariseFlicks(a.flicks), a.flickContext ?? 'mixed'));
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

function extrasFrom(r: DrillReport) {
  const a = r.analytics;
  return {
    flicks: a?.flicks,
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

export function startDrill(app: App, def: DrillDef, level: number): void {
  app.play(
    () => def.make(app.game, level),
    (r) => {
      app.endPlay();
      const commit = store.commitRun(def.id, level, r.score, def.stars, MAX_LEVEL, extrasFrom(r));
      showDebrief(app, def, level, r, commit);
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

function chartsFor(r: DrillReport): string {
  const a = r.analytics;
  if (a?.flicks?.length) {
    const s = summariseFlicks(a.flicks);
    return `<div class="db-charts">
      ${a.hearing?.length ? C.compassChart(a.hearing) : ''}
      ${C.landingMap(a.flicks)}
      <div class="chart-pair">${C.directionChart(s)}${C.speedShape(s)}</div>
      ${C.rangeBars(s)}
      ${C.timeSplit(s)}
    </div>`;
  }
  if (a?.tracking) return `<div class="db-charts">${C.trackingChart(a.tracking.summary.series)}</div>`;
  if (a?.placement) return `<div class="db-charts">${C.placementChart(a.placement.points)}</div>`;
  return '';
}

function meter(score: number, t: readonly [number, number, number]): string {
  const marks = t.map((v, i) => `<i style="left:${v}%" title="${i + 1}★ at ${v}"><span>${'★'.repeat(i + 1)}</span></i>`).join('');
  return `<div class="db-meter"><div class="fill" style="width:${Math.min(100, score)}%"></div>${marks}</div>`;
}

export function showDebrief(app: App, def: DrillDef, level: number, r: DrillReport, c: CommitResult): void {
  const fb = feedback(findingsFor(r));
  const next = fb.next && fb.next !== def.id ? drillDef(fb.next) : null;
  const unlockedNow = levelFor(def.id);
  const rank = rankFor(c.totalStars);
  const rankUp = c.rankBefore !== c.rankAfter;
  const statHtml = r.stats
    .map((s) => `<div title="${esc(s.hint ?? '')}"><span>${esc(s.label)}</span><b>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</b></div>`)
    .join('');
  const el = h(`
    <div class="overlay scroll">
      <div class="debrief rise">
        <aside class="db-side"><div class="db-side-in">
          <div class="kicker plain">${esc(def.skill)} · level ${level}</div>
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
              ? `Score ${def.stars[0]} to earn your first star${level < MAX_LEVEL ? ` and unlock level ${level + 1}` : ''}.`
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
            ${level < MAX_LEVEL && unlockedNow > level ? `<button class="btn" data-act="nextlvl">Play level ${level + 1} <span class="arr">→</span></button>` : ''}
            <button class="btn ${level < MAX_LEVEL && unlockedNow > level ? 'ghost' : ''}" data-act="retry">Retry level ${level} <span class="arr">↻</span></button>
            <button class="btn ghost" data-act="back">Back</button>
          </div>
        </div></aside>
        <section class="db-main">
          <div class="kicker">Debrief</div>
          <h3 class="display">${esc(def.name)}</h3>
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
    nextlvl: () => startDrill(app, def, level + 1),
    retry: () => startDrill(app, def, level),
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
