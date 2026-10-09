import { drillStars, MAX_LEVEL, rankFor, streak, totalStars, unlockedLevel } from '../../core/progress';
import { store } from '../../core/store';
import { DRILL_DEFS } from '../../drills/registry';
import { DIFFICULTY_BANDS, unlockedInBand } from '../../rhythm/levels';
import { DIFFICULTIES } from '../../rhythm/types';
import { App } from '../app';
import * as C from '../charts';
import { actions, esc, h } from '../dom';
import { DAILY, openBriefing, runDaily } from '../session';
import type { DrillId } from '../../core/coach';

App.register('training', (app) => {
  const p = store.get();
  const total = totalStars(p.progress);
  const rank = rankFor(total);
  const st = streak(p.days);
  const today = p.sessions.filter((s) => s.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

  const card = (id: DrillId, i: number) => {
    const def = DRILL_DEFS.find((d) => d.id === id)!;
    const prog = p.progress[id];
    const unlocked = unlockedLevel(prog);
    const ladder = Array.from({ length: MAX_LEVEL }, (_, k) => {
      const n = k + 1;
      const s = prog?.levels[n]?.stars ?? 0;
      const state = n > unlocked ? 'locked' : n === unlocked ? 'next' : 'done';
      return `<i class="rung ${state} s${s}" title="Level ${n}: ${n > unlocked ? 'locked' : `${s}/3 stars`}"></i>`;
    }).join('');
    const scores = p.sessions.filter((s) => s.drill === id).slice(-12).map((s) => s.score);
    return `<article class="tcard rise" style="--d:${i}">
      <div class="tc-top"><span class="kicker plain">${esc(def.skill)}</span><span class="mono muted">${drillStars(prog)}/${MAX_LEVEL * 3} ★</span></div>
      <h3>${esc(def.name)}</h3>
      <p>${esc(def.oneLiner)}</p>
      <div class="ladder" aria-label="Level ladder">${ladder}</div>
      <div class="tc-foot">
        <div><span class="mono muted">LEVEL</span> <b class="num">${unlocked}</b><span class="mono muted">/${MAX_LEVEL}</span></div>
        ${C.sparkline(scores)}
        <button class="btn small" data-act="brief" data-id="${id}">Play <span class="arr">→</span></button>
      </div>
    </article>`;
  };

  // Overdrive plays your own songs and unlocks inside each difficulty (D17), so it gets its own card.
  const od = DRILL_DEFS.find((d) => d.id === 'overdrive')!;
  const odProg = p.progress.overdrive;
  const odRungs = DIFFICULTIES.map((d) => {
    const band = DIFFICULTY_BANDS[d];
    const open = unlockedInBand(odProg, d);
    const rungs = Array.from({ length: band.to - band.from + 1 }, (_, k) => {
      const n = band.from + k;
      const s = odProg?.levels[n]?.stars ?? 0;
      const state = n > open ? 'locked' : n === open ? 'next' : 'done';
      return `<i class="rung ${state} s${s}" title="${d[0].toUpperCase()}${d.slice(1)}, level ${n}: ${n > open ? 'locked' : `${s}/3 stars`}"></i>`;
    }).join('');
    return `<div class="od-band" style="--n:${band.to - band.from + 1}"><span class="mono muted">${d.toUpperCase()}</span><div class="od-rungs">${rungs}</div></div>`;
  }).join('');
  const odScores = p.sessions.filter((s) => s.drill === 'overdrive').slice(-12).map((s) => s.score);
  const odCard = `<article class="od-card rise">
      <div class="od-card-art" aria-hidden="true"><i></i></div>
      <div class="od-card-main">
        <div class="tc-top"><span class="kicker plain">${esc(od.skill)} · your own music</span><span class="mono muted">${drillStars(odProg)}/${MAX_LEVEL * 3} ★</span></div>
        <h3>${esc(od.name)}</h3>
        <p>${esc(od.oneLiner)}</p>
        <div class="od-bands" aria-label="Levels by difficulty">${odRungs}</div>
        <div class="tc-foot">
          ${C.sparkline(odScores)}
          <button class="btn small" data-act="songs">Pick a song <span class="arr">→</span></button>
        </div>
      </div>
    </article>`;

  const order: DrillId[] = ['blink', 'snap', 'echo', 'duelist', 'crossfire', 'corner', 'triad', 'pin'];
  const count = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][DAILY.length] ?? String(DAILY.length);
  const el = h(`
    <div class="training">
      <header class="tr-head">
        <div class="rise">
          <div class="kicker">Training</div>
          <h2 class="display">Earn your <span class="serif">stars.</span></h2>
          <p class="lede">Every drill has ten levels. One star unlocks the next level; three stars means you've mastered it. The coach watches every run and tells you, in plain words, what to fix next.</p>
        </div>
        <div class="rank-card glass rise">
          <div class="kicker plain">Rank</div>
          <div class="rank-name">${esc(rank.name)}</div>
          <p class="note" style="margin:0">${esc(rank.blurb)}</p>
          <div class="bar"><i style="width:${Math.round(rank.progress * 100)}%"></i></div>
          <div class="rank-meta"><span><b>${total}</b> ★</span><span>${rank.next ? `${rank.next.stars - total} ★ to ${esc(rank.next.name)}` : 'Top rank'}</span><span><b>${st}</b>-day streak</span></div>
        </div>
      </header>
      <section class="daily-cta glass rise">
        <div>
          <div class="kicker">Daily warm-up</div>
          <h3>${count} drills, one button, about six minutes.</h3>
          <p class="note" style="margin:0">${DAILY.map((d) => DRILL_DEFS.find((x) => x.id === d)!.name).join(' → ')} · each at your current level · ${today ? `${today} run${today > 1 ? 's' : ''} today` : 'not done today'}</p>
        </div>
        <button class="btn" data-act="daily">Start warm-up <span class="arr">→</span></button>
      </section>
      ${odCard}
      <section class="tgrid">${order.map(card).join('')}</section>
    </div>`);
  actions(el, {
    brief: (b) => openBriefing(app, b.dataset.id as DrillId),
    daily: () => runDaily(app),
    songs: () => app.go('songs'),
  });
  return { el };
});
