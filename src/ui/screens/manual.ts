import type { DrillId } from '../../core/coach';
import { MAX_LEVEL, unlockedLevel } from '../../core/progress';
import { store } from '../../core/store';
import { ProtractorDrill } from '../../drills/range';
import { drillDef } from '../../drills/registry';
import { CHAPTERS, type Chapter } from '../../guide/chapters';
import { App } from '../app';
import { actions, esc, h } from '../dom';
import { LESSON_TITLE } from '../../film/lessons';
import { openFilm } from '../film';
import { openBriefing } from '../session';

let lastSlug = CHAPTERS[0].slug;

function drillCard(id: DrillId | 'protractor'): string {
  if (id === 'protractor')
    return `<div class="drill-card rise">
      <div class="kicker">Instrument</div>
      <h4>Protractor</h4>
      <p>No targets. Slide your mouse along a ruler and spin 360° to check the maths against your real hand.</p>
      <button class="btn" data-act="protractor">Open <span class="arr">→</span></button>
    </div>`;
  const def = drillDef(id);
  if (!def) return '';
  const prog = store.get().progress[id];
  const unlocked = unlockedLevel(prog);
  const rungs = Array.from({ length: MAX_LEVEL }, (_, k) => {
    const n = k + 1;
    const s = prog?.levels[n]?.stars ?? 0;
    return `<i class="rung ${n > unlocked ? 'locked' : n === unlocked ? 'next' : 'done'} s${s}"></i>`;
  }).join('');
  const best = prog?.levels[unlocked]?.best;
  return `<div class="drill-card rise">
    <div class="kicker">${esc(def.skill)} drill</div>
    <h4>${esc(def.name)}</h4>
    <p>${esc(def.oneLiner)}</p>
    <div class="ladder light">${rungs}</div>
    <button class="btn" data-act="drill" data-id="${def.id}">Play level ${unlocked} <span class="arr">→</span></button>
    <div class="best">${best != null ? `BEST ON LEVEL ${unlocked} · ${best}` : `LEVEL ${unlocked} OF ${MAX_LEVEL}`}</div>
  </div>`;
}

function chapterHtml(c: Chapter, i: number): string {
  const ctx = { sens: store.settings.sens, dpi: store.settings.dpi };
  const d = c.diagram?.(ctx);
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];
  return `
    <article class="chapter">
      <header class="ch-head">
        <span class="bignum rise">${c.n}</span>
        <div class="rise">
          <div class="kicker">${c.tag} · Field manual</div>
          <h2 class="display">${esc(c.title)}</h2>
        </div>
      </header>
      <div class="ch-short rise"><span class="kicker plain">In one sentence</span><p class="thesis">${esc(c.short)}</p></div>
      <div class="ch-body">
        ${c.analogy ? `<aside class="analogy rise"><span class="kicker plain">Think of it like…</span><p>${esc(c.analogy)}</p></aside>` : ''}
        ${c
          .sections(ctx)
          .map((s) => `<section class="ch-sec rise"><h3>${s.h}</h3>${s.html}</section>`)
          .join('')}
        ${d ? `<figure class="diagram rise" style="margin:0">${d.svg}<figcaption>${d.caption}</figcaption></figure>` : ''}
        ${
          c.fixes?.length
            ? `<section class="ch-sec rise"><h3>If this happens → do this</h3><table class="fixes">${c.fixes
                .map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`)
                .join('')}</table></section>`
            : ''
        }
        ${
          c.exercises.length
            ? `<section class="ch-sec rise"><h3>Take it into Overwatch</h3><ol class="exercises">${c.exercises
                .map((e) => `<li><div><b>${esc(e.title)}</b><span>${esc(e.detail)}</span></div><i>${esc(e.dose)}</i></li>`)
                .join('')}</ol></section>`
            : ''
        }
        <nav class="ch-nav rise">
          ${prev ? `<button class="btn ghost small" data-act="ch" data-slug="${prev.slug}">← ${prev.n} ${esc(prev.title)}</button>` : '<span></span>'}
          ${next ? `<button class="btn ghost small" data-act="ch" data-slug="${next.slug}">${next.n} ${esc(next.title)} →</button>` : ''}
        </nav>
      </div>
      <aside class="ch-aside">
        ${
          c.films?.length
            ? `<div class="drill-card rise film-card"><div class="kicker">Film room</div><h4>Watch it happen</h4><p>Slow-motion replays with the right way next to them, explained step by step.</p><div class="film-demos">${c.films
                .map((k) => `<button class="watch" data-act="film" data-kind="${k}">${esc(LESSON_TITLE[k])}</button>`)
                .join('')}</div></div>`
            : ''
        }
        ${c.drills.map(drillCard).join('')}
        ${c.cta ? `<div class="drill-card rise"><div class="kicker">Next step</div><h4>${esc(c.cta.label)}</h4><p>Put this chapter to work.</p><button class="btn" data-act="cta" data-route="${c.cta.route}">Open <span class="arr">→</span></button></div>` : ''}
        <div class="panel glass rise"><h4><span>Controls</span></h4><p class="note" style="margin:0"><span class="kbd">WASD</span> move · <span class="kbd">SPACE</span> jump (hold to keep jumping) · <span class="kbd">C</span>/<span class="kbd">SHIFT</span> crouch · <span class="kbd">LMB</span> fire · <span class="kbd">ESC</span> pause</p></div>
      </aside>
    </article>`;
}

App.register('manual', (app, arg) => {
  if (typeof arg === 'string' && CHAPTERS.some((c) => c.slug === arg)) lastSlug = arg;
  if (!CHAPTERS.some((c) => c.slug === lastSlug)) lastSlug = CHAPTERS[0].slug;
  const el = h(`<div class="manual"><nav class="toc"></nav><div class="ch-wrap"></div></div>`);
  const toc = el.querySelector('.toc') as HTMLElement;
  const wrap = el.querySelector('.ch-wrap') as HTMLElement;

  const show = (slug: string) => {
    lastSlug = slug;
    const i = CHAPTERS.findIndex((c) => c.slug === slug);
    const c = CHAPTERS[i];
    toc.innerHTML = `
      <h2 class="display">Field<span class="serif">manual</span></h2>
      <p class="note" style="margin:-12px 0 18px">Aim, explained simply. Every chapter ends with a drill and something to try in Overwatch.</p>
      <ol>${CHAPTERS.map((ch) => `<li><button class="${ch.slug === slug ? 'on' : ''}" data-act="ch" data-slug="${ch.slug}"><span class="n">${ch.n}</span><span class="t">${esc(ch.title)}</span><span class="k">${ch.tag}</span></button></li>`).join('')}</ol>`;
    wrap.innerHTML = chapterHtml(c, i);
    wrap.querySelectorAll<HTMLElement>('.rise').forEach((r, n) => r.style.setProperty('--i', String(n)));
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
    el.scrollTop = 0;
  };

  actions(el, {
    ch: (b) => show(b.dataset.slug!),
    drill: (b) => openBriefing(app, b.dataset.id as DrillId),
    protractor: () =>
      app.play(
        () => new ProtractorDrill(app.game),
        () => {
          app.endPlay();
          app.go('tools');
        },
      ),
    cta: (b) => app.go(b.dataset.route as 'calibrate'),
    film: (b) => openFilm(app, { kind: b.dataset.kind as keyof typeof LESSON_TITLE, source: 'An example flick', onPractise: (d) => openBriefing(app, d) }),
  });

  const unsub = store.subscribe(() => {
    if (app.route === 'manual' && !app.game.input.locked) show(lastSlug);
  });
  show(lastSlug);
  return { el, destroy: unsub };
});
