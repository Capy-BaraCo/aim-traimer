/**
 * The song screen (Overdrive, T17; D3, D9, D11): add your own songs by drag-and-drop or a button, see
 * each one's tempo, length and difficulty, and play it. A new song is analysed in the background the
 * moment it is added, so there is nothing to set up: its briefing opens by itself when it is ready
 * and Start is the one click left.
 */
import * as songs from '../../core/songs';
import { DIFFICULTIES, type Difficulty, type SongMeta } from '../../rhythm/types';
import { App } from '../app';
import { actions, esc, h } from '../dom';
import { openOverdriveBriefing, prepareSong } from '../session';

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const ACCEPT = 'audio/*,.mp3,.ogg,.oga,.wav,.m4a,.aac,.flac,.opus';

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A song being added or analysed right now. */
interface Pending {
  name: string;
  /** 0..1 over decoding and analysis together. */
  fraction: number;
  error?: string;
}

App.register('songs', (app) => {
  let list: SongMeta[] = [];
  let bpm = new Map<string, number>();
  let loaded = false;
  let loadError = '';
  let notice = '';
  let confirming: string | null = null;
  let dragging = 0;
  let first = true;
  /** Songs being analysed, by id; a file that failed to add is keyed by its name. */
  const pending = new Map<string, Pending>();
  let alive = true;

  const el = h(`<div class="songs"><div class="sg-body"></div><input type="file" class="od-file" accept="${ACCEPT}" multiple hidden /></div>`);
  const view = el.querySelector<HTMLElement>('.sg-body')!;

  const rowOf = (m: SongMeta): string => {
    const p = pending.get(m.id);
    const tempo = bpm.get(m.id);
    const pills = DIFFICULTIES.map(
      (d) => `<button class="od-pill ${d === m.difficulty ? 'on' : ''}" data-act="diff" data-id="${m.id}" data-d="${d}" aria-pressed="${d === m.difficulty}" title="${DIFFICULTY_LABEL[d]}">${DIFFICULTY_LABEL[d]}</button>`,
    ).join('');
    const facts = p
      ? `<span class="mono muted">GETTING IT READY · ${Math.round(p.fraction * 100)}%</span>`
      : `<span class="mono muted">${tempo ? `${Math.round(tempo)} BPM · ` : ''}${m.duration ? clock(m.duration) : '—'}</span>`;
    const end =
      confirming === m.id
        ? `<div class="od-confirm" role="group" aria-label="Delete ${esc(m.name)}?"><span>Delete this song?</span><button class="btn small" data-act="delete-yes" data-id="${m.id}">Delete</button><button class="btn small ghost" data-act="delete-no">Keep</button></div>`
        : `<button class="btn small" data-act="play" data-id="${m.id}" ${p ? 'disabled' : ''}>Play <span class="arr">→</span></button><button class="od-x" data-act="delete" data-id="${m.id}" aria-label="Delete ${esc(m.name)}" title="Delete">✕</button>`;
    return `<li class="od-song-row" data-id="${m.id}">
      <div class="od-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="od-song-main">
        <b class="od-song-name">${esc(m.name)}</b>
        <div class="od-song-facts">${facts}<span class="od-style mono muted">STYLE · MIXED</span></div>
        ${p ? `<div class="od-bar"><i style="width:${Math.round(p.fraction * 100)}%"></i></div>` : ''}
      </div>
      <div class="od-pills" role="group" aria-label="Difficulty">${pills}</div>
      <div class="od-song-end">${end}</div>
    </li>`;
  };

  const problemsOf = (): string =>
    [...pending.entries()]
      .filter(([, p]) => p.error)
      .map(([id, p]) => `<p class="od-problem" role="alert"><b>${esc(p.name)}</b>: ${esc(p.error!)} <button class="od-link" data-act="dismiss" data-id="${esc(id)}">Dismiss</button></p>`)
      .join('');

  const render = () => {
    if (!alive) return;
    const shown = list.filter((m) => !pending.get(m.id)?.error);
    const body = loadError
      ? `<p class="od-problem" role="alert">${esc(loadError)}</p>`
      : !loaded
        ? '<p class="note">Loading your songs…</p>'
        : shown.length
          ? `<ul class="od-songs">${shown.map(rowOf).join('')}</ul>`
          : `<div class="od-empty">
              <div class="od-sun" aria-hidden="true"></div>
              <h3 class="display">Add a song to start</h3>
              <p class="lede">Drop an MP3 here, or pick one from your computer. Overdrive listens to it, finds the beat and builds your targets around the music. Your songs stay in this browser and are never uploaded.</p>
            </div>`;
    view.innerHTML = `
      <header class="sg-head">
        <div class="${first ? 'rise' : ''}">
          <button class="od-link" data-act="back">← Training</button>
          <div class="kicker">Overdrive</div>
          <h2 class="display">Your <span class="serif">songs.</span></h2>
          <p class="lede">Pick a song, pick a difficulty and shoot to the beat. Add as many songs as you like.</p>
        </div>
      </header>
      <section class="od-drop" aria-label="Add a song">
        <div class="od-drop-in">
          <b><span class="od-idle">Drop a song here</span><span class="od-over">Drop it here</span></b>
          <span class="muted">MP3, OGG, WAV or M4A</span>
        </div>
        <button class="btn" data-act="pick">Add song <span class="arr">+</span></button>
      </section>
      ${notice ? `<p class="od-notice" role="status">${esc(notice)}</p>` : ''}
      ${problemsOf()}
      ${body}`;
    view.querySelectorAll<HTMLElement>('.rise').forEach((r, i) => r.style.setProperty('--i', String(i)));
    first = false;
  };

  /** Re-read the library (and each song's tempo from its saved analysis). */
  const refresh = async () => {
    try {
      list = await songs.list();
      loadError = '';
      const tempos = await Promise.all(list.map((m) => songs.getAnalysis(m.id).then((a) => [m.id, a?.analysis.bpm] as const, () => [m.id, undefined] as const)));
      bpm = new Map(tempos.filter((t): t is readonly [string, number] => t[1] !== undefined));
    } catch (e) {
      loadError = songs.describeSongError(e);
    }
    loaded = true;
    render();
  };

  /** Update one row's progress without redrawing the whole list (analysis reports many times a second). */
  const showProgress = (id: string) => {
    const p = pending.get(id);
    const row = el.querySelector(`.od-song-row[data-id="${id}"]`);
    if (!p || !row) return;
    const fill = row.querySelector<HTMLElement>('.od-bar i');
    if (fill) fill.style.width = `${Math.round(p.fraction * 100)}%`;
    const facts = row.querySelector('.od-song-facts .mono');
    if (facts) facts.textContent = `GETTING IT READY · ${Math.round(p.fraction * 100)}%`;
  };

  const addFiles = async (files: File[]) => {
    notice = '';
    const picked = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i.test(f.name));
    if (!picked.length) {
      if (files.length) {
        notice = "That doesn't look like a song. Try an MP3, OGG or WAV file.";
        render();
      }
      return;
    }
    for (const file of picked) {
      let meta: SongMeta;
      let added: boolean;
      try {
        ({ meta, added } = await songs.add(file));
      } catch (e) {
        pending.set(`file:${file.name}`, { name: file.name, fraction: 0, error: songs.describeSongError(e) });
        render();
        continue;
      }
      if (!added) notice = `"${meta.name}" is already in your list.`;
      pending.set(meta.id, { name: meta.name, fraction: 0 });
      await refresh();
      try {
        await prepareSong(app, meta.id, (p) => {
          const part = p.stage === 'decoding' ? p.fraction * 0.3 : 0.3 + p.fraction * 0.7;
          const cur = pending.get(meta.id);
          if (cur) cur.fraction = part;
          showProgress(meta.id);
        });
      } catch (e) {
        // A song we can't read is no use to anyone: say why and drop it from the library.
        await songs.remove(meta.id).catch(() => {});
        pending.set(meta.id, { name: meta.name, fraction: 0, error: songs.describeSongError(e) });
        await refresh();
        continue;
      }
      pending.delete(meta.id);
      await refresh();
      // One song added and ready: go straight to its briefing, so Start is the only click left.
      const fresh = list.find((m) => m.id === meta.id);
      if (alive && fresh && picked.length === 1 && app.route === 'songs') openOverdriveBriefing(app, fresh);
    }
  };

  const input = () => el.querySelector<HTMLInputElement>('.od-file');
  actions(el, {
    back: () => app.go('training'),
    pick: () => input()?.click(),
    play: (b) => {
      const m = list.find((x) => x.id === b.dataset.id);
      if (m) openOverdriveBriefing(app, m);
    },
    diff: (b) => {
      const id = b.dataset.id!;
      const m = list.find((x) => x.id === id);
      if (!m) return;
      const next = b.dataset.d as Difficulty;
      m.difficulty = next;
      render();
      void songs.setPresets(id, m.preset, next).catch((e) => {
        notice = songs.describeSongError(e);
        render();
      });
    },
    delete: (b) => {
      confirming = b.dataset.id!;
      render();
    },
    'delete-no': () => {
      confirming = null;
      render();
    },
    'delete-yes': (b) => {
      const id = b.dataset.id!;
      confirming = null;
      void songs
        .remove(id)
        .catch((e) => (notice = songs.describeSongError(e)))
        .then(() => refresh());
    },
    dismiss: (b) => {
      pending.delete(b.dataset.id!);
      render();
    },
  });
  // The file input is re-created by every render, so listen on the screen and pick it out of the event.
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList?.contains('od-file') || !t.files) return;
    const files = Array.from(t.files);
    t.value = '';
    void addFiles(files);
  });
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragging++ === 0) el.classList.add('dragging');
  });
  el.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  el.addEventListener('dragleave', () => {
    if (dragging > 0 && --dragging === 0) el.classList.remove('dragging');
  });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = 0;
    el.classList.remove('dragging');
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  });

  render();
  void refresh();
  return {
    el,
    destroy: () => {
      alive = false;
    },
  };
});
