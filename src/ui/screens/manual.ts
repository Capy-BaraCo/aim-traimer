import { store } from '../../core/store';
import { CHAPTERS, type Chapter } from '../../guide/chapters';
import { App } from '../app';
import { actions, h } from '../dom';

let lastSlug = CHAPTERS[0].slug;

function chapterHtml(c: Chapter, i: number): string {
  const ctx = { sens: store.settings.sens, dpi: store.settings.dpi };
  const d = c.diagram?.(ctx);
  const bests = store.get().bests;
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];
  return `
    <article class="chapter">
      <header class="ch-head">
        <span class="bignum rise">${c.n}</span>
        <div class="rise">
          <div class="kicker">${c.tag} · Field manual</div>
          <h2 class="display">${c.title}</h2>
        </div>
      </header>
      <p class="thesis rise">${c.thesis}</p>
      <div class="ch-body">
        ${c
          .sections(ctx)
          .map((s) => `<section class="ch-sec rise"><h3>${s.h}</h3>${s.html}</section>`)
          .join('')}
        ${d ? `<figure class="diagram rise" style="margin:0">${d.svg}<figcaption>${d.caption}</figcaption></figure>` : ''}
        <section class="ch-sec rise">
          <h3>Take it into Overwatch</h3>
          <ol class="exercises">${c.exercises.map((e) => `<li><div><b>${e.title}</b><span>${e.detail}</span></div><i>${e.dose}</i></li>`).join('')}</ol>
        </section>
        <nav class="ch-nav rise">
          ${prev ? `<button class="btn ghost small" data-act="ch" data-slug="${prev.slug}">← ${prev.n} ${prev.title}</button>` : '<span></span>'}
          ${next ? `<button class="btn ghost small" data-act="ch" data-slug="${next.slug}">${next.n} ${next.title} →</button>` : ''}
        </nav>
      </div>
      <aside class="ch-aside">
        ${c.drills
          .map(
            (dr) => `<div class="drill-card rise">
              <div class="kicker">Drill</div>
              <h4>${dr.name}</h4>
              <p>${dr.blurb}</p>
              <button class="btn" data-act="drill" data-id="${dr.id}">Run drill <span class="arr">→</span></button>
              <div class="best">${bests[dr.id] != null ? `PERSONAL BEST · ${bests[dr.id]}` : 'NO RUNS YET'}</div>
            </div>`,
          )
          .join('')}
        ${c.cta ? `<div class="drill-card rise"><div class="kicker">Next step</div><h4>${c.cta.label}</h4><p>Everything in this chapter, applied to you.</p><button class="btn" data-act="cta" data-route="${c.cta.route}">Open <span class="arr">→</span></button></div>` : ''}
        <div class="panel glass rise"><h4><span>Controls</span></h4><p class="note" style="margin:0"><span class="kbd">WASD</span> move · <span class="kbd">SPACE</span> jump (hold to bunny-hop) · <span class="kbd">C</span>/<span class="kbd">SHIFT</span> crouch · <span class="kbd">LMB</span> fire · <span class="kbd">ESC</span> pause</p></div>
      </aside>
    </article>`;
}

App.register('manual', (app, arg) => {
  if (typeof arg === 'string' && CHAPTERS.some((c) => c.slug === arg)) lastSlug = arg;
  const el = h(`<div class="manual"><nav class="toc"></nav><div class="ch-wrap"></div></div>`);
  const toc = el.querySelector('.toc') as HTMLElement;
  const wrap = el.querySelector('.ch-wrap') as HTMLElement;

  const show = (slug: string) => {
    lastSlug = slug;
    const i = CHAPTERS.findIndex((c) => c.slug === slug);
    const c = CHAPTERS[i];
    toc.innerHTML = `
      <h2 class="display">Field<span class="serif">manual</span></h2>
      <ol>${CHAPTERS.map((ch) => `<li><button class="${ch.slug === slug ? 'on' : ''}" data-act="ch" data-slug="${ch.slug}"><span class="n">${ch.n}</span><span class="t">${ch.title}</span><span class="k">${ch.tag}</span></button></li>`).join('')}</ol>
      <p class="note" style="margin-top:18px">Every chapter: the why, the how, a drill that measures it, and exercises to take into the game.</p>`;
    wrap.innerHTML = chapterHtml(c, i);
    wrap.querySelectorAll<HTMLElement>('.rise').forEach((r, n) => r.style.setProperty('--i', String(n)));
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
    el.scrollTop = 0;
  };

  actions(el, {
    ch: (b) => show(b.dataset.slug!),
    drill: (b) => {
      const c = CHAPTERS.find((x) => x.slug === lastSlug)!;
      const d = c.drills.find((x) => x.id === b.dataset.id);
      if (d) app.runDrill(() => d.make(app.game), () => undefined);
    },
    cta: (b) => app.go(b.dataset.route as 'calibrate'),
  });

  const unsub = store.subscribe(() => {
    if (app.route === 'manual' && !app.game.input.locked) show(lastSlug);
  });
  show(lastSlug);
  return { el, destroy: unsub };
});
