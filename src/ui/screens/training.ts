import { drillStars, rankFor, streak, totalStars, unlockedLevel } from '../../core/progress';
import { store } from '../../core/store';
import { DRILL_DEFS } from '../../drills/registry';
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
    const max = def.levels.length;
    const unlocked = unlockedLevel(prog, max);
    const ladder = Array.from({ length: max }, (_, k) => {
      const n = k + 1;
      const s = prog?.levels[n]?.stars ?? 0;
      const state = n > unlocked ? 'locked' : n === unlocked ? 'next' : 'done';
      return `<i class="rung ${state} s${s}" title="Level ${n}: ${n > unlocked ? 'locked' : `${s}/3 stars`}"></i>`;
    }).join('');
    const scores = p.sessions.filter((s) => s.drill === id).slice(-12).map((s) => s.score);
    return `<article class="tcard rise" style="--d:${i}">
      <div class="tc-top"><span class="kicker plain">${esc(def.skill)}</span><span class="mono muted">${drillStars(prog)}/${max * 3} ★</span></div>
      <h3>${esc(def.name)}</h3>
      <p>${esc(def.oneLiner)}</p>
      <div class="ladder" style="--n:${max}" aria-label="Level ladder">${ladder}</div>
      <div class="tc-foot">
        <div><span class="mono muted">LEVEL</span> <b class="num">${unlocked}</b><span class="mono muted">/${max}</span></div>
        ${C.sparkline(scores)}
        <button class="btn small" data-act="brief" data-id="${id}">Play <span class="arr">→</span></button>
      </div>
    </article>`;
  };

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
      <section class="tgrid">${order.map(card).join('')}</section>
    </div>`);
  actions(el, {
    brief: (b) => openBriefing(app, b.dataset.id as DrillId),
    daily: () => runDaily(app),
  });
  return { el };
});
