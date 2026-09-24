import { roundSens } from '../../core/sens';
import { store } from '../../core/store';
import { FreeRangeDrill } from '../../drills/range';
import { App } from '../app';
import { actions, h } from '../dom';

App.register('range', (app) => {
  const el = h(`
    <div class="tools">
      <header>
        <div class="kicker rise">Sandbox</div>
        <h2 class="display rise">Free <span class="serif">range.</span></h2>
        <p class="lede rise">Three strafing figures, no clock. Get used to Overwatch movement, nudge your sensitivity live, and hop the plinths behind spawn.</p>
      </header>
      <section class="panel glass span-5 rise">
        <h4><span>Keys</span></h4>
        <table class="conv"><tbody>
          <tr><td>Move · jump · crouch</td><td>WASD · SPACE · C / SHIFT</td></tr>
          <tr><td>Fire</td><td>LEFT MOUSE</td></tr>
          <tr><td>Sensitivity −0.05 / +0.05</td><td>[ · ]</td></tr>
          <tr><td>Pulse (auto) / Rail (semi)</td><td>1 · 2</td></tr>
          <tr><td>Respawn figures</td><td>R</td></tr>
          <tr><td>Pause / leave</td><td>ESC</td></tr>
        </tbody></table>
      </section>
      <section class="panel glass span-7 push-1 rise">
        <h4><span>Movement model</span><span>measured from Overwatch</span></h4>
        <div class="big-out">
          <div><span>Run / strafe</span><b>5.50</b></div>
          <div><span>Backpedal</span><b>4.95</b></div>
          <div><span>Crouch-walk</span><b>3.00</b></div>
          <div><span>Jump impulse</span><b>5.72</b></div>
          <div><span>Gravity</span><b>17.5</b></div>
          <div><span>Acceleration</span><b>∞</b></div>
        </div>
        <p class="note">Metres per second (gravity in m/s²). No ground acceleration: you hit full speed and stop dead instantly. Holding jump re-jumps on landing.</p>
        <div class="actions" style="margin-top:12px"><button class="btn" data-act="go">Enter the range <span class="arr">→</span></button></div>
      </section>
    </div>`);

  let drill: FreeRangeDrill | null = null;
  actions(el, {
    go: () =>
      app.play(
        () => (drill = new FreeRangeDrill(app.game)),
        () => undefined,
        { countdown: 1 },
        () => {
          if (!drill) return;
          const live = roundSens(drill.liveSens);
          if (live !== store.settings.sens) {
            app.showReport(
              {
                id: 'range',
                title: 'Free Range',
                score: 0,
                stats: [
                  { label: 'Saved sensitivity', value: store.settings.sens.toFixed(2) },
                  { label: 'Live sensitivity', value: live.toFixed(2) },
                ],
                notes: ['You nudged your sensitivity in the range. Keep it only if it felt better across several minutes — or verify it properly with Calibrate.'],
              },
              {
                extra: `<div class="actions"><button class="btn bone" data-act="keep">Keep ${live.toFixed(2)}</button></div>`,
              },
            );
            const keep = app.overlayEl?.querySelector('[data-act="keep"]');
            keep?.addEventListener('click', () => {
              store.setSettings({ sens: live });
              app.closeOverlay();
              app.toast(`Sensitivity set to ${live.toFixed(2)}.`);
            });
          }
        },
      ),
  });
  return { el };
});
