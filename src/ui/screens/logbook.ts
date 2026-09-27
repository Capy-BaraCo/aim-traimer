import { median, summariseFlicks } from '../../core/analytics';
import { feedback, flickFindings, placementFindings, trackingFindings, type DrillId, type Finding } from '../../core/coach';
import { rankFor, streak, totalStars } from '../../core/progress';
import { store } from '../../core/store';
import { DRILL_DEFS } from '../../drills/registry';
import { App } from '../app';
import * as C from '../charts';
import { actions, esc, h } from '../dom';
import { openBriefing } from '../session';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** 0..1 skill rating from recent runs: score, weighted by the level it was earned on. */
function rating(drill: string): number | null {
  const runs = store.get().sessions.filter((s) => s.drill === drill).slice(-8);
  if (!runs.length) return null;
  return avg(runs.map((r) => (r.score / 100) * (0.55 + 0.45 * (r.level / 10))));
}

function landingWords(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const d = x - 1;
  if (Math.abs(d) < 0.03) return 'right on target';
  return d > 0 ? `${Math.round(d * 100)}% past the target` : `${Math.round(-d * 100)}% short of the target`;
}

App.register('logbook', (app) => {
  const p = store.get();
  const total = totalStars(p.progress);
  const rank = rankFor(total);
  const flicks = p.flickLog.slice(-150);
  const fs = flicks.length ? summariseFlicks(flicks) : null;
  const tracks = p.trackLog.slice(-20);
  const places = p.placementLog.slice(-20);

  const findings: Finding[] = [];
  if (fs && fs.n >= 6) findings.push(...flickFindings(fs));
  if (tracks.length) {
    const delays = tracks.map((t) => t.delayMs).filter((d): d is number => d !== null);
    findings.push(
      ...trackingFindings({
        acc: avg(tracks.map((t) => t.acc)),
        meanError: 0,
        trail: avg(tracks.map((t) => t.trail)),
        vertical: avg(tracks.map((t) => t.vertical)),
        summary: { delayMs: delays.length ? median(delays) : null, jitter: avg(tracks.map((t) => t.jitter)), aimReversals: 0, targetReversals: 0, series: [] },
      }),
    );
  }
  if (places.length) findings.push(...placementFindings({ error: avg(places.map((x) => x.error)), vertical: avg(places.map((x) => x.vertical)), escapes: 0, count: places.length }));
  const fb = feedback(findings);
  const fixes = [...findings].filter((f) => f.kind === 'fix').sort((a, b) => b.weight - a.weight).slice(0, 3);

  const axes = [
    { label: 'Tracking', id: 'duelist' },
    { label: 'Short flicks', id: 'blink' },
    { label: 'Wide flicks', id: 'snap' },
    { label: 'Precision', id: 'pin' },
    { label: 'Placement', id: 'corner' },
    { label: 'Switching', id: 'triad' },
    { label: 'Movement', id: 'crossfire' },
  ].map((a) => ({ label: a.label, value: rating(a.id) }));

  const delays = tracks.map((t) => t.delayMs).filter((d): d is number => d !== null);
  const trackBlock = tracks.length
    ? `<div class="kpis">
        <div><span>Reaction to dodges</span><b>${delays.length ? Math.round(median(delays)) : '—'}<small> ms</small></b></div>
        <div><span>Behind (+) / ahead (−)</span><b>${avg(tracks.map((t) => t.trail)).toFixed(2)}<small>°</small></b></div>
        <div><span>Height vs chest</span><b>${(-avg(tracks.map((t) => t.vertical))).toFixed(2)}<small>°</small></b></div>
        <div><span>Time on target</span><b>${pct(avg(tracks.map((t) => t.acc)))}</b></div>
      </div>
      <div class="trend"><span class="mono muted">Reaction delay, last ${delays.length} runs</span>${C.sparkline(delays.map((d) => Math.max(0, 400 - d) / 4))}</div>`
    : '<p class="note">Play Duelist or Crossfire to measure your tracking.</p>';

  const profile = fs
    ? `<p class="lede plain">When you flick, your first movement usually stops <b>${landingWords(fs.landing)}</b>.
        ${fs.buckets.short.n >= 3 ? `Short flicks stop ${landingWords(fs.buckets.short.landing)}` : ''}${fs.buckets.short.n >= 3 && (fs.buckets.wide.n >= 3 || fs.buckets.mid.n >= 3) ? '; ' : ''}${fs.buckets.wide.n >= 3 ? `wide ones ${landingWords(fs.buckets.wide.landing)}` : fs.buckets.mid.n >= 3 ? `medium ones ${landingWords(fs.buckets.mid.landing)}` : ''}.
        You start moving after about <b>${Math.round(fs.reactionMs)} ms</b>, the flick itself takes <b>${Math.round(fs.ballisticMs)} ms</b> and fixing takes <b>${Number.isFinite(fs.correctionMs) ? Math.round(fs.correctionMs) : '—'} ms</b>.
        ${delays.length ? `When tracking, you follow dodges about <b>${Math.round(median(delays))} ms</b> late.` : ''}
        ${places.length ? `Waiting at corners, your crosshair rests <b>${Math.abs(avg(places.map((x) => x.vertical))).toFixed(1)}° ${avg(places.map((x) => x.vertical)) > 0 ? 'below' : 'above'}</b> head height.` : ''}</p>`
    : '<p class="lede plain">Play Blink or Snap and this page will show exactly where your flicks land, how long each part takes, and which directions give you trouble.</p>';

  const recent = p.sessions.slice(-14).reverse();
  const name = (id: string) => DRILL_DEFS.find((d) => d.id === id)?.name ?? id;

  const el = h(`
    <div class="logbook">
      <header class="lb-head">
        <div class="rise">
          <div class="kicker">Logbook</div>
          <h2 class="display">Your aim, <span class="serif">measured.</span></h2>
        </div>
        <div class="kpis big rise">
          <div><span>Rank</span><b>${esc(rank.name)}</b></div>
          <div><span>Stars</span><b>${total}</b></div>
          <div><span>Day streak</span><b>${streak(p.days)}</b></div>
          <div><span>Drills played</span><b>${p.sessions.length}</b></div>
        </div>
      </header>

      <section class="lb-row">
        <div class="lb-stack">
          <div class="panel glass rise">
            <h4><span>Aim fingerprint</span><span>recent runs × level</span></h4>
            ${C.radar(axes)}
            <p class="note" style="margin:0">The further out, the stronger. Grey dots haven't been measured yet.</p>
          </div>
          <div class="panel glass rise"><h4><span>Tracking</span><span>last ${tracks.length} runs</span></h4>${trackBlock}</div>
        </div>
        <div class="panel glass rise">
          <h4><span>Coach · this week work on</span></h4>
          <div class="findings compact">${
            fixes.length
              ? fixes
                  .map(
                    (f) => `<article class="finding fix"><h4>${esc(f.title)}</h4><p>${esc(f.body)}</p><p class="f-tip"><b>Try this:</b> ${esc(f.tip)}</p>${f.drill ? `<button class="btn small ghost" data-act="brief" data-id="${f.drill}">Practise in ${esc(name(f.drill))} →</button>` : ''}</article>`,
                  )
                  .join('')
              : '<p class="note">Not enough data yet. Play a Daily warm-up and come back.</p>'
          }${fb.good ? `<article class="finding good"><h4>${esc(fb.good.title)}</h4><p>${esc(fb.good.body)}</p></article>` : ''}</div>
        </div>
      </section>

      <section class="panel glass rise">
        <h4><span>Your crosshair, in plain words</span><span>last ${flicks.length} flicks</span></h4>
        ${profile}
        ${
          fs
            ? `<div class="lb-charts">${C.landingMap(flicks, 'dark', 'Where your first movement stops (all drills)')}${C.directionChart(fs)}${C.speedShape(fs)}${C.rangeBars(fs)}${C.timeSplit(fs)}</div>`
            : ''
        }
      </section>

      <section class="lb-sessions">
        <div class="panel glass rise"><h4><span>Recent sessions</span><span>last ${recent.length}</span></h4>
          ${
            recent.length
              ? `<table class="daily-table"><tbody>${recent
                  .map(
                    (s) =>
                      `<tr><td><b>${esc(name(s.drill))}</b></td><td class="muted">lv ${s.level}</td><td>${s.score}</td><td>${C.stars(s.stars)}</td><td class="muted">${new Date(s.at).toLocaleDateString()}</td></tr>`,
                  )
                  .join('')}</tbody></table>`
              : '<p class="note">No sessions yet.</p>'
          }
        </div>
      </section>
    </div>`);
  actions(el, { brief: (b) => openBriefing(app, b.dataset.id as DrillId) });
  return { el };
});
